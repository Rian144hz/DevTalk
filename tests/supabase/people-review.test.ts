// 0007 — after the 2B.1 review: follow notices go with the follower's account, the daily limit counts
// notices sent, and only members with a profile can follow or like.
import { createDb } from './harness';
import type { TestDb } from './harness';
import { accept, member } from './people';

let t: TestDb;
beforeAll(async () => {
  t = await createDb();
}, 30_000);

const named = (name: string) => member(t, { display_name: name });
async function follow(a: string, b: string) {
  await t.as(a);
  await t.db.query('insert into follows (follower, followee) values ($1, $2)', [a, b]);
}
const ownerCount = (sql: string, params: unknown[]) =>
  t.owner(async () => (await t.db.query<{ n: number }>(sql, params)).rows[0]!.n);

test('deleting an account removes the follow notices it caused', async () => {
  const fan = await named('Fan Real Name');
  const star = await named('Star');
  await follow(fan, star);
  expect(await ownerCount(`select count(*)::int as n from notices where user_id = $1 and kind = 'follow'`, [star])).toBe(1);
  await t.owner(() => t.db.query('delete from auth.users where id = $1', [fan]));
  expect(await ownerCount(`select count(*)::int as n from notices where user_id = $1`, [star])).toBe(0);
});

test('following and unfollowing in a loop still hits the daily limit', async () => {
  const spammer = await named('Loop');
  const target = await named('Next one');
  // 200 follow notices sent today by this account, even though every follow was undone.
  await t.owner(async () => {
    const ids = (await t.db.query<{ id: string }>(`insert into auth.users (id) select gen_random_uuid() from generate_series(1, 200) returning id`)).rows;
    for (const { id } of ids) {
      await t.db.query(`insert into notices (user_id, kind, actor, message) values ($1, 'follow', $2, 'Loop followed you.')`, [id, spammer]);
    }
  });
  await expect(follow(spammer, target)).rejects.toThrow(/follow limit reached/);
});

test('an account that accepted the documents but has no profile cannot follow or like', async () => {
  const ghost = await t.newUser();
  await accept(t, ghost);
  const target = await named('Visible');
  await expect(follow(ghost, target)).rejects.toThrow(/row-level security/);
  await t.as(ghost);
  await expect(t.db.query('insert into profile_likes (liker, profile) values ($1, $2)', [ghost, target])).rejects.toThrow(/row-level security/);
});
