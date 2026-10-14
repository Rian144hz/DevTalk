import { createDb } from './harness';
import type { TestDb } from './harness';
import * as P from './people';

let t: TestDb;
beforeAll(async () => {
  t = await createDb();
}, 30_000);

const accept = (uid: string) => P.accept(t, uid);
const insertProfile = (uid: string, over: Record<string, unknown> = {}) => P.insertProfile(t, uid, over);
const member = (over: Record<string, unknown> = {}) => P.member(t, over);
const suspend = (uid: string, interval?: string) => P.suspend(t, uid, interval);
const visibleIds = () => P.visibleIds(t);

test('anon cannot read profiles or consents', async () => {
  await member();
  await t.as(null);
  await expect(t.db.query('select * from profiles')).rejects.toThrow(/permission denied/);
  await expect(t.db.query('select * from consents')).rejects.toThrow(/permission denied/);
});

test('a user inserts and reads their own profile', async () => {
  const uid = await member({ display_name: 'Ana' });
  const r = await t.db.query<{ display_name: string }>('select display_name from profiles where id = $1', [uid]);
  expect(r.rows).toEqual([{ display_name: 'Ana' }]);
});

test('a profile cannot be created before the documents are accepted', async () => {
  const uid = await t.newUser();
  await t.as(uid);
  await expect(insertProfile(uid)).rejects.toThrow(/row-level security/);
});

test('a user cannot create a profile for someone else', async () => {
  const other = await t.newUser();
  const uid = await t.newUser();
  await accept(uid);
  await expect(insertProfile(other)).rejects.toThrow(/row-level security/);
});

test('another active user can read a profile', async () => {
  const a = await member();
  await member();
  expect(await visibleIds()).toContain(a);
});

test('a user cannot update someone else profile', async () => {
  const a = await member({ display_name: 'Alice' });
  await member();
  const r = await t.db.query(`update profiles set display_name = 'Mallory' where id = $1`, [a]);
  expect(r.affectedRows).toBe(0);
  const name = await t.owner(() => t.db.query<{ display_name: string }>('select display_name from profiles where id = $1', [a]));
  expect(name.rows[0]!.display_name).toBe('Alice');
});

test('the owner cannot change suspended_until', async () => {
  const uid = await member();
  await expect(t.db.query(`update profiles set suspended_until = null where id = $1`, [uid])).rejects.toThrow(/permission denied/);
});

test('a suspended owner cannot update their profile', async () => {
  const uid = await member();
  await suspend(uid);
  const r = await t.db.query(`update profiles set bio = 'still here' where id = $1`, [uid]);
  expect(r.affectedRows).toBe(0);
});

test('a suspended profile is invisible to others and visible to its owner', async () => {
  const s = await member();
  await suspend(s);
  await member();
  expect(await visibleIds()).not.toContain(s);
  await t.as(s);
  expect(await visibleIds()).toContain(s);
});

test('a suspension in the past no longer hides the profile', async () => {
  const s = await member();
  await suspend(s, '-1 day');
  await member();
  expect(await visibleIds()).toContain(s);
});

test('a suspended user cannot read other profiles', async () => {
  const other = await member();
  const s = await member();
  await suspend(s);
  await t.as(s);
  expect(await visibleIds()).not.toContain(other);
});

test('consents: a user reads and inserts only their own, and cannot change or delete them', async () => {
  const a = await member();
  const b = await member();
  const own = await t.db.query<{ user_id: string }>('select user_id from consents');
  expect(new Set(own.rows.map((r) => r.user_id))).toEqual(new Set([b]));
  await expect(
    t.db.query(`insert into consents (user_id, document, version) values ($1, 'terms', '2026-12-01')`, [a]),
  ).rejects.toThrow(/row-level security/);
  await expect(t.db.query(`update consents set version = 'x' where user_id = $1`, [b])).rejects.toThrow(/permission denied/);
  await expect(t.db.query(`delete from consents where user_id = $1`, [b])).rejects.toThrow(/permission denied/);
});

test('deleting the auth user removes the profile and consents', async () => {
  const uid = await member();
  await t.asOwner();
  await t.db.query('delete from auth.users where id = $1', [uid]);
  const p = await t.db.query('select 1 from profiles where id = $1', [uid]);
  const c = await t.db.query('select 1 from consents where user_id = $1', [uid]);
  expect([p.rows.length, c.rows.length]).toEqual([0, 0]);
});

describe('profile checks', () => {
  let uid: string;
  beforeAll(async () => {
    uid = await t.newUser();
    await accept(uid);
  });
  beforeEach(async () => t.as(uid));

  test.each([
    ['a 1-character name', { display_name: 'R' }],
    ['a 41-character name', { display_name: 'x'.repeat(41) }],
    ['11 stack tags', { stack: Array.from({ length: 11 }, (_, i) => `t${i}`) }],
    ['a 31-character tag', { stack: ['x'.repeat(31)] }],
    ['an unknown level', { level: 'B3' }],
    ['an unknown area', { area: 'qa' }],
    ['a 161-character bio', { bio: 'x'.repeat(161) }],
    ['15 availability slots', { availability: JSON.stringify(Array.from({ length: 15 }, () => ({ day: 1, from: '08:00', to: '09:00' }))) }],
    ['a slot ending before it starts', { availability: JSON.stringify([{ day: 1, from: '10:00', to: '09:00' }]) }],
    ['a slot on day 7', { availability: JSON.stringify([{ day: 7, from: '08:00', to: '09:00' }]) }],
    ['an avatar outside the user folder', { avatar_path: 'someone-else/avatar.webp' }],
  ])('rejects %s', async (_label, over) => {
    await expect(insertProfile(uid, over)).rejects.toThrow(/violates check constraint/);
  });

  test('accepts an avatar in the user folder', async () => {
    await insertProfile(uid, { avatar_path: `${uid}/avatar.webp` });
  });
});
