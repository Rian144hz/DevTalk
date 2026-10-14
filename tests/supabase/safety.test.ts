import { createDb } from './harness';
import type { TestDb } from './harness';
import { member, moderator, suspend, visibleIds } from './people';

let t: TestDb;
beforeAll(async () => {
  t = await createDb();
}, 30_000);

async function report(reporter: string, reported: string, reason = 'spam') {
  await t.as(reporter);
  const r = await t.db.query<{ id: number }>(
    `insert into reports (reporter, reported, context_type, reason, details) values ($1, $2, 'profile', $3, 'details') returning id`,
    [reporter, reported, reason],
  );
  return r.rows[0]!.id;
}

async function asOwnerQuery<T>(sql: string, params: unknown[] = []) {
  return t.owner(() => t.db.query<T>(sql, params));
}

describe('blocks', () => {
  test('a block hides profiles in both directions and unblocking restores them', async () => {
    const a = await member(t);
    const b = await member(t);
    await t.as(a);
    await t.db.query('insert into blocks (blocker, blocked) values ($1, $2)', [a, b]);
    expect(await visibleIds(t)).not.toContain(b);
    await t.as(b);
    expect(await visibleIds(t)).not.toContain(a);
    await t.as(a);
    await t.db.query('delete from blocks where blocker = $1 and blocked = $2', [a, b]);
    expect(await visibleIds(t)).toContain(b);
    await t.as(b);
    expect(await visibleIds(t)).toContain(a);
  });

  test('only the blocker can list or remove a block', async () => {
    const a = await member(t);
    const b = await member(t);
    await t.as(a);
    await t.db.query('insert into blocks (blocker, blocked) values ($1, $2)', [a, b]);
    await t.as(b);
    expect((await t.db.query('select * from blocks')).rows).toEqual([]);
    expect((await t.db.query('delete from blocks where blocker = $1', [a])).affectedRows).toBe(0);
    await t.as(a);
    expect((await t.db.query('select blocked from blocks')).rows).toEqual([{ blocked: b }]);
  });

  test('nobody can block on behalf of someone else or block themselves', async () => {
    const a = await member(t);
    const b = await member(t);
    const c = await member(t);
    await expect(t.db.query('insert into blocks (blocker, blocked) values ($1, $2)', [a, b])).rejects.toThrow(/row-level security/);
    await expect(t.db.query('insert into blocks (blocker, blocked) values ($1, $1)', [c])).rejects.toThrow(/check constraint/);
  });
});

describe('reports', () => {
  test('nobody can report themselves', async () => {
    const a = await member(t);
    await expect(report(a, a)).rejects.toThrow(/row-level security|check constraint/);
  });

  test('a suspended user cannot report', async () => {
    const a = await member(t);
    const b = await member(t);
    await suspend(t, a);
    await expect(report(a, b)).rejects.toThrow(/row-level security/);
  });

  test('a reporter cannot set the status of a new report', async () => {
    const a = await member(t);
    const b = await member(t);
    await t.as(a);
    await expect(
      t.db.query(`insert into reports (reporter, reported, context_type, reason, status) values ($1, $2, 'profile', 'spam', 'actioned')`, [a, b]),
    ).rejects.toThrow(/permission denied/);
  });

  test('the 21st report within 24 hours is refused', async () => {
    const a = await member(t);
    const b = await member(t);
    for (let i = 0; i < 20; i++) await report(a, b);
    await expect(report(a, b)).rejects.toThrow(/report limit/);
  });

  test('a reporter sees only their own reports', async () => {
    const a = await member(t);
    const b = await member(t);
    const c = await member(t);
    const mine = await report(a, c);
    await report(b, c);
    await t.as(a);
    const rows = (await t.db.query<{ id: number }>('select id from reports')).rows;
    expect(rows).toEqual([{ id: mine }]);
  });

  test('reports about a deleted user stay, with the reported person removed', async () => {
    const a = await member(t);
    const b = await member(t);
    const id = await report(a, b);
    await asOwnerQuery('delete from auth.users where id = $1', [b]);
    const r = await asOwnerQuery<{ reported: string | null }>('select reported from reports where id = $1', [id]);
    expect(r.rows).toEqual([{ reported: null }]);
  });
});

describe('moderation', () => {
  test('a non-moderator cannot read others reports, resolve reports, act, or become a moderator', async () => {
    const a = await member(t);
    const b = await member(t);
    const id = await report(a, b);
    const c = await member(t);
    expect((await t.db.query('select * from reports')).rows).toEqual([]);
    expect((await t.db.query(`update reports set status = 'dismissed' where id = $1`, [id])).affectedRows).toBe(0);
    await expect(
      t.db.query(`insert into moderation_actions (target, action, reason, until) values ($1, 'suspend', 'x', now() + interval '1 day')`, [b]),
    ).rejects.toThrow(/row-level security/);
    await expect(t.db.query('insert into moderators (user_id) values ($1)', [c])).rejects.toThrow(/permission denied/);
    expect((await t.db.query<{ m: boolean }>('select public.is_moderator() as m')).rows).toEqual([{ m: false }]);
  });

  test('a moderator sees all open reports and suspended profiles', async () => {
    const a = await member(t);
    const b = await member(t);
    const id = await report(a, b);
    await suspend(t, b);
    const m = await moderator(t);
    await t.as(m);
    expect((await t.db.query<{ id: number }>('select id from reports')).rows.map((r) => r.id)).toContain(id);
    expect(await visibleIds(t)).toContain(b);
    expect((await t.db.query<{ m: boolean }>('select public.is_moderator() as m')).rows).toEqual([{ m: true }]);
  });

  test('a moderator can change only the status of a report', async () => {
    const a = await member(t);
    const b = await member(t);
    const id = await report(a, b);
    const m = await moderator(t);
    await t.as(m);
    await expect(t.db.query(`update reports set details = 'edited' where id = $1`, [id])).rejects.toThrow(/permission denied/);
  });

  test('dismissing a report records who resolved it and when', async () => {
    const a = await member(t);
    const b = await member(t);
    const id = await report(a, b);
    const m = await moderator(t);
    await t.as(m);
    await t.db.query(`update reports set status = 'dismissed' where id = $1`, [id]);
    const r = await t.db.query<{ status: string; resolved_by: string; resolved: boolean }>(
      'select status, resolved_by, resolved_at is not null as resolved from reports where id = $1',
      [id],
    );
    expect(r.rows).toEqual([{ status: 'dismissed', resolved_by: m, resolved: true }]);
  });

  test('a warning creates a notice for the person and closes the report', async () => {
    const a = await member(t);
    const b = await member(t);
    const id = await report(a, b);
    const m = await moderator(t);
    await t.as(m);
    await t.db.query(`insert into moderation_actions (target, action, reason, report_id) values ($1, 'warn', 'Please be kind.', $2)`, [b, id]);
    const status = await t.db.query<{ status: string }>('select status from reports where id = $1', [id]);
    expect(status.rows).toEqual([{ status: 'actioned' }]);
    await t.as(b);
    const notes = await t.db.query<{ message: string }>('select message from notices');
    expect(notes.rows).toEqual([{ message: 'Please be kind.' }]);
  });

  test('a 7-day suspension hides the person until a moderator lifts it', async () => {
    const a = await member(t);
    const b = await member(t);
    const m = await moderator(t);
    await t.as(m);
    await t.db.query(`insert into moderation_actions (target, action, reason, until) values ($1, 'suspend', 'spam', now() + interval '7 days')`, [b]);
    const s = await asOwnerQuery<{ days: number }>(
      `select round(extract(epoch from suspended_until - now()) / 86400) as days from profiles where id = $1`,
      [b],
    );
    expect(Number(s.rows[0]!.days)).toBe(7);
    await t.as(a);
    expect(await visibleIds(t)).not.toContain(b);
    await t.as(m);
    await t.db.query(`insert into moderation_actions (target, action, reason) values ($1, 'unsuspend', 'appeal accepted')`, [b]);
    await t.as(a);
    expect(await visibleIds(t)).toContain(b);
  });

  test('a permanent suspension never ends', async () => {
    const b = await member(t);
    const m = await moderator(t);
    await t.as(m);
    await t.db.query(`insert into moderation_actions (target, action, reason, until) values ($1, 'suspend', 'hate', 'infinity')`, [b]);
    const s = await asOwnerQuery<{ forever: boolean }>(`select suspended_until = 'infinity' as forever from profiles where id = $1`, [b]);
    expect(s.rows).toEqual([{ forever: true }]);
  });

  test('a suspension needs an end date and other actions must not have one', async () => {
    const b = await member(t);
    const m = await moderator(t);
    await t.as(m);
    await expect(t.db.query(`insert into moderation_actions (target, action, reason) values ($1, 'suspend', 'x')`, [b])).rejects.toThrow(
      /check constraint/,
    );
    await expect(
      t.db.query(`insert into moderation_actions (target, action, reason, until) values ($1, 'warn', 'x', now())`, [b]),
    ).rejects.toThrow(/check constraint/);
  });
});

describe('notices', () => {
  test('a person reads and marks only their own notices', async () => {
    const a = await member(t);
    const b = await member(t);
    const m = await moderator(t);
    await t.as(m);
    await t.db.query(`insert into moderation_actions (target, action, reason) values ($1, 'warn', 'Note for A')`, [a]);
    await t.as(b);
    expect((await t.db.query('select * from notices')).rows).toEqual([]);
    expect((await t.db.query('update notices set read_at = now()')).affectedRows).toBe(0);
    await t.as(a);
    expect((await t.db.query('update notices set read_at = now()')).affectedRows).toBe(1);
    await expect(t.db.query(`update notices set message = 'changed'`)).rejects.toThrow(/permission denied/);
  });
});
