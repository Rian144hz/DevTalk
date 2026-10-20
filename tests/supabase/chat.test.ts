// 0008 — private chat: requests, messages, corrections, reads, report context and the practice graph.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createDb, migrationFiles } from './harness';
import type { TestDb } from './harness';
import { accept, member, moderator, suspend } from './people';

let t: TestDb;
beforeAll(async () => {
  t = await createDb();
}, 30_000);

const named = (name: string, over: Record<string, unknown> = {}) => member(t, { display_name: name, ...over });

async function request(from: string, to: string, body = 'Hi! Can we practise together?'): Promise<string> {
  await t.as(from);
  return (await t.db.query<{ id: string }>('select public.request_conversation($1, $2) as id', [to, body])).rows[0]!.id;
}
async function respond(who: string, conversation: string, ok: boolean) {
  await t.as(who);
  await t.db.query('select public.respond_conversation($1, $2)', [conversation, ok]);
}
/** A accepted conversation between two new members; leaves the session as `a`. */
async function pair(aName = 'Ana', bName = 'Bia') {
  const a = await named(aName);
  const b = await named(bName);
  const c = await request(a, b);
  await respond(b, c, true);
  await t.as(a);
  return { a, b, c };
}
async function send(who: string, conversation: string, body: string): Promise<number> {
  await t.as(who);
  const r = await t.db.query<{ id: number }>(
    'insert into messages (conversation_id, sender, body) values ($1, $2, $3) returning id',
    [conversation, who, body],
  );
  return Number(r.rows[0]!.id);
}
async function correct(who: string, message: number, corrected: string): Promise<number> {
  await t.as(who);
  const r = await t.db.query<{ id: number }>(
    'insert into corrections (message_id, author, corrected) values ($1, $2, $3) returning id',
    [message, who, corrected],
  );
  return Number(r.rows[0]!.id);
}
async function rows<T = Record<string, unknown>>(who: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await t.as(who);
  return (await t.db.query<T>(sql, params)).rows;
}
const owner = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  t.owner(async () => (await t.db.query<T>(sql, params)).rows);
const count = async (sql: string, params: unknown[] = []) => (await owner<{ n: number }>(sql, params))[0]!.n;
interface Summary {
  id: string;
  other_id: string;
  other_name: string;
  status: string;
  requested_by_me: boolean;
  preview: string | null;
  unread: number;
}
const mine = (who: string) => rows<Summary>(who, 'select * from public.my_conversations()');

describe('requests', () => {
  test('a request creates a pending conversation with the first message, seen only by the two', async () => {
    const a = await named('Ana');
    const b = await named('Bia');
    const third = await named('Caio');
    const mod = await moderator(t);
    const c = await request(a, b, 'Hi Bia!');
    for (const who of [a, b]) {
      expect(await rows(who, 'select status from conversations where id = $1', [c])).toEqual([{ status: 'pending' }]);
      expect(await rows(who, 'select body from messages where conversation_id = $1', [c])).toEqual([{ body: 'Hi Bia!' }]);
    }
    for (const who of [third, mod]) {
      expect(await rows(who, 'select id from conversations')).toEqual([]);
      expect(await rows(who, 'select id from messages')).toEqual([]);
      expect(await rows(who, 'select id from corrections')).toEqual([]);
      expect(await mine(who)).toEqual([]);
    }
    await t.as(null);
    for (const sql of [
      'select * from conversations',
      'select * from messages',
      'select * from corrections',
      'select * from public.my_conversations()',
      `select public.request_conversation('${b}', 'hi')`,
      'select * from public.report_context(1)',
    ]) {
      await expect(t.db.query(sql), sql).rejects.toThrow(/permission denied/);
    }
  });

  test('a suspended participant reads nothing', async () => {
    const { a, c } = await pair();
    await suspend(t, a);
    expect(await rows(a, 'select id from conversations where id = $1', [c])).toEqual([]);
    expect(await rows(a, 'select id from messages where conversation_id = $1', [c])).toEqual([]);
    expect(await mine(a)).toEqual([]);
  });

  test('only the recipient accepts or declines, and only while pending', async () => {
    const a = await named('Ana');
    const b = await named('Bia');
    const c = await request(a, b);
    await expect(respond(a, c, true)).rejects.toThrow(/not allowed/);
    await respond(b, c, true);
    expect(await count('select count(*)::int as n from conversations where id = $1 and status = $2', [c, 'accepted'])).toBe(1);
    await expect(respond(b, c, false)).rejects.toThrow(/not allowed/);

    const d = await named('Dani');
    const c2 = await request(a, d);
    await respond(d, c2, false);
    expect(await count('select count(*)::int as n from conversations where id = $1 and status = $2', [c2, 'declined'])).toBe(1);
  });

  test('nobody messages a pending or declined conversation', async () => {
    const a = await named('Ana');
    const b = await named('Bia');
    const c = await request(a, b);
    await expect(send(a, c, 'hello?')).rejects.toThrow(/row-level security/);
    await expect(send(b, c, 'hello')).rejects.toThrow(/row-level security/);
    await respond(b, c, false);
    await expect(send(a, c, 'hello?')).rejects.toThrow(/row-level security/);
    await expect(send(b, c, 'hello')).rejects.toThrow(/row-level security/);
  });

  test('re-requesting within 30 days of a decline looks like success and adds nothing; later it is pending again', async () => {
    const a = await named('Ana');
    const b = await named('Bia');
    const c = await request(a, b, 'first');
    await respond(b, c, false);
    expect(await request(a, b, 'again')).toBe(c);
    expect(await owner('select status from conversations where id = $1', [c])).toEqual([{ status: 'declined' }]);
    expect(await count('select count(*)::int as n from messages where conversation_id = $1', [c])).toBe(1);

    await owner(`update conversations set responded_at = now() - interval '31 days' where id = $1`, [c]);
    expect(await request(a, b, 'a month later')).toBe(c);
    expect(await owner('select status, requested_by from conversations where id = $1', [c])).toEqual([
      { status: 'pending', requested_by: a },
    ]);
    expect(await rows(b, 'select body from messages where conversation_id = $1 order by id', [c])).toEqual([
      { body: 'first' },
      { body: 'a month later' },
    ]);
  });

  test('a repeated request returns the same conversation; a request back accepts it', async () => {
    const a = await named('Ana');
    const b = await named('Bia');
    const c = await request(a, b, 'hi');
    expect(await request(a, b, 'hi again')).toBe(c);
    expect(await count('select count(*)::int as n from messages where conversation_id = $1', [c])).toBe(1);
    expect(await request(b, a, 'hi Ana')).toBe(c);
    expect(await owner('select status from conversations where id = $1', [c])).toEqual([{ status: 'accepted' }]);
    expect(await count('select count(*)::int as n from messages where conversation_id = $1', [c])).toBe(2);
    expect(await request(a, b, 'ignored')).toBe(c);
    expect(await count('select count(*)::int as n from messages where conversation_id = $1', [c])).toBe(2);
  });

  test('self, blocked, suspended and profile-less targets are refused, and so is a requester without a profile', async () => {
    const a = await named('Ana');
    await expect(request(a, a)).rejects.toThrow(/not allowed/);
    const blocker = await named('Gil');
    await t.db.query('insert into blocks (blocker, blocked) values ($1, $2)', [blocker, a]);
    await expect(request(a, blocker)).rejects.toThrow(/not allowed/);
    await expect(request(blocker, a)).rejects.toThrow(/not allowed/);
    const gone = await named('Fabi');
    await suspend(t, gone);
    await expect(request(a, gone)).rejects.toThrow(/not allowed/);
    const bare = await t.newUser();
    await accept(t, bare);
    await expect(request(a, bare)).rejects.toThrow(/not allowed/);
    await expect(request(bare, a)).rejects.toThrow(/not allowed/);
    expect(await count('select count(*)::int as n from conversations where $1 in (a, b)', [a])).toBe(0);
  });

  test('the 11th new request within 24 hours is refused', async () => {
    const a = await named('Ana');
    for (let i = 0; i < 10; i++) await request(a, await named(`Member ${i}`));
    const last = await named('Member 10');
    await expect(request(a, last)).rejects.toThrow(/request limit reached/);
  });
});

describe('messages', () => {
  test('blank or 2 001-character text is refused; newlines, emoji and markup are kept as text', async () => {
    const { a, b, c } = await pair();
    for (const bad of ['', '   ', '\n\t ', 'x'.repeat(2001)]) {
      await expect(send(a, c, bad), JSON.stringify(bad)).rejects.toThrow(/check constraint/);
    }
    await expect(request(a, await named('Caio'), '   ')).rejects.toThrow(/message text/);
    await expect(request(a, await named('Dani'), 'x'.repeat(2001))).rejects.toThrow(/message text/);
    const odd = 'Hi 👋\nשלום <script>alert(1)</script> **bold**';
    const id = await send(a, c, odd);
    expect(await rows(b, 'select body from messages where id = $1', [id])).toEqual([{ body: odd }]);
    await send(a, c, 'x'.repeat(2000));
    const m = await send(b, c, 'ok');
    await expect(correct(a, m, ' \n ')).rejects.toThrow(/check constraint/);
    await expect(correct(a, m, 'y'.repeat(2001))).rejects.toThrow(/check constraint/);
  });

  test('nobody sends as someone else or into a conversation they are not in', async () => {
    const { a, b, c } = await pair();
    const third = await named('Caio');
    await t.as(a);
    await expect(
      t.db.query('insert into messages (conversation_id, sender, body) values ($1, $2, $3)', [c, b, 'fake']),
    ).rejects.toThrow(/row-level security/);
    await expect(send(third, c, 'let me in')).rejects.toThrow(/row-level security/);
  });

  test('the 501st message within 24 hours is refused', async () => {
    const { a, b, c } = await pair();
    await owner(
      `insert into messages (conversation_id, sender, body) select $1, $2, 'm' || g from generate_series(1, 499) g`,
      [c, a],
    );
    await expect(send(a, c, 'one more')).rejects.toThrow(/message limit reached/);
    await send(b, c, 'I can still answer');
  });

  test('a block hides the conversation from both; unblocking shows it again', async () => {
    const { a, b, c } = await pair();
    await send(b, c, 'hello');
    await t.as(a);
    await t.db.query('insert into blocks (blocker, blocked) values ($1, $2)', [a, b]);
    for (const who of [a, b]) {
      expect(await rows(who, 'select id from conversations where id = $1', [c])).toEqual([]);
      expect(await rows(who, 'select id from messages where conversation_id = $1', [c])).toEqual([]);
      expect(await mine(who)).toEqual([]);
    }
    await expect(send(b, c, 'still there?')).rejects.toThrow(/row-level security/);
    await t.as(a);
    await t.db.query('delete from blocks where blocker = $1 and blocked = $2', [a, b]);
    expect(await rows(b, 'select body from messages where conversation_id = $1 order by id', [c])).toHaveLength(2);
    expect((await mine(a)).map((s) => s.id)).toEqual([c]);
  });

  test('delete empties the text, stamps it and removes its corrections, only by the sender', async () => {
    const { a, b, c } = await pair();
    const m = await send(a, c, 'I has a bug');
    await correct(b, m, 'I have a bug');
    await t.as(b);
    await expect(t.db.query('select public.delete_message($1)', [m])).rejects.toThrow(/not allowed/);
    await t.as(a);
    await t.db.query('select public.delete_message($1)', [m]);
    const [row] = await owner<{ body: string; deleted: boolean }>(
      'select body, deleted_at is not null as deleted from messages where id = $1',
      [m],
    );
    expect(row).toEqual({ body: '', deleted: true });
    expect(await count('select count(*)::int as n from corrections where message_id = $1', [m])).toBe(0);
    await t.db.query('select public.delete_message($1)', [m]);
    await expect(correct(b, m, 'I have a bug')).rejects.toThrow(/row-level security/);
  });
});

describe('corrections', () => {
  test('only the other person corrects, once per message; Thanks only by the sender', async () => {
    const { a, b, c } = await pair();
    const third = await named('Caio');
    const m = await send(a, c, 'I am agree');
    await expect(correct(a, m, 'I agree')).rejects.toThrow(/row-level security/);
    await expect(correct(third, m, 'I agree')).rejects.toThrow(/row-level security/);
    const k = await correct(b, m, 'I agree');
    await expect(correct(b, m, 'I agree.')).rejects.toThrow(/duplicate|unique/);
    expect(await rows(a, 'select corrected from corrections where message_id = $1', [m])).toEqual([{ corrected: 'I agree' }]);
    for (const who of [b, third]) {
      await t.as(who);
      await expect(t.db.query('select public.thank_correction($1)', [k])).rejects.toThrow(/not allowed/);
    }
    await t.as(a);
    await t.db.query('select public.thank_correction($1)', [k]);
    expect(await rows(b, 'select thanked_at is not null as thanked from corrections where id = $1', [k])).toEqual([
      { thanked: true },
    ]);
  });

  test('the 201st correction within 24 hours is refused', async () => {
    const { a, b, c } = await pair();
    await owner(
      `insert into messages (conversation_id, sender, body) select $1, $2, 'm' || g from generate_series(1, 201) g`,
      [c, b],
    );
    await owner(
      `insert into corrections (message_id, author, corrected)
       select id, $2, 'fixed' from messages where conversation_id = $1 and sender = $3 order by id limit 200`,
      [c, a, b],
    );
    const [last] = await owner<{ id: number }>('select max(id) as id from messages where conversation_id = $1', [c]);
    await expect(correct(a, Number(last!.id), 'fixed')).rejects.toThrow(/correction limit reached/);
  });

  test('Diff master at 25 corrections that received Thanks', async () => {
    const { a, b, c } = await pair();
    await owner(
      `insert into messages (conversation_id, sender, body) select $1, $2, 'm' || g from generate_series(1, 25) g`,
      [c, b],
    );
    await owner(
      `insert into corrections (message_id, author, corrected, thanked_at)
       select id, $2, 'fixed', now() from messages where conversation_id = $1 and sender = $3 order by id limit 24`,
      [c, a, b],
    );
    const badges = async () =>
      (await rows<{ id: string; grp: string }>(b, 'select id, grp from public.profile_badges($1)', [a])).filter(
        (r) => r.id === 'diff_master',
      );
    expect(await badges()).toEqual([]);
    const [last] = await owner<{ id: number }>('select max(id) as id from messages where conversation_id = $1', [c]);
    const k = await correct(a, Number(last!.id), 'fixed');
    expect(await badges()).toEqual([]);
    await t.as(b);
    await t.db.query('select public.thank_correction($1)', [k]);
    expect(await badges()).toEqual([{ id: 'diff_master', grp: 'community' }]);
  });

  test("a correction adds 1 to the author's practice day in the profile's time zone and keeps the streak", async () => {
    const { a, b, c } = await pair();
    const today = `((now() at time zone 'America/Bahia')::date)`;
    await owner(`insert into practice_days (user_id, day, answers) values ($1, ${today} - 1, 1)`, [a]);
    const m = await send(b, c, 'Yesterday I go home');
    await correct(a, m, 'Yesterday I went home');
    expect(await rows(a, `select corrections from practice_days where user_id = $1 and day = ${today}`, [a])).toEqual([
      { corrections: 1 },
    ]);
    expect(await owner('select * from public.practice_streak_values($1)', [a])).toEqual([{ current: 2, longest: 2 }]);
  });
});

describe('reads and the list', () => {
  test('my_conversations shows unread counts, previews and a declined request as pending to the requester', async () => {
    const a = await named('Ana');
    const b = await named('Bia');
    const c = await request(a, b, 'Hi Bia!');
    expect(await mine(b)).toEqual([
      expect.objectContaining({ id: c, other_id: a, other_name: 'Ana', status: 'pending', requested_by_me: false, preview: 'Hi Bia!', unread: 1 }),
    ]);
    await t.as(b);
    await t.db.query('select public.mark_read($1)', [c]);
    expect((await mine(b))[0]!.unread).toBe(0);
    await respond(b, c, false);
    expect(await mine(b)).toEqual([]);
    expect(await mine(a)).toEqual([
      expect.objectContaining({ id: c, other_name: 'Bia', status: 'pending', requested_by_me: true, unread: 0 }),
    ]);
    expect(await rows(a, 'select id from conversations where id = $1', [c])).toEqual([]);

    const { a: x, b: y, c: c2 } = await pair('Caio', 'Dani');
    await send(y, c2, 'one');
    const last = await send(y, c2, 'two');
    expect(await mine(x)).toEqual([expect.objectContaining({ status: 'accepted', preview: 'two', unread: 2 })]);
    await t.as(y);
    await t.db.query('select public.delete_message($1)', [last]);
    expect(await mine(x)).toEqual([expect.objectContaining({ preview: null, unread: 1 })]);
  });
});

describe('reports', () => {
  test('a message report copies it and the 10 before; only moderators read the copy, which outlives a delete', async () => {
    const { a, b, c } = await pair();
    for (let i = 1; i <= 12; i++) await send(i % 2 ? b : a, c, `message ${i}`);
    const [target] = await owner<{ id: number }>(
      `select id from messages where conversation_id = $1 and body = 'message 11'`,
      [c],
    );
    const reportOf = async (reporter: string) => {
      await t.as(reporter);
      const r = await t.db.query<{ id: number }>(
        `insert into reports (reporter, reported, context_type, context_id, reason) values ($1, $2, 'message', $3, 'harassment') returning id`,
        [reporter, b, String(target!.id)],
      );
      return Number(r.rows[0]!.id);
    };
    const report = await reportOf(a);
    const mod = await moderator(t);
    const context = await rows<{ body: string; reported: boolean; sender_name: string }>(
      mod,
      'select * from public.report_context($1)',
      [report],
    );
    expect(context.map((r) => r.body)).toEqual(Array.from({ length: 11 }, (_, i) => `message ${i + 1}`));
    expect(context.filter((r) => r.reported).map((r) => r.body)).toEqual(['message 11']);
    expect(context.at(-1)!.sender_name).toBe('Bia');
    expect(await rows(a, 'select * from public.report_context($1)', [report])).toEqual([]);
    expect(await rows(b, 'select * from public.report_context($1)', [report])).toEqual([]);

    await t.as(b);
    await t.db.query('select public.delete_message($1)', [target!.id]);
    expect((await rows<{ body: string }>(mod, 'select body from public.report_context($1)', [report])).at(-1)!.body).toBe(
      'message 11',
    );

    const outsider = await named('Caio');
    const other = await reportOf(outsider);
    expect(await rows(mod, 'select * from public.report_context($1)', [other])).toEqual([]);
  });
});

describe('export', () => {
  test('my_chat_export gives your own messages and corrections, never the other person\'s; progress has corrections', async () => {
    const { a, b, c } = await pair();
    const theirs = await send(b, c, 'I goes home');
    await correct(a, theirs, 'I go home');
    await send(a, c, 'See you');
    const [x] = await rows<{ x: { conversations: { id: string; with: string }[]; messagesSent: { body: string }[]; correctionsGiven: { corrected: string }[] } }>(
      a,
      'select public.my_chat_export() as x',
    );
    expect(x!.x.conversations).toEqual([expect.objectContaining({ id: c, with: b })]);
    expect(x!.x.messagesSent.map((m) => m.body)).toEqual(['Hi! Can we practise together?', 'See you']);
    expect(x!.x.correctionsGiven).toEqual([expect.objectContaining({ corrected: 'I go home', thanked: false })]);
    const [p] = await rows<{ x: { practiceDays: { corrections: number }[] } }>(a, 'select public.my_progress_export() as x');
    expect(p!.x.practiceDays.at(-1)).toMatchObject({ corrections: 1 });
    await t.as(null);
    await expect(t.db.query('select public.my_chat_export()')).rejects.toThrow(/permission denied/);
  });
});

describe('account deletion', () => {
  test("deleting an account removes its conversations, messages and corrections, and blanks the sender in report copies", async () => {
    const { a, b, c } = await pair();
    const m = await send(b, c, 'I goes');
    await correct(a, m, 'I go');
    await t.as(a);
    const r = await t.db.query<{ id: number }>(
      `insert into reports (reporter, reported, context_type, context_id, reason) values ($1, $2, 'message', $3, 'spam') returning id`,
      [a, b, String(m)],
    );
    await owner('delete from auth.users where id = $1', [b]);
    expect(await count('select count(*)::int as n from conversations where id = $1', [c])).toBe(0);
    expect(await count('select count(*)::int as n from messages where conversation_id = $1', [c])).toBe(0);
    expect(await count('select count(*)::int as n from corrections where message_id = $1', [m])).toBe(0);
    expect(
      await owner('select sender, body from report_messages where report_id = $1 and message_id = $2', [r.rows[0]!.id, m]),
    ).toEqual([{ sender: null, body: 'I goes' }]);
  });
});

test('0008 adds the chat tables to the Realtime publication when the project has one', async () => {
  const db = await PGlite.create();
  await db.exec(readFileSync(join(__dirname, 'stubs.sql'), 'utf8'));
  await db.exec('create publication supabase_realtime');
  for (const file of migrationFiles()) await db.exec(readFileSync(file, 'utf8'));
  const tables = (
    await db.query<{ tablename: string }>(
      `select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename`,
    )
  ).rows.map((r) => r.tablename);
  expect(tables).toEqual(['conversations', 'corrections', 'messages']);
  await db.close();
}, 30_000);
