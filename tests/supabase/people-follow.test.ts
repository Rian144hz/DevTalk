// 0006 — follows, profile likes, the member list and the social readers.
import { createDb } from './harness';
import type { TestDb } from './harness';
import { member, suspend } from './people';

let t: TestDb;
beforeAll(async () => {
  t = await createDb();
}, 30_000);

const named = (name: string, over: Record<string, unknown> = {}) => member(t, { display_name: name, ...over });

async function follow(a: string, b: string) {
  await t.as(a);
  await t.db.query('insert into follows (follower, followee) values ($1, $2)', [a, b]);
}
async function like(a: string, b: string) {
  await t.as(a);
  await t.db.query('insert into profile_likes (liker, profile) values ($1, $2)', [a, b]);
}
async function block(a: string, b: string) {
  await t.as(a);
  await t.db.query('insert into blocks (blocker, blocked) values ($1, $2)', [a, b]);
}
interface Stats {
  followers: number;
  following: number;
  likes: number;
  i_follow: boolean;
  i_like: boolean;
}
async function stats(viewer: string, target: string): Promise<Stats> {
  await t.as(viewer);
  return (await t.db.query<Stats>('select * from public.profile_social($1)', [target])).rows[0]!;
}
async function names(sql: string, params: unknown[]): Promise<string[]> {
  return (await t.db.query<{ display_name: string }>(sql, params)).rows.map((r) => r.display_name);
}
const directory = (q: string | null, lvl: string | null = null, area: string | null = null, stack: string | null = null, page = 0) =>
  names('select display_name from public.member_directory($1, $2, $3, $4, $5)', [q, lvl, area, stack, page]);
const ownerCount = (sql: string, params: unknown[]) =>
  t.owner(async () => (await t.db.query<{ n: number }>(sql, params)).rows[0]!.n);

describe('following and liking', () => {
  test('members follow and unfollow with their own rows only', async () => {
    const a = await named('Ana');
    const b = await named('Bea');
    await follow(a, b);
    await t.as(b);
    await expect(t.db.query('insert into follows (follower, followee) values ($1, $2)', [a, b])).rejects.toThrow(/row-level security|duplicate/);
    await t.db.query('delete from follows where follower = $1 and followee = $2', [a, b]);
    expect(await ownerCount('select count(*)::int as n from follows where follower = $1', [a])).toBe(1);
    await t.as(a);
    await t.db.query('delete from follows where follower = $1 and followee = $2', [a, b]);
    expect(await ownerCount('select count(*)::int as n from follows where follower = $1', [a])).toBe(0);
  });

  test('nobody follows or likes themselves', async () => {
    const a = await named('Self');
    await expect(follow(a, a)).rejects.toThrow(/row-level security|check constraint/);
    await expect(like(a, a)).rejects.toThrow(/row-level security|check constraint/);
  });

  test('blocked (either way) or suspended members cannot be followed or liked', async () => {
    const a = await named('Al');
    const b = await named('Bo');
    const c = await named('Cy');
    await block(b, a);
    await expect(follow(a, b)).rejects.toThrow(/row-level security/);
    await expect(like(a, b)).rejects.toThrow(/row-level security/);
    await suspend(t, c);
    await expect(follow(a, c)).rejects.toThrow(/row-level security/);
    await expect(like(a, c)).rejects.toThrow(/row-level security/);
  });

  test('someone without a profile can neither follow nor be followed', async () => {
    const a = await named('Has profile');
    const ghost = await t.newUser();
    await expect(follow(ghost, a)).rejects.toThrow(/row-level security/);
    await expect(follow(a, ghost)).rejects.toThrow(/row-level security/);
  });

  test('members read only their own follow and like rows', async () => {
    const a = await named('Reader');
    const b = await named('Other');
    const c = await named('Third');
    await follow(b, c);
    await like(b, c);
    await follow(a, c);
    await t.as(a);
    expect((await t.db.query('select follower from follows')).rows).toEqual([{ follower: a }]);
    expect((await t.db.query('select liker from profile_likes')).rows).toEqual([]);
  });

  test('signed-out callers get nothing', async () => {
    const a = await named('Anon target');
    await t.as(null);
    for (const sql of [
      `select * from public.profile_social('${a}')`,
      `select * from public.member_directory(null, null, null, null, 0)`,
      `select * from public.followers_of('${a}', 0)`,
      `select * from public.following_of('${a}', 0)`,
      'select public.my_social_export()',
      'select * from follows',
      'select * from profile_likes',
    ]) {
      await expect(t.db.query(sql), sql).rejects.toThrow(/permission denied/);
    }
  });

  test('the 201st follow or like within 24 hours is refused', async () => {
    const a = await named('Busy');
    const target = await named('Target');
    await t.owner(async () => {
      const ids = (await t.db.query<{ id: string }>(`insert into auth.users (id) select gen_random_uuid() from generate_series(1, 200) returning id`)).rows;
      for (const { id } of ids) {
        await t.db.query('insert into follows (follower, followee) values ($1, $2)', [a, id]);
        await t.db.query('insert into profile_likes (liker, profile) values ($1, $2)', [a, id]);
      }
    });
    await expect(follow(a, target)).rejects.toThrow(/follow limit reached/);
    await expect(like(a, target)).rejects.toThrow(/like limit reached/);
    await t.owner(() => t.db.query(`update follows set created_at = now() - interval '25 hours' where follower = $1`, [a]));
    await follow(a, target);
  });
});

describe('follow notices', () => {
  test('a follow tells the person once a week at most', async () => {
    const a = await named('Sam');
    const b = await named('Kim');
    await follow(a, b);
    await t.as(b);
    expect((await t.db.query('select kind, actor, message from notices where user_id = $1', [b])).rows).toEqual([
      { kind: 'follow', actor: a, message: 'Sam followed you.' },
    ]);
    await t.as(a);
    await t.db.query('delete from follows where follower = $1 and followee = $2', [a, b]);
    await follow(a, b);
    expect(await ownerCount(`select count(*)::int as n from notices where user_id = $1 and kind = 'follow'`, [b])).toBe(1);
  });

  test('moderation notices keep their kind', async () => {
    const a = await named('Plain');
    await t.owner(() => t.db.query(`insert into notices (user_id, message) values ($1, 'Be kind.')`, [a]));
    await t.as(a);
    expect((await t.db.query('select kind, actor from notices where user_id = $1', [a])).rows).toEqual([{ kind: 'moderation', actor: null }]);
  });
});

describe('blocks and counts', () => {
  test('blocking ends follows and likes in both directions', async () => {
    const a = await named('Uno');
    const b = await named('Dos');
    await follow(a, b);
    await follow(b, a);
    await like(a, b);
    await like(b, a);
    await block(b, a);
    expect(await ownerCount('select count(*)::int as n from follows where $1 in (follower, followee)', [a])).toBe(0);
    expect(await ownerCount('select count(*)::int as n from profile_likes where $1 in (liker, profile)', [a])).toBe(0);
  });

  test('counts leave out suspended people and people blocked by the viewer', async () => {
    const x = await named('Star');
    const [f1, f2, f3] = [await named('F1'), await named('F2'), await named('F3')];
    const v = await named('Viewer');
    for (const f of [f1, f2, f3]) {
      await follow(f, x);
      await like(f, x);
    }
    await follow(x, f1);
    await follow(v, x);
    expect(await stats(v, x)).toEqual({ followers: 4, following: 1, likes: 3, i_follow: true, i_like: false });
    await suspend(t, f3);
    await block(v, f2);
    expect(await stats(v, x)).toEqual({ followers: 2, following: 1, likes: 1, i_follow: true, i_like: false });
    expect((await stats(x, x)).followers).toBe(3);
  });

  test('a profile the caller cannot see has zero counts', async () => {
    const a = await named('Hidden from me');
    const b = await named('Fan');
    const v = await named('Looker');
    await follow(b, a);
    await block(a, v);
    expect(await stats(v, a)).toEqual({ followers: 0, following: 0, likes: 0, i_follow: false, i_like: false });
  });

  test('follower lists leave out suspended people and people blocked by the caller', async () => {
    const x = await named('Popular');
    const [ok, blockedByMe, suspended] = [await named('Kept'), await named('Blocked one'), await named('Away')];
    const v = await named('Lister');
    for (const f of [ok, blockedByMe, suspended]) await follow(f, x);
    await suspend(t, suspended);
    await block(v, blockedByMe);
    await t.as(v);
    expect(await names('select display_name from public.followers_of($1, 0)', [x])).toEqual(['Kept']);
    await t.as(ok);
    expect(await names('select display_name from public.following_of($1, 0)', [ok])).toEqual(['Popular']);
  });
});

describe('member list', () => {
  test('filters, order by level distance, and who is left out', async () => {
    const v = await named('Dir Viewer', { level: 'B1' });
    await named('Dir Ana', { level: 'A2', area: 'backend', stack: ['python'] });
    await named('Dir Bia', { level: 'B1', area: 'frontend', stack: ['React'] });
    await named('Dir Caio', { level: 'B2', area: 'data', stack: ['Python'] });
    await named('Dir Dani', { level: 'C1', area: 'devops', stack: [] });
    await named('Dir Edu', { listed: false });
    const fabi = await named('Dir Fabi');
    const gil = await named('Dir Gil');
    await suspend(t, fabi);
    await block(v, gil);
    await t.as(v);
    expect(await directory('Dir')).toEqual(['Dir Bia', 'Dir Ana', 'Dir Caio', 'Dir Dani']);
    expect(await directory('dir', 'B2')).toEqual(['Dir Caio']);
    expect(await directory('Dir', null, 'frontend')).toEqual(['Dir Bia']);
    expect(await directory('Dir', null, null, 'PYTHON')).toEqual(['Dir Ana', 'Dir Caio']);
    expect(await directory('Dir Edu')).toEqual([]);
  });

  test('search text is taken literally', async () => {
    const v = await named('Lit Viewer');
    await named('Lit 100% Zed');
    await named('Lit a_b');
    await named('Lit axb');
    await t.as(v);
    expect(await directory('100%')).toEqual(['Lit 100% Zed']);
    expect(await directory('a_b')).toEqual(['Lit a_b']);
    expect(await directory('%')).toEqual(['Lit 100% Zed']);
  });

  test('pages of 30; a negative page is the first, a huge one is empty', async () => {
    const v = await named('Pg Viewer');
    for (let i = 0; i < 31; i++) await named(`Pg ${String(i).padStart(2, '0')}`);
    await t.as(v);
    expect(await directory('Pg ', null, null, null, 0)).toHaveLength(30);
    expect(await directory('Pg ', null, null, null, 1)).toEqual(['Pg 30']);
    expect(await directory('Pg ', null, null, null, -1)).toHaveLength(30);
    expect(await directory('Pg ', null, null, null, 10000)).toEqual([]);
  });

  test('someone off the list still shows in follower lists and keeps a readable profile', async () => {
    const shy = await named('Shy', { listed: false });
    const x = await named('Followed');
    const v = await named('Visitor');
    await follow(shy, x);
    await t.as(v);
    expect(await names('select display_name from public.followers_of($1, 0)', [x])).toEqual(['Shy']);
    expect((await t.db.query('select display_name from profiles where id = $1', [shy])).rows).toEqual([{ display_name: 'Shy' }]);
  });

  test('the listed switch is the owner\'s to change', async () => {
    const a = await named('Switcher');
    await t.as(a);
    await t.db.query('update profiles set listed = false where id = $1', [a]);
    expect((await t.db.query('select listed from profiles where id = $1', [a])).rows).toEqual([{ listed: false }]);
  });
});

describe('export', () => {
  test('my_social_export returns only the caller\'s own ties', async () => {
    const a = await named('Exporter');
    const b = await named('Friend');
    const c = await named('Stranger');
    const d = await named('Stranger 2');
    await follow(a, b);
    await follow(c, a);
    await like(a, b);
    await follow(c, d);
    await t.as(a);
    const x = (await t.db.query<{ x: { following: { id: string }[]; followers: { id: string }[]; likesGiven: { id: string }[] } }>(
      'select public.my_social_export() as x',
    )).rows[0]!.x;
    expect(x.following.map((r) => r.id)).toEqual([b]);
    expect(x.followers.map((r) => r.id)).toEqual([c]);
    expect(x.likesGiven.map((r) => r.id)).toEqual([b]);
  });
});
