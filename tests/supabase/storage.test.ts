import { createDb } from './harness';
import type { TestDb } from './harness';
import { member, suspend } from './people';

let t: TestDb;
beforeAll(async () => {
  t = await createDb();
}, 30_000);

const path = (uid: string) => `${uid}/avatar.webp`;

async function upload(uid: string, name = path(uid)) {
  await t.as(uid);
  await t.db.query(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [name]);
}

async function canSee(viewer: string | null, owner: string): Promise<boolean> {
  await t.as(viewer);
  const r = await t.db.query(`select 1 from storage.objects where bucket_id = 'avatars' and name = $1`, [path(owner)]);
  return r.rows.length === 1;
}

test('the avatars bucket is private, WebP only, 200 KB max', async () => {
  const r = await t.owner(() =>
    t.db.query<{ public: boolean; file_size_limit: number; allowed_mime_types: string[] }>(
      `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'avatars'`,
    ),
  );
  expect(r.rows).toEqual([{ public: false, file_size_limit: 204800, allowed_mime_types: ['image/webp'] }]);
});

test('a user can write, replace and remove their own avatar', async () => {
  const a = await member(t);
  await upload(a);
  expect((await t.db.query(`update storage.objects set name = name where name = $1`, [path(a)])).affectedRows).toBe(1);
  expect((await t.db.query(`delete from storage.objects where name = $1`, [path(a)])).affectedRows).toBe(1);
});

test('a user cannot write into someone else folder', async () => {
  const a = await member(t);
  const b = await member(t);
  await expect(upload(a, path(b))).rejects.toThrow(/row-level security/);
});

test('another active member can read an avatar, anon cannot', async () => {
  const a = await member(t);
  await upload(a);
  const b = await member(t);
  expect(await canSee(b, a)).toBe(true);
  expect(await canSee(null, a)).toBe(false);
});

test('a suspended user cannot read avatars, and a suspended avatar is hidden', async () => {
  const a = await member(t);
  await upload(a);
  const s = await member(t);
  await upload(s);
  await suspend(t, s);
  expect(await canSee(s, a)).toBe(false);
  const b = await member(t);
  expect(await canSee(b, s)).toBe(false);
});

test('a block hides avatars in both directions', async () => {
  const a = await member(t);
  await upload(a);
  const b = await member(t);
  await upload(b);
  await t.as(a);
  await t.db.query('insert into blocks (blocker, blocked) values ($1, $2)', [a, b]);
  expect(await canSee(a, b)).toBe(false);
  expect(await canSee(b, a)).toBe(false);
});

test('a user cannot remove someone else avatar', async () => {
  const a = await member(t);
  await upload(a);
  await member(t);
  expect((await t.db.query(`delete from storage.objects where name = $1`, [path(a)])).affectedRows).toBe(0);
});
