// 0004 — badges, practice days, milestones, badge moderation and banners.
import { createDb } from './harness';
import type { TestDb } from './harness';
import { member, moderator, suspend } from './people';

let t: TestDb;
beforeAll(async () => {
  t = await createDb();
}, 30_000);

const SP_TODAY = `((now() at time zone 'America/Sao_Paulo')::date)`;

async function owner<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return t.owner(() => t.db.query<T>(sql, params));
}
async function badgeIds(target: string): Promise<string[]> {
  return (await t.db.query<{ id: string }>('select id from public.profile_badges($1)', [target])).rows.map((r) => r.id);
}
/** `n` active days ending `endOffset` days before today (São Paulo), written by the owner. */
async function activeDays(uid: string, n: number, endOffset = 1) {
  await t.as(uid);
  await t.db.query(
    `insert into practice_days (user_id, day, answers) select $1, ${SP_TODAY} - g, 1 from generate_series($2::int, $3::int) g`,
    [uid, endOffset, endOffset + n - 1],
  );
}
async function setProfile(uid: string, sets: string, params: unknown[] = []) {
  await owner(`update profiles set ${sets} where id = $1`, [uid, ...params]);
}

describe('profile columns', () => {
  test('the owner sets main stack, mascot, progress switch and banner path', async () => {
    const a = await member(t, { stack: ['python', 'java'] });
    await t.db.query(
      `update profiles set main_stack = '{python}', mascot = 'axolotl-2', show_progress = false, banner_path = $1 || '/banner.gif' where id = $1`,
      [a],
    );
    const r = await t.db.query('select main_stack, mascot, show_progress, banner_path from profiles where id = $1', [a]);
    expect(r.rows).toEqual([{ main_stack: ['python'], mascot: 'axolotl-2', show_progress: false, banner_path: `${a}/banner.gif` }]);
  });

  test('main stack: at most two and only from the stack; mascot and banner path are checked', async () => {
    const a = await member(t, { stack: ['python', 'java', 'go'] });
    for (const sets of [`main_stack = '{python,java,go}'`, `main_stack = '{rust}'`, `mascot = 'cat-1'`, `banner_path = 'x/banner.gif'`, `banner_path = $1 || '/banner.png'`]) {
      await expect(t.db.query(`update profiles set ${sets} where id = $1`, [a])).rejects.toThrow(/check constraint/);
    }
  });
});

describe('practice days', () => {
  test('the owner writes their own days, within range and limits', async () => {
    const a = await member(t);
    const b = await member(t);
    await t.as(a);
    await t.db.query(`insert into practice_days (user_id, day, answers, reviews) values ($1, current_date, 2, 15)`, [a]);
    await t.db.query(
      `insert into practice_days (user_id, day, answers, reviews) values ($1, current_date, 3, 15) on conflict (user_id, day) do update set answers = excluded.answers`,
      [a],
    );
    expect((await t.db.query('select answers from practice_days where user_id = $1', [a])).rows).toEqual([{ answers: 3 }]);
    await expect(t.db.query(`insert into practice_days (user_id, day) values ($1, current_date)`, [b])).rejects.toThrow(/row-level security/);
    await expect(t.db.query(`insert into practice_days (user_id, day) values ($1, current_date - 401)`, [a])).rejects.toThrow(/row-level security/);
    await expect(t.db.query(`insert into practice_days (user_id, day) values ($1, current_date + 2)`, [a])).rejects.toThrow(/row-level security/);
    await expect(t.db.query(`insert into practice_days (user_id, day, answers) values ($1, current_date - 3, 501)`, [a])).rejects.toThrow(/check constraint/);
  });

  test('others read them only while the owner shows progress and is visible', async () => {
    const a = await member(t);
    await activeDays(a, 2);
    const b = await member(t);
    const days = async () => (await t.db.query('select day from practice_days where user_id = $1', [a])).rows.length;
    expect(await days()).toBe(2);
    await setProfile(a, 'show_progress = false');
    await t.as(b);
    expect(await days()).toBe(0);
    await t.as(a);
    expect(await days()).toBe(2);
    await setProfile(a, 'show_progress = true');
    await t.as(b);
    await t.db.query('insert into blocks (blocker, blocked) values ($1, $2)', [b, a]);
    expect(await days()).toBe(0);
  });

  test('a suspended owner hides their days from others', async () => {
    const a = await member(t);
    await activeDays(a, 1);
    await suspend(t, a);
    await member(t);
    expect((await t.db.query('select 1 from practice_days where user_id = $1', [a])).rows).toEqual([]);
  });
});

describe('milestones', () => {
  test('only valid level jumps and vocabulary tiers, never updated', async () => {
    const a = await member(t);
    const ins = (kind: string, value: string) => t.db.query(`insert into milestones (user_id, kind, value) values ($1, $2, $3)`, [a, kind, value]);
    await ins('level_up', 'B1>B2');
    await ins('level_up', 'B1>C1');
    await ins('vocabulary', '50');
    for (const [k, v] of [['level_up', 'B2>B1'], ['level_up', 'B1>B1'], ['level_up', 'B1>X9'], ['vocabulary', '75'], ['streak', '7']]) {
      await expect(ins(k!, v!)).rejects.toThrow(/check constraint/);
    }
    await expect(t.db.query(`update milestones set value = '100' where user_id = $1`, [a])).rejects.toThrow(/permission denied/);
  });
});

describe('badge moderation', () => {
  test('members cannot write badge grants', async () => {
    const a = await member(t);
    await expect(t.db.query(`insert into badge_grants (user_id, badge) values ($1, 'mentor')`, [a])).rejects.toThrow(/permission denied/);
    await expect(t.db.query(`insert into moderation_actions (target, action, badge, reason) values ($1, 'grant_badge', 'mentor', 'x')`, [a])).rejects.toThrow(
      /row-level security/,
    );
  });

  test('a moderator grants and revokes; the person gets a notice', async () => {
    const a = await member(t);
    const m = await moderator(t);
    await t.as(m);
    await t.db.query(`insert into moderation_actions (target, action, badge, reason) values ($1, 'grant_badge', 'mentor', 'Helps a lot')`, [a]);
    expect(await badgeIds(a)).toContain('mentor');
    await t.as(a);
    expect((await t.db.query<{ message: string }>('select message from notices')).rows.map((r) => r.message)).toContain('You received the Mentor badge.');
    await t.as(m);
    await t.db.query(`insert into moderation_actions (target, action, badge, reason) values ($1, 'revoke_badge', 'mentor', 'By mistake')`, [a]);
    expect(await badgeIds(a)).not.toContain('mentor');
  });

  test('no granting to oneself, no Creator, and a badge action needs a badge', async () => {
    const a = await member(t);
    const m = await moderator(t);
    await t.as(m);
    await expect(t.db.query(`insert into moderation_actions (target, action, badge, reason) values ($1, 'grant_badge', 'mentor', 'x')`, [m])).rejects.toThrow(
      /row-level security/,
    );
    await expect(t.db.query(`insert into moderation_actions (target, action, badge, reason) values ($1, 'grant_badge', 'creator', 'x')`, [a])).rejects.toThrow(
      /check constraint/,
    );
    await expect(t.db.query(`insert into moderation_actions (target, action, reason) values ($1, 'grant_badge', 'x')`, [a])).rejects.toThrow(/check constraint/);
    await expect(t.db.query(`insert into moderation_actions (target, action, badge, reason) values ($1, 'warn', 'mentor', 'x')`, [a])).rejects.toThrow(
      /check constraint/,
    );
  });
});

describe('profile_badges', () => {
  test('automatic community, technical and language badges', async () => {
    const m = await moderator(t);
    await setProfile(m, `stack = '{python,java}', main_stack = '{python}', uses_linux = true, area = 'backend'`);
    await owner(`insert into badge_grants (user_id, badge) values ($1, 'creator')`, [m]);
    await t.as(m);
    const rows = (await t.db.query<{ id: string; grp: string; label: string }>('select id, grp, label from public.profile_badges($1)', [m])).rows;
    expect(rows).toEqual([
      { id: 'creator', grp: 'community', label: 'Creator' },
      { id: 'moderator', grp: 'community', label: 'Moderator' },
      { id: 'founding_member', grp: 'community', label: 'Founding member' },
      { id: 'area:backend', grp: 'technical', label: 'Back end' },
      { id: 'linux', grp: 'technical', label: 'Linux native' },
      { id: 'lang:python', grp: 'language', label: 'python' },
    ]);
  });

  test('no founding badge after the cutoff, no area badge for other', async () => {
    const a = await member(t, { area: 'other' });
    await setProfile(a, `created_at = '2027-01-02T12:00:00Z'`);
    await t.as(a);
    expect(await badgeIds(a)).toEqual([]);
  });

  test('streaks in the profile time zone: 7 days ending yesterday, then 30', async () => {
    const a = await member(t, { timezone: 'America/Sao_Paulo' });
    await activeDays(a, 7, 1);
    expect(await badgeIds(a)).toContain('streak_7');
    const s = (await t.db.query<{ current: number; longest: number }>('select * from public.practice_streaks($1)', [a])).rows[0];
    expect(s).toEqual({ current: 7, longest: 7 });
    await activeDays(a, 23, 8);
    const ids = await badgeIds(a);
    expect(ids).toContain('streak_30');
    expect(ids).not.toContain('streak_7');
  });

  test('a gap of two days ends the current streak', async () => {
    const a = await member(t, { timezone: 'America/Sao_Paulo' });
    await activeDays(a, 7, 2);
    expect(await badgeIds(a)).not.toContain('streak_7');
    expect((await t.db.query('select * from public.practice_streaks($1)', [a])).rows[0]).toEqual({ current: 0, longest: 7 });
  });

  test('latest level jump and the highest vocabulary tier', async () => {
    const a = await member(t);
    await owner(`insert into milestones (user_id, kind, value, achieved_at) values ($1, 'level_up', 'A2>B1', now() - interval '30 days')`, [a]);
    await t.db.query(`insert into milestones (user_id, kind, value) values ($1, 'level_up', 'B1>B2'), ($1, 'vocabulary', '50'), ($1, 'vocabulary', '100')`, [a]);
    const rows = (await t.db.query<{ id: string; label: string; detail: string }>(`select id, label, detail from public.profile_badges($1) where grp = 'evolution'`, [a])).rows;
    expect(rows).toEqual([
      { id: 'level_up', label: 'B1 → B2', detail: 'B1>B2' },
      { id: 'vocabulary', label: 'Vocabulary hunter', detail: '100+' },
    ]);
  });

  test('hidden progress removes evolution badges and streaks for others, not for the owner', async () => {
    const a = await member(t, { timezone: 'America/Sao_Paulo' });
    await activeDays(a, 7, 1);
    await t.db.query(`insert into milestones (user_id, kind, value) values ($1, 'vocabulary', '50')`, [a]);
    await setProfile(a, 'show_progress = false');
    const b = await member(t);
    await t.as(b);
    expect(await badgeIds(a)).not.toContain('streak_7');
    expect(await badgeIds(a)).not.toContain('vocabulary');
    expect((await t.db.query('select * from public.practice_streaks($1)', [a])).rows).toEqual([]);
    expect((await t.db.query('select 1 from milestones where user_id = $1', [a])).rows).toEqual([]);
    await t.as(a);
    expect(await badgeIds(a)).toEqual(expect.arrayContaining(['streak_7', 'vocabulary']));
  });

  test('nothing for someone the caller cannot see', async () => {
    const a = await member(t);
    const b = await member(t);
    await t.as(a);
    await t.db.query('insert into blocks (blocker, blocked) values ($1, $2)', [a, b]);
    await t.as(b);
    expect(await badgeIds(a)).toEqual([]);
  });
});

describe('banners bucket', () => {
  test('private, GIF or WebP only, 2 MB', async () => {
    const r = await owner<{ public: boolean; file_size_limit: number; allowed_mime_types: string[] }>(
      `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'banners'`,
    );
    expect(r.rows).toEqual([{ public: false, file_size_limit: 2097152, allowed_mime_types: ['image/gif', 'image/webp'] }]);
  });

  test('own folder only, banner.gif or banner.webp only; blocked pairs cannot read', async () => {
    const a = await member(t);
    const b = await member(t);
    await t.as(a);
    await t.db.query(`insert into storage.objects (bucket_id, name) values ('banners', $1)`, [`${a}/banner.gif`]);
    await expect(t.db.query(`insert into storage.objects (bucket_id, name) values ('banners', $1)`, [`${a}/other.gif`])).rejects.toThrow(/row-level security/);
    await expect(t.db.query(`insert into storage.objects (bucket_id, name) values ('banners', $1)`, [`${b}/banner.gif`])).rejects.toThrow(/row-level security/);
    await t.as(b);
    const see = async () => (await t.db.query(`select 1 from storage.objects where bucket_id = 'banners' and name = $1`, [`${a}/banner.gif`])).rows.length;
    expect(await see()).toBe(1);
    await t.db.query('insert into blocks (blocker, blocked) values ($1, $2)', [b, a]);
    expect(await see()).toBe(0);
  });
});
