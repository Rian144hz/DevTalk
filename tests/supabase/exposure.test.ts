// Findings of the final review: what the API exposes beyond the tables' own rules.
import { createDb } from './harness';
import type { TestDb } from './harness';
import { accept, member, moderator, suspend, visibleIds } from './people';

let t: TestDb;
beforeAll(async () => {
  t = await createDb();
}, 30_000);

const scalar = async <T>(sql: string, params: unknown[] = []) =>
  Object.values((await t.db.query<Record<string, T>>(sql, params)).rows[0]!)[0] as T;

describe('helper functions answer only about the caller', () => {
  test('a third person cannot ask whether two others blocked each other, nor about their status', async () => {
    const a = await member(t);
    const b = await member(t);
    await t.as(a);
    await t.db.query('insert into blocks (blocker, blocked) values ($1, $2)', [a, b]);
    await member(t);
    await expect(t.db.query('select public.is_blocked_between($1, $2)', [a, b])).rejects.toThrow(/permission denied/);
    await expect(t.db.query('select public.is_active($1)', [a])).rejects.toThrow(/permission denied/);
    await expect(t.db.query('select public.has_accepted_documents($1)', [a])).rejects.toThrow(/permission denied/);
  });

  test('can_see_profile tells the caller only what a select would show', async () => {
    const a = await member(t);
    const b = await member(t);
    const c = await member(t);
    await t.as(a);
    await t.db.query('insert into blocks (blocker, blocked) values ($1, $2)', [a, b]);
    await t.as(c);
    expect(await scalar('select public.can_see_profile($1)', [a])).toBe(true);
    expect(await scalar('select public.can_see_profile($1)', [b])).toBe(true);
    await t.as(b);
    expect(await scalar('select public.can_see_profile($1)', [a])).toBe(false);
  });
});

describe('only members who accepted the documents and the 18+ attestation take part', () => {
  async function stranger() {
    const uid = await t.newUser();
    await t.as(uid);
    return uid;
  }

  test('an account without acceptances reads no other profile', async () => {
    const a = await member(t);
    await stranger();
    expect(await visibleIds(t)).not.toContain(a);
  });

  test('an account without acceptances cannot report, block or upload a photo', async () => {
    const a = await member(t);
    const s = await stranger();
    await expect(
      t.db.query(`insert into reports (reporter, reported, context_type, reason) values ($1, $2, 'profile', 'spam')`, [s, a]),
    ).rejects.toThrow(/row-level security/);
    await expect(t.db.query('insert into blocks (blocker, blocked) values ($1, $2)', [s, a])).rejects.toThrow(/row-level security/);
    await expect(
      t.db.query(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${s}/avatar.webp`]),
    ).rejects.toThrow(/row-level security/);
  });

  test('an account without acceptances sees no avatar', async () => {
    const a = await member(t);
    await t.db.query(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${a}/avatar.webp`]);
    await stranger();
    const r = await t.db.query(`select 1 from storage.objects where name = $1`, [`${a}/avatar.webp`]);
    expect(r.rows).toEqual([]);
  });

  test('accepting the documents opens the community', async () => {
    const a = await member(t);
    const s = await stranger();
    await accept(t, s);
    expect(await visibleIds(t)).toContain(a);
  });
});

describe('suspensions are private', () => {
  test('members cannot read suspended_until, the owner gets it through my_suspension()', async () => {
    const a = await member(t);
    await suspend(t, a, '-1 day');
    await member(t);
    await expect(t.db.query('select suspended_until from profiles where id = $1', [a])).rejects.toThrow(/permission denied/);
    const r = await t.db.query<{ display_name: string }>('select display_name from profiles where id = $1', [a]);
    expect(r.rows).toHaveLength(1);
    const s = await member(t);
    await suspend(t, s);
    await t.as(s);
    expect(await scalar<string | null>('select public.my_suspension()')).not.toBeNull();
  });

  test('a suspended person still sees their own photo', async () => {
    const s = await member(t);
    await t.db.query(`insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${s}/avatar.webp`]);
    await suspend(t, s);
    await t.as(s);
    const r = await t.db.query(`select 1 from storage.objects where name = $1`, [`${s}/avatar.webp`]);
    expect(r.rows).toHaveLength(1);
  });
});

describe('moderators', () => {
  test('a suspended moderator cannot lift their own suspension, and nobody moderates themselves', async () => {
    const m = await moderator(t);
    const other = await moderator(t);
    await t.as(other);
    await t.db.query(`insert into moderation_actions (target, action, reason, until) values ($1, 'suspend', 'x', now() + interval '7 days')`, [m]);
    await t.as(m);
    await expect(t.db.query(`insert into moderation_actions (target, action, reason) values ($1, 'unsuspend', 'mine')`, [m])).rejects.toThrow(
      /row-level security/,
    );
    await t.as(other);
    await expect(t.db.query(`insert into moderation_actions (target, action, reason) values ($1, 'warn', 'self')`, [other])).rejects.toThrow(
      /row-level security/,
    );
  });

  test('a person reads the moderation actions about them, and only those', async () => {
    const a = await member(t);
    const b = await member(t);
    const m = await moderator(t);
    await t.as(m);
    await t.db.query(`insert into moderation_actions (target, action, reason) values ($1, 'warn', 'For A')`, [a]);
    await t.db.query(`insert into moderation_actions (target, action, reason) values ($1, 'warn', 'For B')`, [b]);
    await t.as(a);
    const r = await t.db.query<{ action: string; reason: string }>('select action, reason from public.my_moderation_actions()');
    expect(r.rows).toEqual([{ action: 'warn', reason: 'For A' }]);
  });
});

test('profile checks keep working when PUBLIC cannot execute functions', async () => {
  await t.owner(() =>
    t.db.exec(`revoke execute on function public.stack_tags_ok(text[]), public.availability_ok(jsonb) from public`),
  );
  const uid = await member(t);
  expect(await visibleIds(t)).toContain(uid);
});
