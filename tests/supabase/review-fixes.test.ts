// 0005 — after review: when someone practised stays private; exports carry badges and progress.
import { createDb } from './harness';
import type { TestDb } from './harness';
import { member, moderator } from './people';

let t: TestDb;
beforeAll(async () => {
  t = await createDb();
}, 30_000);

async function practised(uid: string) {
  await t.as(uid);
  await t.db.query(`insert into practice_days (user_id, day, answers, reviews) values ($1, current_date - 1, 2, 5)`, [uid]);
  await t.db.query(`insert into milestones (user_id, kind, value) values ($1, 'vocabulary', '50')`, [uid]);
}

describe('practice times', () => {
  test('other members read the numbers of practice days and milestones, never their times', async () => {
    const a = await member(t);
    const b = await member(t);
    await practised(a);
    await t.as(b);
    expect((await t.db.query('select day is not null as d, answers, reviews from practice_days where user_id = $1', [a])).rows)
      .toEqual([{ d: true, answers: 2, reviews: 5 }]);
    expect((await t.db.query('select kind, value from milestones where user_id = $1', [a])).rows).toEqual([{ kind: 'vocabulary', value: '50' }]);
    await expect(t.db.query('select updated_at from practice_days where user_id = $1', [a])).rejects.toThrow(/permission denied/);
    await expect(t.db.query('select * from practice_days where user_id = $1', [a])).rejects.toThrow(/permission denied/);
    await expect(t.db.query('select achieved_at from milestones where user_id = $1', [a])).rejects.toThrow(/permission denied/);
  });

  test('the owner still upserts days and milestones the way the app does', async () => {
    const a = await member(t);
    await t.as(a);
    const upsert = `insert into practice_days (user_id, day, answers, reviews) values ($1, current_date, 1, 0)
      on conflict (user_id, day) do update set user_id = excluded.user_id, day = excluded.day, answers = excluded.answers, reviews = excluded.reviews`;
    await t.db.query(upsert, [a]);
    await t.db.query(upsert.replace('1, 0)', '3, 4)'), [a]);
    expect((await t.db.query('select answers, reviews from practice_days where user_id = $1', [a])).rows).toEqual([{ answers: 3, reviews: 4 }]);
    const milestone = `insert into milestones (user_id, kind, value) values ($1, 'vocabulary', '50') on conflict (user_id, kind, value) do nothing`;
    await t.db.query(milestone, [a]);
    await t.db.query(milestone, [a]);
    expect((await t.db.query('select count(*)::int as n from milestones where user_id = $1', [a])).rows).toEqual([{ n: 1 }]);
  });
});

describe('exports', () => {
  test('my_progress_export gives the caller their own days and milestones with times, nobody else\'s', async () => {
    const a = await member(t);
    const b = await member(t);
    await practised(a);
    await practised(b);
    await t.as(a);
    const r = (await t.db.query<{ x: { practiceDays: { day: string; answers: number; updatedAt: string }[]; milestones: { kind: string; achievedAt: string }[] } }>(
      'select public.my_progress_export() as x',
    )).rows[0]!.x;
    expect(r.practiceDays).toHaveLength(1);
    expect(r.practiceDays[0]).toMatchObject({ answers: 2, reviews: 5 });
    expect(typeof r.practiceDays[0]!.updatedAt).toBe('string');
    expect(r.milestones).toEqual([expect.objectContaining({ kind: 'vocabulary', value: '50' })]);
  });

  test('my_moderation_actions says which badge was given', async () => {
    const mod = await moderator(t);
    const a = await member(t);
    await t.as(mod);
    await t.db.query(`insert into moderation_actions (target, action, badge, reason) values ($1, 'grant_badge', 'mentor', 'Helps')`, [a]);
    await t.as(a);
    expect((await t.db.query('select action, badge, reason from public.my_moderation_actions()')).rows).toEqual([
      { action: 'grant_badge', badge: 'mentor', reason: 'Helps' },
    ]);
  });

  test('signed-out callers cannot run the export', async () => {
    await t.as(null);
    await expect(t.db.query('select public.my_progress_export()')).rejects.toThrow(/permission denied/);
  });
});
