// 0009 — voice rooms: rooms, sessions, roles, signals, readers, report context, export and badges.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb } from './harness';
import type { TestDb } from './harness';
import { member, moderator, suspend } from './people';

let t: TestDb;
beforeAll(async () => {
  t = await createDb();
}, 30_000);

const named = (name: string, over: Record<string, unknown> = {}) => member(t, { display_name: name, ...over });

async function rows<T = Record<string, unknown>>(who: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await t.as(who);
  return (await t.db.query<T>(sql, params)).rows;
}
const owner = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  t.owner(async () => (await t.db.query<T>(sql, params)).rows);
const count = async (sql: string, params: unknown[] = []) => (await owner<{ n: number }>(sql, params))[0]!.n;

/** Calls `public.<fn>(...args)` as `who`. */
async function call(who: string | null, fn: string, ...args: unknown[]): Promise<void> {
  await t.as(who);
  await t.db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')})`, args);
}
async function create(who: string, title = 'Daily stand-up', theme = 'standup', level: string | null = 'B1'): Promise<string> {
  return (await rows<{ id: string }>(who, 'select public.create_room($1, $2, $3) as id', [title, theme, level]))[0]!.id;
}
const joinRoom = (who: string, room: string) => call(who, 'join_room', room);
const leaveRoom = (who: string, room: string) => call(who, 'leave_room', room);
async function heartbeat(who: string, room: string): Promise<boolean> {
  return (await rows<{ ok: boolean }>(who, 'select public.room_heartbeat($1) as ok', [room]))[0]!.ok;
}

interface Person {
  id: string;
  displayName: string;
  hasAvatar: boolean;
  mascot: string | null;
  level: string;
  role: string;
}
interface State {
  id: string;
  title: string;
  theme: string;
  level: string | null;
  hostId: string | null;
  endedAt: string | null;
  timer: { startedAt: string; seconds: number } | null;
  card: number;
  me: { live: boolean; removed: boolean; role: string; muteRequestedAt: string | null };
  people: Person[];
}
async function state(who: string, room: string): Promise<State | null> {
  return (await rows<{ s: State | null }>(who, 'select public.room_state($1) as s', [room]))[0]!.s;
}
const peopleIn = async (who: string, room: string) => (await state(who, room))!.people.map((p) => p.id).sort();

interface Live {
  id: string;
  title: string;
  theme: string;
  level: string | null;
  host_name: string;
  people: { id: string; name: string; hasAvatar: boolean; mascot: string | null }[];
}
const live = (who: string) => rows<Live>(who, 'select * from public.live_rooms()');
const liveIds = async (who: string) => (await live(who)).map((r) => r.id);

/** Makes `who`'s open session in `room` silent for `seconds`. */
const silence = (who: string, room: string, seconds = 91) =>
  owner(
    `update room_presence p set last_seen = now() - make_interval(secs => $3) from room_sessions s
     where s.id = p.session_id and s.room_id = $1 and s.user_id = $2 and s.left_at is null`,
    [room, who, seconds],
  );
async function block(blocker: string, blocked: string) {
  await t.as(blocker);
  await t.db.query('insert into blocks (blocker, blocked) values ($1, $2)', [blocker, blocked]);
}

/** A room opened by a new host, with `n` more members who joined in order. */
async function roomWith(n: number, title = 'Daily stand-up') {
  const host = await named('Host');
  const room = await create(host, title);
  const others: string[] = [];
  for (let i = 0; i < n; i++) {
    const m = await named(`Member ${i}`);
    await joinRoom(m, room);
    others.push(m);
  }
  return { room, host, others };
}

describe('creating and listing', () => {
  test('create makes you host and live, and live_rooms shows it to another member', async () => {
    const a = await named('Ana', { level: 'B2', mascot: 'duck-1' });
    const b = await named('Bia');
    const room = await create(a, '  Morning stand-up  ', 'standup', 'B1');
    const s = await state(a, room);
    expect(s).toMatchObject({
      id: room,
      title: 'Morning stand-up',
      theme: 'standup',
      level: 'B1',
      hostId: a,
      endedAt: null,
      timer: null,
      card: 0,
      me: { live: true, removed: false, role: 'host', muteRequestedAt: null },
    });
    expect(s!.people).toEqual([{ id: a, displayName: 'Ana', hasAvatar: false, mascot: 'duck-1', level: 'B2', role: 'host' }]);
    const listed = (await live(b)).find((r) => r.id === room);
    expect(listed).toMatchObject({
      title: 'Morning stand-up',
      theme: 'standup',
      level: 'B1',
      host_name: 'Ana',
      people: [{ id: a, name: 'Ana', hasAvatar: false, mascot: 'duck-1' }],
    });
    expect(await state(b, room)).toBeNull();
  });

  test('a 3- and 60-char title pass, 2/61 chars or an unknown theme fail', async () => {
    const a = await named('Ana');
    const short = await create(a, 'abc', 'free', null);
    expect((await state(a, short))!.level).toBeNull();
    const spaced = await create(a, '\u00a0\tabc\u3000\n', 'interview', 'A2');
    expect((await state(a, spaced))!.title).toBe('abc');
    const pad = String.fromCharCode(0xfeff, 0xa0, 0x2029, 0x2007);
    const padded = await create(a, `${pad}Pair talk${pad}`, 'free', null);
    expect((await state(a, padded))!.title).toBe('Pair talk');
    const sixty = 'é'.repeat(59) + '👋';
    const long = await create(a, sixty, 'code_review', 'C2');
    expect((await state(a, long))!.title).toBe(sixty);
    for (const bad of ['ab', '  ab  ', 'x'.repeat(61), '', '     ', 'é'.repeat(60) + '👋']) {
      await expect(create(a, bad), JSON.stringify(bad)).rejects.toThrow(/room title is not valid/);
    }
    await expect(create(a, 'Good title', 'party')).rejects.toThrow(/not valid/);
    await expect(create(a, 'Good title', 'free', 'A1')).rejects.toThrow(/not valid/);
  });

  test('the 11th room in 24 h fails room limit reached', async () => {
    const a = await named('Ana');
    for (let i = 0; i < 10; i++) await create(a, `Room ${i}`);
    await expect(create(a, 'Room 10')).rejects.toThrow(/room limit reached/);
    // Each new room closed the one before, which ended because it was empty.
    expect(await count('select count(*)::int as n from rooms where created_by = $1 and ended_at is null', [a])).toBe(1);
    expect(await count('select count(*)::int as n from room_sessions where user_id = $1 and left_at is null', [a])).toBe(1);
    await owner(`update rooms set created_at = now() - interval '25 hours' where created_by = $1 and title = 'Room 0'`, [a]);
    await create(a, 'Room 10');
  });

  test('members without a profile, suspended members and anon cannot create or join', async () => {
    const a = await named('Ana');
    const room = await create(a);
    const bare = await t.newUser();
    await t.as(bare);
    await expect(create(bare)).rejects.toThrow(/not allowed/);
    await expect(joinRoom(bare, room)).rejects.toThrow(/not allowed/);
    const gone = await named('Gone');
    await suspend(t, gone);
    await expect(create(gone)).rejects.toThrow(/not allowed/);
    await expect(joinRoom(gone, room)).rejects.toThrow(/not allowed/);
    expect(await live(gone)).toEqual([]);
  });
});

describe('seats and sessions', () => {
  test('the 7th live person fails room is full, a session silent for 91 s frees the seat, and an all-dead room leaves live_rooms', async () => {
    const { room, others } = await roomWith(5);
    const seventh = await named('Seventh');
    await expect(joinRoom(seventh, room)).rejects.toThrow(/room is full/);
    expect(await liveIds(seventh)).toContain(room);
    await silence(others[0]!, room, 89);
    await expect(joinRoom(seventh, room)).rejects.toThrow(/room is full/);
    await silence(others[0]!, room, 91);
    await joinRoom(seventh, room);
    expect(await peopleIn(seventh, room)).not.toContain(others[0]);
    expect((await live(seventh)).find((r) => r.id === room)!.people).toHaveLength(6);
    expect(await heartbeat(others[0]!, room)).toBe(false);
    expect((await state(others[0]!, room))!.me.live).toBe(false);

    await owner(
      `update room_presence p set last_seen = now() - interval '91 seconds' from room_sessions s
       where s.id = p.session_id and s.room_id = $1`,
      [room],
    );
    const outsider = await named('Outsider');
    expect(await liveIds(outsider)).not.toContain(room);
    await expect(joinRoom(outsider, room)).rejects.toThrow(/not allowed/);
  });

  test('a heartbeat keeps you live and says false once you are not', async () => {
    const { room, others } = await roomWith(1);
    const b = others[0]!;
    await silence(b, room, 60);
    const session = () =>
      owner<{ r: unknown }>('select row_to_json(s) as r from room_sessions s where room_id = $1 and user_id = $2', [room, b]);
    const fresh = () =>
      count(
        `select count(*)::int as n from room_presence p join room_sessions s on s.id = p.session_id
         where s.room_id = $1 and s.user_id = $2 and p.last_seen > now() - interval '5 seconds'`,
        [room, b],
      );
    const before = await session();
    expect(await fresh()).toBe(0);
    expect(await heartbeat(b, room)).toBe(true);
    // The heartbeat writes only to room_presence, which is not published: the session row (and Realtime) stay quiet.
    expect(await session()).toEqual(before);
    expect(await fresh()).toBe(1);
    await t.as(b);
    await expect(t.db.query('select * from room_presence')).rejects.toThrow(/permission denied/);
    await expect(t.db.query('update room_presence set last_seen = now()')).rejects.toThrow(/permission denied/);
    const outsider = await named('Outsider');
    expect(await heartbeat(outsider, room)).toBe(false);
    await leaveRoom(b, room);
    expect(await heartbeat(b, room)).toBe(false);
  });

  test('joining another room closes your first session', async () => {
    const a = await named('Ana');
    const b = await named('Bia');
    const c = await named('Caio');
    const first = await create(a, 'Room one');
    const second = await create(b, 'Room two');
    await joinRoom(c, first);
    await joinRoom(c, second);
    expect((await state(c, first))!.me.live).toBe(false);
    expect((await state(c, second))!.me.live).toBe(true);
    expect(await count('select count(*)::int as n from room_sessions where user_id = $1 and left_at is null', [c])).toBe(1);
    expect(await peopleIn(a, first)).toEqual([a]);
    // Joining the room you are in changes nothing.
    await joinRoom(c, second);
    expect(await count('select count(*)::int as n from room_sessions where user_id = $1 and room_id = $2', [c, second])).toBe(1);
    // A host alone in a room who joins another ends the first room.
    await joinRoom(a, second);
    expect((await state(a, first))!.endedAt).not.toBeNull();
    expect(await peopleIn(b, second)).toEqual([a, b, c].sort());
  });
});

describe('blocks', () => {
  test('blocked either way: the room is hidden from live_rooms and join_room fails', async () => {
    const a = await named('Ana');
    const b = await named('Bia');
    const c = await named('Caio');
    const room = await create(a, 'Blocked room');
    await block(b, a);
    expect(await liveIds(b)).not.toContain(room);
    await expect(joinRoom(b, room)).rejects.toThrow(/not allowed/);
    await block(a, c);
    expect(await liveIds(c)).not.toContain(room);
    await expect(joinRoom(c, room)).rejects.toThrow(/not allowed/);
    // Blocking someone who is not in your room leaves you where you are.
    expect((await state(a, room))!.me.live).toBe(true);
    await t.as(b);
    await t.db.query('delete from blocks where blocker = $1 and blocked = $2', [b, a]);
    expect(await liveIds(b)).toContain(room);
    await joinRoom(b, room);
  });

  test("a block made inside a room closes the blocker's session, not the blocked person's", async () => {
    const { room, host, others } = await roomWith(2);
    const [b, c] = others as [string, string];
    await block(b, c);
    expect((await state(b, room))!.me.live).toBe(false);
    expect((await state(c, room))!.me.live).toBe(true);
    expect(await peopleIn(host, room)).toEqual([host, c].sort());
    await expect(joinRoom(b, room)).rejects.toThrow(/not allowed/);
    // A host who blocks someone in the room leaves, and the room goes on with a new host.
    await block(host, c);
    expect((await state(host, room))!.me.live).toBe(false);
    expect(await state(c, room)).toMatchObject({ hostId: c, endedAt: null, me: { live: true, role: 'host' } });
  });
});

describe('roles', () => {
  test('only the host makes and unmakes moderators and passes host', async () => {
    const { room, host, others } = await roomWith(2);
    const [b, c] = others as [string, string];
    const roleOf = async (who: string) => (await state(host, room))!.people.find((p) => p.id === who)?.role;
    await expect(call(b, 'make_room_moderator', room, c)).rejects.toThrow(/not allowed/);
    await call(host, 'make_room_moderator', room, b);
    expect(await roleOf(b)).toBe('moderator');
    expect((await state(b, room))!.me.role).toBe('moderator');
    await expect(call(b, 'make_room_moderator', room, c)).rejects.toThrow(/not allowed/);
    await expect(call(b, 'remove_room_moderator', room, b)).rejects.toThrow(/not allowed/);
    await expect(call(b, 'pass_host', room, b)).rejects.toThrow(/not allowed/);
    await expect(call(c, 'pass_host', room, c)).rejects.toThrow(/not allowed/);
    await call(host, 'remove_room_moderator', room, b);
    expect(await roleOf(b)).toBe('member');

    const outsider = await named('Outsider');
    await expect(call(host, 'make_room_moderator', room, outsider)).rejects.toThrow(/not allowed/);
    await expect(call(host, 'pass_host', room, outsider)).rejects.toThrow(/not allowed/);
    await silence(c, room, 91);
    await expect(call(host, 'pass_host', room, c)).rejects.toThrow(/not allowed/);
    await expect(call(host, 'make_room_moderator', room, c)).rejects.toThrow(/not allowed/);
    await heartbeat(c, room);
    await joinRoom(c, room);

    await call(host, 'pass_host', room, c);
    expect((await state(c, room))!).toMatchObject({ hostId: c, me: { role: 'host' } });
    expect((await state(host, room))!.me.role).toBe('member');
    await expect(call(host, 'make_room_moderator', room, b)).rejects.toThrow(/not allowed/);
    await call(c, 'make_room_moderator', room, b);
    expect(await roleOf(b)).toBe('moderator');
  });

  test('host or room moderator mutes and removes, a member cannot, nobody mutes or removes the host, a moderator cannot remove another moderator', async () => {
    const { room, host, others } = await roomWith(4);
    const [mod1, mod2, m1, m2] = others as [string, string, string, string];
    await call(host, 'make_room_moderator', room, mod1);
    await call(host, 'make_room_moderator', room, mod2);

    await expect(call(m1, 'mute_member', room, m2)).rejects.toThrow(/not allowed/);
    await expect(call(m1, 'remove_from_room', room, m2)).rejects.toThrow(/not allowed/);
    for (const who of [host, mod1, m1]) {
      await expect(call(who, 'mute_member', room, host)).rejects.toThrow(/not allowed/);
      await expect(call(who, 'remove_from_room', room, host)).rejects.toThrow(/not allowed/);
    }
    expect((await state(host, room))!.me).toMatchObject({ live: true, muteRequestedAt: null });

    await call(mod1, 'mute_member', room, m1);
    expect((await state(m1, room))!.me.muteRequestedAt).not.toBeNull();
    await call(host, 'mute_member', room, mod1);
    expect((await state(mod1, room))!.me.muteRequestedAt).not.toBeNull();
    expect((await state(m2, room))!.me.muteRequestedAt).toBeNull();

    await expect(call(mod1, 'remove_from_room', room, mod2)).rejects.toThrow(/not allowed/);
    await call(mod1, 'remove_from_room', room, m1);
    await call(host, 'remove_from_room', room, mod2);
    expect(await peopleIn(host, room)).toEqual([host, mod1, m2].sort());
    expect((await state(m1, room))!.me).toMatchObject({ live: false, removed: true });
    expect((await state(mod2, room))!.me).toMatchObject({ live: false, removed: true });
  });

  test('a removed person cannot rejoin', async () => {
    const { room, host, others } = await roomWith(1);
    const b = others[0]!;
    await call(host, 'remove_from_room', room, b);
    await expect(joinRoom(b, room)).rejects.toThrow(/not allowed/);
    expect(await heartbeat(b, room)).toBe(false);
    await t.as(b);
    await expect(t.db.query('insert into room_sessions (room_id, user_id) values ($1, $2)', [room, b])).rejects.toThrow(
      /permission denied/,
    );
    await expect(t.db.query('update room_sessions set removed = false where user_id = $1', [b])).rejects.toThrow(
      /permission denied/,
    );
    // Other rooms are still open to them.
    const other = await create(await named('Other host'), 'Another room');
    await joinRoom(b, other);
  });

  test('a host who leaves passes host to the oldest room moderator, else the earliest live member', async () => {
    const { room, host, others } = await roomWith(4);
    const [b, c, d, e] = others as [string, string, string, string];
    for (const [who, minutes] of [[b, 10], [c, 8], [d, 6], [e, 4]] as const) {
      await owner(`update room_sessions set joined_at = now() - make_interval(mins => $3) where room_id = $1 and user_id = $2`, [
        room,
        who,
        minutes,
      ]);
    }
    await call(host, 'make_room_moderator', room, d);
    await call(host, 'make_room_moderator', room, c);
    await leaveRoom(host, room);
    expect((await state(b, room))!.hostId).toBe(c);
    await leaveRoom(c, room);
    expect((await state(b, room))!.hostId).toBe(d);
    await leaveRoom(d, room);
    expect((await state(e, room))!.hostId).toBe(b);
    expect((await state(b, room))!.me.role).toBe('host');
  });

  test('a host silent for 91 s hands the room on at the next heartbeat', async () => {
    const { room, host, others } = await roomWith(2);
    const [b, c] = others as [string, string];
    await call(host, 'make_room_moderator', room, c);
    await silence(host, room, 91);
    expect(await heartbeat(b, room)).toBe(true);
    expect((await state(b, room))!.hostId).toBe(c);
    expect(await heartbeat(host, room)).toBe(false);
    expect((await state(host, room))!.me).toMatchObject({ live: false, role: 'member' });
    // Without a room moderator, the earliest live member is next.
    await silence(c, room, 91);
    expect(await heartbeat(b, room)).toBe(true);
    expect((await state(b, room))!.hostId).toBe(b);
  });

  test('the last person leaving ends the room', async () => {
    const { room, host, others } = await roomWith(1);
    const b = others[0]!;
    await leaveRoom(host, room);
    expect(await state(b, room)).toMatchObject({ hostId: b, endedAt: null });
    await leaveRoom(b, room);
    expect((await state(b, room))!.endedAt).not.toBeNull();
    await leaveRoom(b, room);
    await expect(joinRoom(host, room)).rejects.toThrow(/not allowed/);
    expect(await liveIds(await named('Outsider'))).not.toContain(room);
  });

  test('end_room only by the host, and it closes every session', async () => {
    const { room, host, others } = await roomWith(2);
    const [b, c] = others as [string, string];
    await call(host, 'make_room_moderator', room, b);
    await expect(call(b, 'end_room', room)).rejects.toThrow(/not allowed/);
    await expect(call(c, 'end_room', room)).rejects.toThrow(/not allowed/);
    await call(host, 'end_room', room);
    expect(await count('select count(*)::int as n from room_sessions where room_id = $1 and left_at is null', [room])).toBe(0);
    expect((await state(c, room))!).toMatchObject({ me: { live: false, removed: false }, people: [] });
    expect((await state(c, room))!.endedAt).not.toBeNull();
    await expect(joinRoom(c, room)).rejects.toThrow(/not allowed/);
    await expect(call(host, 'next_card', room)).rejects.toThrow(/not allowed/);
  });
});

describe('timer and card', () => {
  test('the timer accepts 60 or 90 only and any live member starts or stops it', async () => {
    const { room, host, others } = await roomWith(1);
    const b = others[0]!;
    for (const bad of [0, 30, 61, 120, -60, null]) {
      await expect(call(b, 'start_timer', room, bad), String(bad)).rejects.toThrow(/timer is not valid/);
    }
    await call(b, 'start_timer', room, 90);
    expect((await state(host, room))!.timer).toEqual({ startedAt: expect.any(String), seconds: 90 });
    await call(host, 'start_timer', room, 60);
    expect((await state(b, room))!.timer).toMatchObject({ seconds: 60 });
    await call(b, 'stop_timer', room);
    expect((await state(host, room))!.timer).toBeNull();
    const outsider = await named('Outsider');
    await expect(call(outsider, 'start_timer', room, 60)).rejects.toThrow(/not allowed/);
    await expect(call(outsider, 'stop_timer', room)).rejects.toThrow(/not allowed/);
  });

  test('next_card increments for everyone, by any live member', async () => {
    const { room, host, others } = await roomWith(1);
    const b = others[0]!;
    await call(b, 'next_card', room);
    await call(host, 'next_card', room);
    expect((await state(host, room))!.card).toBe(2);
    expect((await state(b, room))!.card).toBe(2);
    await expect(call(await named('Outsider'), 'next_card', room)).rejects.toThrow(/not allowed/);
  });
});

describe('reading', () => {
  test('room_state shows me.removed to a removed person and no people', async () => {
    const { room, host, others } = await roomWith(2);
    const [b, c] = others as [string, string];
    await call(host, 'remove_from_room', room, b);
    const s = await state(b, room);
    expect(s).toMatchObject({ id: room, me: { live: false, removed: true, role: 'member' } });
    expect(s!.people).toEqual([]);
    // The room row and their own session stay readable (so the change reaches them), other sessions do not.
    expect(await rows(b, 'select id from rooms where id = $1', [room])).toHaveLength(1);
    expect((await rows<{ user_id: string }>(b, 'select user_id from room_sessions where room_id = $1', [room])).map((r) => r.user_id)).toEqual([
      b,
    ]);
    expect((await rows(c, 'select user_id from room_sessions where room_id = $1', [room])).length).toBe(3);
  });

  test('rooms and sessions are read only by people in the room; nobody writes them directly', async () => {
    const { room, host } = await roomWith(1);
    const outsider = await named('Outsider');
    const mod = await moderator(t);
    for (const who of [outsider, mod]) {
      expect(await rows(who, 'select id from rooms where id = $1', [room])).toEqual([]);
      expect(await rows(who, 'select id from room_sessions where room_id = $1', [room])).toEqual([]);
      expect(await state(who, room)).toBeNull();
    }
    await t.as(host);
    for (const sql of [
      `update rooms set title = 'Mine now' where id = '${room}'`,
      `update rooms set host = '${outsider}' where id = '${room}'`,
      `insert into rooms (created_by, host, title, theme) values ('${host}', '${host}', 'Sneaky', 'free')`,
      `delete from rooms where id = '${room}'`,
      `update room_sessions set role = 'moderator' where room_id = '${room}'`,
      `update room_sessions set joined_at = now() - interval '1 day' where room_id = '${room}'`,
      `update room_presence set last_seen = now() + interval '1 day'`,
      `insert into room_presence (session_id) values (1)`,
      `delete from room_sessions where room_id = '${room}'`,
      `update room_signals set payload = '{}'`,
      `delete from room_signals`,
    ]) {
      await expect(t.db.query(sql), sql).rejects.toThrow(/permission denied/);
    }
  });

  test('anon reads nothing and cannot call any function', async () => {
    const { room } = await roomWith(0);
    await t.as(null);
    const u = `'${room}'::uuid`;
    for (const sql of [
      'select * from rooms',
      'select * from room_sessions',
      'select * from room_signals',
      `insert into room_signals (room_id, sender, recipient, kind, payload) values (${u}, ${u}, ${u}, 'offer', '{}')`,
      `select public.create_room('Hello room', 'free', null)`,
      `select public.join_room(${u})`,
      `select public.leave_room(${u})`,
      `select public.room_heartbeat(${u})`,
      `select public.make_room_moderator(${u}, ${u})`,
      `select public.remove_room_moderator(${u}, ${u})`,
      `select public.pass_host(${u}, ${u})`,
      `select public.mute_member(${u}, ${u})`,
      `select public.remove_from_room(${u}, ${u})`,
      `select public.end_room(${u})`,
      `select public.start_timer(${u}, 60)`,
      `select public.stop_timer(${u})`,
      `select public.next_card(${u})`,
      'select * from public.live_rooms()',
      `select public.room_state(${u})`,
      'select public.room_report_context(1)',
      'select public.my_rooms_export()',
    ]) {
      await expect(t.db.query(sql), sql).rejects.toThrow(/permission denied/);
    }
    // The internal helpers are not callable by members either.
    await named('Curious');
    for (const sql of [
      `select public.room_session_live(1)`,
      `select public.room_seen(1)`,
      `select public.room_left_at(1)`,
      `select public.room_settle(${u})`,
      `select public.room_close_session(${u}, ${u})`,
      `select public.room_is_live(${u}, ${u})`,
    ]) {
      await expect(t.db.query(sql), sql).rejects.toThrow(/permission denied/);
    }
  });

  test('room_report_context returns title/theme/host/people times to moderators and null to others', async () => {
    const { room, host, others } = await roomWith(2, 'Interview practice');
    const [b, c] = others as [string, string];
    await leaveRoom(c, room);
    const report = async (reporter: string, reported: string, type: string, id: string | null) => {
      await t.as(reporter);
      const r = await t.db.query<{ id: number }>(
        `insert into reports (reporter, reported, context_type, context_id, reason) values ($1, $2, $3, $4, 'harassment') returning id`,
        [reporter, reported, type, id],
      );
      return Number(r.rows[0]!.id);
    };
    const context = async (who: string, id: number) =>
      (await rows<{ x: unknown }>(who, 'select public.room_report_context($1) as x', [id]))[0]!.x;
    const id = await report(host, b, 'room', room);
    const mod = await moderator(t);
    expect(await context(mod, id)).toEqual({
      title: 'Interview practice',
      theme: 'standup',
      hostName: 'Host',
      createdAt: expect.any(String),
      people: [
        { name: 'Host', joinedAt: expect.any(String), leftAt: null },
        { name: 'Member 0', joinedAt: expect.any(String), leftAt: null },
        { name: 'Member 1', joinedAt: expect.any(String), leftAt: expect.any(String) },
      ],
    });
    for (const who of [host, b, c]) expect(await context(who, id)).toBeNull();
    // Not a room report, not a room id, or about someone who was never in that room: nothing.
    expect(await context(mod, await report(host, b, 'profile', null))).toBeNull();
    expect(await context(mod, await report(host, b, 'room', 'not-a-uuid'))).toBeNull();
    const stranger = await named('Stranger');
    expect(await context(mod, await report(host, stranger, 'room', room))).toBeNull();
    await suspend(t, mod);
    expect(await context(mod, id)).toBeNull();
  });

  test('my_rooms_export gives your rooms and your own sessions only', async () => {
    const { room, host, others } = await roomWith(1, 'Export room');
    const b = others[0]!;
    type Export = {
      roomsCreated: { id: string; title: string; theme: string; createdAt: string; endedAt: string | null }[];
      sessions: { roomId: string; joinedAt: string; leftAt: string | null; role: string; removed: boolean }[];
    };
    const exportOf = async (who: string) => (await rows<{ x: Export }>(who, 'select public.my_rooms_export() as x'))[0]!.x;
    const mine = await exportOf(b);
    expect(mine.roomsCreated).toEqual([]);
    expect(mine.sessions).toEqual([{ roomId: room, joinedAt: expect.any(String), leftAt: null, role: 'member', removed: false }]);
    const theirs = await exportOf(host);
    expect(theirs.roomsCreated).toEqual([
      { id: room, title: 'Export room', theme: 'standup', createdAt: expect.any(String), endedAt: null },
    ]);
    expect(theirs.sessions.map((s) => s.roomId)).toEqual([room]);
    await t.as(null);
    await expect(t.db.query('select public.my_rooms_export()')).rejects.toThrow(/permission denied/);
  });
});

describe('signals', () => {
  async function signal(from: string, room: string, to: string, kind = 'offer', payload = '{"sdp":"v=0"}') {
    await t.as(from);
    await t.db.query('insert into room_signals (room_id, sender, recipient, kind, payload) values ($1, $2, $3, $4, $5)', [
      room,
      from,
      to,
      kind,
      payload,
    ]);
  }
  const inbox = (who: string) =>
    rows<{ sender: string; kind: string; payload: string }>(who, 'select sender, kind, payload from room_signals order by id');

  test('signals go only between live members of the same room, and only the recipient reads them', async () => {
    const { room, host, others } = await roomWith(2);
    const [b, c] = others as [string, string];
    await signal(host, room, b, 'offer', '{"sdp":"offer"}');
    await signal(b, room, host, 'answer', '{"sdp":"answer"}');
    expect(await inbox(b)).toEqual([{ sender: host, kind: 'offer', payload: '{"sdp":"offer"}' }]);
    expect(await inbox(host)).toEqual([{ sender: b, kind: 'answer', payload: '{"sdp":"answer"}' }]);
    expect(await inbox(c)).toEqual([]);
    const mod = await moderator(t);
    expect(await inbox(mod)).toEqual([]);

    await t.as(host);
    await expect(
      t.db.query(`insert into room_signals (room_id, sender, recipient, kind, payload) values ($1, $2, $3, 'offer', '{}')`, [
        room,
        b,
        c,
      ]),
    ).rejects.toThrow(/row-level security/);
    await expect(signal(host, room, host)).rejects.toThrow(/row-level security|check constraint/);
    await expect(signal(host, room, b, 'hello')).rejects.toThrow(/check constraint/);
    const outsider = await named('Outsider');
    await expect(signal(host, room, outsider)).rejects.toThrow(/row-level security/);
    await expect(signal(outsider, room, host)).rejects.toThrow(/row-level security/);
    const other = await create(outsider, 'Other room');
    await expect(signal(host, other, outsider)).rejects.toThrow(/row-level security/);
    await leaveRoom(c, room);
    await expect(signal(host, room, c)).rejects.toThrow(/row-level security/);
    await expect(signal(c, room, host)).rejects.toThrow(/row-level security/);
    await signal(b, room, host, 'bye', '{}');
  });

  test('signals are refused for a blocked pair', async () => {
    const { room, host, others } = await roomWith(1);
    const b = others[0]!;
    await block(b, host);
    // Put the blocker back in the room past the functions, to check the rule on the table itself.
    await owner(`update room_sessions set left_at = null where room_id = $1 and user_id = $2`, [room, b]);
    await silence(b, room, 0);
    await expect(signal(b, room, host)).rejects.toThrow(/row-level security/);
    await expect(signal(host, room, b)).rejects.toThrow(/row-level security/);
  });

  test('a 16 385-byte payload fails', async () => {
    const { room, host, others } = await roomWith(1);
    const b = others[0]!;
    await signal(host, room, b, 'offer', 'x'.repeat(16_384));
    await expect(signal(host, room, b, 'offer', 'x'.repeat(16_385))).rejects.toThrow(/check constraint/);
    await expect(signal(host, room, b, 'offer', 'é'.repeat(8_193))).rejects.toThrow(/check constraint/);
  });

  test('the 601st signal in a minute fails signal limit reached', async () => {
    const { room, host, others } = await roomWith(1);
    const b = others[0]!;
    await owner(
      `insert into room_signals (room_id, sender, recipient, kind, payload) select $1, $2, $3, 'candidate', '{}' from generate_series(1, 599)`,
      [room, host, b],
    );
    await signal(host, room, b, 'candidate', '{}');
    await expect(signal(host, room, b, 'candidate', '{}')).rejects.toThrow(/signal limit reached/);
    await signal(b, room, host, 'candidate', '{}');
    await owner(`update room_signals set created_at = now() - interval '61 seconds' where sender = $1`, [host]);
    await signal(host, room, b, 'candidate', '{}');
  });

  test('a heartbeat deletes signals older than 5 minutes, in any room', async () => {
    const { room, host, others } = await roomWith(1);
    const b = others[0]!;
    await signal(host, room, b, 'offer', '{"old":true}');
    await signal(host, room, b, 'candidate', '{"new":true}');
    await owner(`update room_signals set created_at = now() - interval '301 seconds' where room_id = $1 and kind = 'offer'`, [room]);
    // Everyone in this room dropped out without leaving, so it gets no heartbeats any more; its old signals go too.
    const { room: dropped, host: x, others: [y] } = await roomWith(1, 'Dropped room');
    await signal(x, dropped, y!, 'offer', '{"ip":"203.0.113.7"}');
    await silence(x, dropped, 400);
    await silence(y!, dropped, 400);
    await owner(`update room_signals set created_at = now() - interval '301 seconds' where room_id = $1`, [dropped]);
    expect(await heartbeat(b, room)).toBe(true);
    expect(await inbox(b)).toEqual([{ sender: host, kind: 'candidate', payload: '{"new":true}' }]);
    expect(await count('select count(*)::int as n from room_signals where room_id = $1', [dropped])).toBe(0);
  });

  test('a room that ends takes its signals with it', async () => {
    const { room, host, others } = await roomWith(1);
    const b = others[0]!;
    await signal(host, room, b, 'offer');
    await signal(b, room, host, 'answer');
    const kept = (id: string) => count('select count(*)::int as n from room_signals where room_id = $1', [id]);
    await leaveRoom(b, room);
    expect(await kept(room)).toBe(2);
    await leaveRoom(host, room);
    expect(await kept(room)).toBe(0);

    const { room: other, host: h, others: [c] } = await roomWith(1, 'Ended by the host');
    await signal(h, other, c!, 'offer');
    await signal(c!, other, h, 'answer');
    await call(h, 'end_room', other);
    expect(await kept(other)).toBe(0);
  });
});

describe('account deletion', () => {
  test('account deletion removes created rooms, sessions and signals', async () => {
    const a = await named('Ana');
    const b = await named('Bia');
    const c = await named('Caio');
    const theirs = await create(c, 'Caio room');
    await joinRoom(a, theirs);
    const own = await create(a, 'Ana room');
    await joinRoom(b, own);
    await t.as(a);
    await t.db.query(`insert into room_signals (room_id, sender, recipient, kind, payload) values ($1, $2, $3, 'offer', '{}')`, [own, a, b]);
    await t.as(b);
    await t.db.query(`insert into room_signals (room_id, sender, recipient, kind, payload) values ($1, $2, $3, 'answer', '{}')`, [own, b, a]);
    await owner('delete from auth.users where id = $1', [a]);
    expect(await count('select count(*)::int as n from rooms where id = $1', [own])).toBe(0);
    expect(await count('select count(*)::int as n from room_sessions where user_id = $1 or room_id = $2', [a, own])).toBe(0);
    expect(await count('select count(*)::int as n from room_signals where $1 in (sender, recipient) or room_id = $2', [a, own])).toBe(0);
    expect(await peopleIn(c, theirs)).toEqual([c]);
  });

  test('the current host deleting their account keeps the room: a live heir takes over, or the room ends', async () => {
    const x = await named('Xavi');
    const y = await named('Yara');
    const z = await named('Zeca');
    const room = await create(x, 'Kept room');
    await joinRoom(y, room);
    await joinRoom(z, room);
    await call(x, 'pass_host', room, y);
    await call(y, 'make_room_moderator', room, z);
    await owner('delete from auth.users where id = $1', [y]);
    expect(await count('select count(*)::int as n from rooms where id = $1', [room])).toBe(1);
    expect(await count('select count(*)::int as n from room_sessions where room_id = $1 and user_id = $2', [room, x])).toBe(1);
    expect(await state(x, room)).toMatchObject({ hostId: z, endedAt: null, me: { live: true } });
    expect(await peopleIn(z, room)).toEqual([x, z].sort());

    // Alone in the room when the account goes: the room ends, and stays for its creator.
    const w = await named('Wil');
    const second = await create(x, 'Second room');
    await joinRoom(w, second);
    await call(x, 'pass_host', second, w);
    await leaveRoom(x, second);
    await owner('delete from auth.users where id = $1', [w]);
    const s = await state(x, second);
    expect(s).toMatchObject({ hostId: null, me: { live: false } });
    expect(s!.endedAt).not.toBeNull();
    expect(await count('select count(*)::int as n from room_sessions where room_id = $1 and user_id = $2', [second, x])).toBe(1);
  });
});

describe('badges', () => {
  const badges = async (who: string) => (await rows<{ id: string; grp: string; label: string }>(who, 'select id, grp, label from public.profile_badges($1)', [who]));

  test('Room host at 5 rooms where someone else had a session (4 → no badge)', async () => {
    const a = await named('Ana');
    const b = await named('Bia');
    await owner(
      `insert into rooms (created_by, host, title, theme, created_at, ended_at)
       select $1, $1, 'Room ' || g, 'free', now() - interval '2 days', now() - interval '2 days' from generate_series(1, 5) g`,
      [a],
    );
    const session = `insert into room_sessions (room_id, user_id, joined_at, left_at)
      select id, $1, created_at, created_at + interval '10 minutes' from rooms where created_by = $2`;
    await owner(session, [a, a]);
    await owner(`${session} and title <> 'Room 5'`, [b, a]);
    expect((await badges(a)).map((x) => x.id)).not.toContain('room_host');
    await owner(`${session} and title = 'Room 5'`, [b, a]);
    const ids = (await badges(a)).map((x) => x.id);
    expect((await badges(a)).find((x) => x.id === 'room_host')).toEqual({ id: 'room_host', grp: 'community', label: 'Room host' });
    expect(ids.indexOf('room_host')).toBeGreaterThan(ids.indexOf('founding_member'));
  });

  test('Active speaker at 10 overlapping 5-minute sessions (9 → no badge)', async () => {
    const a = await named('Ana');
    const b = await named('Bia');
    await owner(
      `insert into rooms (created_by, host, title, theme, created_at, ended_at)
       select $1, $1, 'Talk ' || g, 'free', now() - make_interval(days => g), now() - make_interval(days => g) + interval '1 hour'
       from generate_series(1, 11) g`,
      [b],
    );
    // Ana: 6 minutes in each room. The 10th room is left open but silent (its end is the last heartbeat).
    await owner(
      `insert into room_sessions (room_id, user_id, joined_at, left_at)
       select id, $1, created_at, case when title = 'Talk 10' then null else created_at + interval '6 minutes' end
       from rooms where created_by = $2`,
      [a, b],
    );
    await owner(
      `update room_presence p set last_seen = r.created_at + interval '6 minutes'
       from room_sessions s join rooms r on r.id = s.room_id
       where s.id = p.session_id and s.user_id = $1 and r.title = 'Talk 10'`,
      [a],
    );
    // Bia overlaps 6 minutes in Talk 1–9, 4 minutes in Talk 10 and only 4 minutes in Talk 11.
    await owner(
      `insert into room_sessions (room_id, user_id, joined_at, left_at)
       select id, $1, created_at + case when title in ('Talk 10', 'Talk 11') then interval '2 minutes' else interval '0 minutes' end,
         created_at + interval '30 minutes'
       from rooms where created_by = $1`,
      [b],
    );
    const has = async () => (await badges(a)).find((x) => x.id === 'active_speaker');
    expect(await has()).toBeUndefined();
    await owner(
      `update room_sessions s set joined_at = r.created_at from rooms r
       where r.id = s.room_id and r.title = 'Talk 10' and s.user_id = $1`,
      [b],
    );
    expect(await has()).toEqual({ id: 'active_speaker', grp: 'community', label: 'Active speaker' });
  });
});

test('0009 has no invisible or unusual space characters that a paste in the SQL Editor could change', () => {
  const sql = readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', '0009_rooms.sql'), 'utf8');
  const invisible = [0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff, 0x200b, 0x200c, 0x200d, 0x2060];
  for (let c = 0x2000; c <= 0x200a; c++) invisible.push(c);
  const found = [...sql].map((ch) => ch.codePointAt(0)!).filter((c) => invisible.includes(c));
  expect(found.map((c) => c.toString(16))).toEqual([]);
});
