import type { RoomLiveEvent, RoomPerson, RoomState } from '../../src/core/social/rooms';
import type { Result } from '../../src/shared/ipc-contract';
import { AppErrorException } from '../../src/renderer/lib/result';
import { RETRY_MS, RoomCall } from '../../src/renderer/lib/room-call';
import { enterRoom, type RoomsApi, type RoomSession } from '../../src/renderer/lib/room-session';
import { FakeStream, FakeWorld, asStream, settle } from './fake-peer';

const ROOM = '00000000-0000-4000-8000-000000000001';
const TIMEOUT = 1_000;
const ME = 'm';
const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
const person = (id: string, displayName: string, role: RoomPerson['role'] = 'member'): RoomPerson => ({
  id, displayName, hasAvatar: false, mascot: null, level: 'B1', role,
});
const rian = person(ME, 'Rian');
const bia = person('b', 'Bia', 'host');
const caio = person('c', 'Caio');

function roomState(people: RoomPerson[], me: Partial<RoomState['me']> = {}, extra: Partial<RoomState> = {}): RoomState {
  return {
    id: ROOM, title: 'Stand-up practice', theme: 'standup', level: 'B1', hostId: people.find((p) => p.role === 'host')?.id ?? null,
    endedAt: null, timer: null, card: 0, me: { live: true, removed: false, role: 'member', muteRequestedAt: null, ...me }, people, ...extra,
  };
}

/** The window's room API, against a room whose state the test sets. Every call is logged in order. */
function fakeRooms() {
  const log: string[] = [];
  const listeners = new Set<(e: RoomLiveEvent) => void>();
  const held: ((r: Result<RoomState | null>) => void)[] = [];
  const t = {
    log,
    current: roomState([bia, rian]) as RoomState | null,
    /** State answers wait until the test gives them. */
    hold: false,
    held,
    enter: ok(null) as Result<null>,
    created: ok(ROOM) as Result<string>,
    /** Runs inside join/create, before it answers. */
    whileEntering: async () => {},
    /** Signals sent to someone. */
    onSignal: (_to: string, _signal: string, _payload: string) => {},
    emit(e: RoomLiveEvent) {
      for (const l of [...listeners]) l(e);
    },
  };
  const rooms: RoomsApi = {
    onEvent(cb) {
      log.push('listen');
      listeners.add(cb);
      return () => {
        log.push('stop listening');
        listeners.delete(cb);
      };
    },
    settings: async () => ok({ connectTimeoutMs: TIMEOUT }),
    async join(roomId) {
      log.push(`join ${roomId}`);
      await t.whileEntering();
      return t.enter;
    },
    async create(draft) {
      log.push(`create ${draft.title}`);
      await t.whileEntering();
      return t.created;
    },
    async leave(roomId) {
      log.push(`leave ${roomId}`);
      return ok(null);
    },
    state() {
      log.push('state');
      if (t.hold) return new Promise((resolve) => held.push(resolve));
      return Promise.resolve(ok(structuredClone(t.current)));
    },
    async signal(_roomId, to, signal, payload) {
      log.push(`signal ${to} ${signal}`);
      t.onSignal(to, signal, payload);
      return ok(null);
    },
  };
  return { t, rooms };
}

function setup() {
  const { t, rooms } = fakeRooms();
  const world = new FakeWorld();
  const mic = new FakeStream('mic-m');
  const enter = (target: { join: string } | { create: { title: string; theme: 'standup'; level: null } } = { join: ROOM }) =>
    enterRoom({ rooms, myId: ME, stream: asStream(mic), createPeer: () => world.peer(ME), target });
  /** Bia's window, connected to the same signals: what she sends arrives as room events. */
  const biaWindow = () => {
    const call = new RoomCall({
      myId: 'b', stream: asStream(new FakeStream('mic-b')), createPeer: () => world.peer('b'), timeoutMs: TIMEOUT,
      send: (_to, signal, payload) => queueMicrotask(() => t.emit({ kind: 'signal', from: 'b', signal, payload })),
      onPeer: () => {},
    });
    t.onSignal = (to, signal, payload) => {
      if (to === 'b') queueMicrotask(() => void call.handle(ME, signal as never, payload));
    };
    return call;
  };
  return { t, world, mic, enter, biaWindow };
}

const changed = async (t: ReturnType<typeof fakeRooms>['t'], next: RoomState | null) => {
  t.current = next;
  t.emit({ kind: 'changed' });
  await settle();
};

let session: RoomSession | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(async () => {
  await session?.leave();
  session = null;
  vi.useRealTimers();
});

test('listens before joining: an offer that comes before join answers still reaches the call', async () => {
  const { t, enter, biaWindow } = setup();
  const b = biaWindow();
  // Bia's window offers the moment it sees Rian, before his join has even answered.
  t.whileEntering = async () => {
    b.sync(['b', ME]);
    await settle();
  };
  session = await enter();
  await settle();

  expect(t.log.slice(0, 2)).toEqual(['listen', `join ${ROOM}`]);
  expect(t.log).toContain('signal b answer');
  expect(session.snapshot().peers['b']?.state).toBe('connected');
  expect(session.snapshot().peers['b']?.stream).not.toBeNull();
  expect(session.snapshot().state?.people.map((p) => p.displayName)).toEqual(['Bia', 'Rian']);
  expect(session.roomId).toBe(ROOM);
});

test('create opens the new room; a failed join stops listening, throws the friendly error and leaves the microphone alone', async () => {
  const created = setup();
  created.t.created = ok('00000000-0000-4000-8000-000000000002');
  session = await created.enter({ create: { title: 'Mock interview', theme: 'standup', level: null } });
  expect(created.t.log.slice(0, 2)).toEqual(['listen', 'create Mock interview']);
  expect(session.roomId).toBe('00000000-0000-4000-8000-000000000002');

  const refused = setup();
  refused.t.enter = { ok: false, error: { kind: 'validation', message: 'This room is full.' } };
  const failure = await refused.enter().catch((e: unknown) => e);
  expect(failure).toBeInstanceOf(AppErrorException);
  expect((failure as Error).message).toBe('This room is full.');
  expect(refused.t.log).toEqual(['listen', `join ${ROOM}`, 'stop listening']);
  expect(refused.mic.tracks[0]!.stopped).toBe(false);
});

test('only the newest state is shown and synced: a slower, older answer never says bye to someone', async () => {
  const { t, enter } = setup();
  t.hold = true;
  session = await enter();
  t.emit({ kind: 'changed' });
  expect(t.held).toHaveLength(2);
  t.held[1]!(ok(roomState([bia, rian])));
  await settle();
  t.held[0]!(ok(roomState([rian])));
  await settle();

  expect(session.snapshot().state?.people.map((p) => p.id)).toEqual(['b', ME]);
  expect(t.log).not.toContain('signal b bye');
  expect(session.snapshot().peers['b']?.state).toBe('connecting');
});

test('arrivals, departures, a removal you made and a new host are told in one line', async () => {
  const { t, enter } = setup();
  session = await enter();
  await settle();
  expect(session.snapshot().activity).toBeNull();

  await changed(t, roomState([bia, rian, caio]));
  expect(session.snapshot().activity?.text).toBe('Caio joined.');
  await changed(t, roomState([rian, caio], {}, { hostId: ME }));
  expect(session.snapshot().activity?.text).toBe('Bia left. You are the host now.');
  const before = session.snapshot().activity!.id;
  session.noteRemoval('c', 'Caio');
  await changed(t, roomState([person(ME, 'Rian', 'host')], { role: 'host' }));
  expect(session.snapshot().activity?.text).toBe('Caio was removed from the room.');
  expect(session.snapshot().activity!.id).toBeGreaterThan(before);
  // Nothing changed: the line stays as it was.
  await changed(t, roomState([person(ME, 'Rian', 'host')], { role: 'host' }));
  expect(session.snapshot().activity?.text).toBe('Caio was removed from the room.');
});

test('the host asks you to mute: the microphone mutes once per request, and the notice stays until you unmute', async () => {
  const { t, mic, enter } = setup();
  session = await enter();
  await settle();
  const track = mic.tracks[0]!;

  await changed(t, roomState([bia, rian], { muteRequestedAt: '2026-10-20T10:00:00Z' }));
  expect(session.snapshot()).toMatchObject({ muted: true, hostMuted: true });
  expect(track.enabled).toBe(false);

  session.setMuted(false);
  expect(session.snapshot()).toMatchObject({ muted: false, hostMuted: false });
  expect(track.enabled).toBe(true);
  // The same request again changes nothing.
  await changed(t, roomState([bia, rian], { muteRequestedAt: '2026-10-20T10:00:00Z' }));
  expect(session.snapshot().muted).toBe(false);
  // A new request mutes again.
  await changed(t, roomState([bia, rian], { muteRequestedAt: '2026-10-20T10:05:00Z' }));
  expect(session.snapshot()).toMatchObject({ muted: true, hostMuted: true });
  // Muting yourself is not the host's request.
  session.setMuted(false);
  session.setMuted(true);
  expect(session.snapshot()).toMatchObject({ muted: true, hostMuted: false });
  expect(track.enabled).toBe(false);
});

test.each([
  ['removed', roomState([], { live: false, removed: true })],
  ['ended', roomState([], { live: false }, { endedAt: '2026-10-20T10:00:00Z' })],
  ['gone', roomState([], { live: false })],
  ['gone', null],
] as const)('out of the room (%s): the call closes, the seat is given up and nothing more happens', async (outcome, last) => {
  const { t, mic, enter } = setup();
  session = await enter();
  await settle();
  const seen: (string | null)[] = [];
  session.subscribe(() => seen.push(session!.snapshot().outcome));

  await changed(t, last);
  expect(session.snapshot().outcome).toBe(outcome);
  expect(seen.at(-1)).toBe(outcome);
  expect(t.log.slice(-2)).toEqual(['stop listening', `leave ${ROOM}`]);
  expect(mic.tracks[0]!.stopped).toBe(true);
  const calls = t.log.length;
  t.emit({ kind: 'changed' });
  await session.leave();
  await settle();
  expect(t.log).toHaveLength(calls);
});

test('"Could not connect" comes on the move into failed, stays through a retry, and goes when they connect or leave', async () => {
  const { t, world, enter, biaWindow } = setup();
  world.stuck = true;
  session = await enter();
  await settle();
  vi.advanceTimersByTime(TIMEOUT);
  await settle();
  expect(session.snapshot().peers['b']?.state).toBe('failed');
  expect(session.snapshot().unreachable).toEqual(['b']);

  // It tries again by itself: connecting again, the notice stays.
  vi.advanceTimersByTime(RETRY_MS);
  await settle();
  expect(session.snapshot().peers['b']?.state).toBe('connecting');
  expect(session.snapshot().unreachable).toEqual(['b']);

  // The network lets them through: Bia's window offers and the pair connects.
  world.stuck = false;
  const b = biaWindow();
  b.sync(['b', ME]);
  await settle();
  expect(session.snapshot().peers['b']?.state).toBe('connected');
  expect(session.snapshot().unreachable).toEqual([]);

  // Someone who fails and then leaves takes the notice with them.
  await changed(t, roomState([bia, rian, caio]));
  world.stuck = true;
  vi.advanceTimersByTime(TIMEOUT);
  await settle();
  expect(session.snapshot().unreachable).toEqual(['c']);
  await changed(t, roomState([bia, rian]));
  expect(session.snapshot().unreachable).toEqual([]);
});

test('offline shows reconnecting; back online the state is read again', async () => {
  const { t, enter } = setup();
  session = await enter();
  await settle();
  t.emit({ kind: 'offline' });
  expect(session.snapshot().offline).toBe(true);
  const reads = t.log.filter((l) => l === 'state').length;
  t.current = roomState([bia, rian, caio]);
  t.emit({ kind: 'online' });
  await settle();
  expect(session.snapshot().offline).toBe(false);
  expect(t.log.filter((l) => l === 'state').length).toBe(reads + 1);
  expect(session.snapshot().state?.people).toHaveLength(3);
});

test('leave says bye to every peer before giving up the seat, stops the microphone, and ignores what comes after', async () => {
  const { t, mic, enter } = setup();
  session = await enter();
  await settle();
  expect(session.snapshot().peers['b']?.state).toBe('connecting');
  const updates = vi.fn();
  session.subscribe(updates);

  await session.leave();
  expect(t.log.indexOf('signal b bye')).toBeGreaterThan(-1);
  expect(t.log.indexOf('signal b bye')).toBeLessThan(t.log.indexOf(`leave ${ROOM}`));
  expect(t.log).toContain('stop listening');
  expect(mic.tracks[0]!.stopped).toBe(true);
  expect(session.snapshot().outcome).toBeNull();

  const calls = t.log.length;
  t.emit({ kind: 'changed' });
  session.setMuted(true);
  await session.leave();
  await settle();
  expect(t.log).toHaveLength(calls);
  expect(updates).not.toHaveBeenCalled();
});
