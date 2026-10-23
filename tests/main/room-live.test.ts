import { vi } from 'vitest';
import type { RoomLiveEvent } from '../../src/core/social/rooms';
import { ROOM_CONNECT_TIMEOUT_MS } from '../../src/core/social/rooms';
import type { SocialBackend } from '../../src/main/social/backend';
import { roomConnectTimeoutMs } from '../../src/main/social/config';
import { createFakeSocialBackend } from '../../src/main/social/fake-backend';
import { SocialError } from '../../src/main/social/errors';
import { createRoomLive } from '../../src/main/social/room-live';

const HEARTBEAT = 30_000;
const RETRY = 5_000;
const TIMEOUT = 10_000;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A backend that only counts: the pieces room-live talks to. */
function stub(over: Partial<Record<'roomHeartbeat' | 'leaveRoom' | 'subscribeRoom', unknown>> = {}) {
  const log: string[] = [];
  const listeners = new Map<string, (e: RoomLiveEvent) => void>();
  const backend = {
    configured: true,
    roomHeartbeat: vi.fn(async (room: string) => {
      log.push(`beat ${room}`);
      return true;
    }),
    leaveRoom: vi.fn(async (room: string) => {
      log.push(`leave ${room}`);
    }),
    subscribeRoom: vi.fn((room: string, onEvent: (e: RoomLiveEvent) => void) => {
      log.push(`subscribe ${room}`);
      listeners.set(room, onEvent);
      return () => void log.push(`unsubscribe ${room}`);
    }),
    ...over,
  } as unknown as SocialBackend;
  return { backend, log, listeners };
}

function live(over: Parameters<typeof stub>[0] = {}) {
  const s = stub(over);
  const events: RoomLiveEvent[] = [];
  const bridge = createRoomLive({ backend: s.backend, emit: (e) => events.push(e) });
  return { ...s, events, bridge };
}

describe('lifecycle', () => {
  test('enter subscribes to the room and heartbeats every 30 seconds', async () => {
    const { bridge, backend, log } = live();
    bridge.enter('r1');
    expect(bridge.current()).toBe('r1');
    expect(log).toEqual(['subscribe r1']);
    await vi.advanceTimersByTimeAsync(HEARTBEAT - 1);
    expect(backend.roomHeartbeat).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(backend.roomHeartbeat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2 * HEARTBEAT);
    expect(backend.roomHeartbeat).toHaveBeenCalledTimes(3);
    expect(backend.roomHeartbeat).toHaveBeenCalledWith('r1');
  });

  test('exit leaves the room, unsubscribes and stops the heartbeat', async () => {
    const { bridge, backend, log } = live();
    bridge.enter('r1');
    await bridge.exit();
    expect(log).toEqual(['subscribe r1', 'unsubscribe r1', 'leave r1']);
    expect(bridge.current()).toBeNull();
    await vi.advanceTimersByTimeAsync(3 * HEARTBEAT);
    expect(backend.roomHeartbeat).not.toHaveBeenCalled();
  });

  test('exit without a room does nothing; a second exit leaves only once', async () => {
    const { bridge, backend } = live();
    await bridge.exit();
    expect(backend.leaveRoom).not.toHaveBeenCalled();
    bridge.enter('r1');
    await Promise.all([bridge.exit(), bridge.exit()]);
    expect(backend.leaveRoom).toHaveBeenCalledTimes(1);
  });

  test('a leave on its way is waited for: leaving() is true until it is done, and exit resolves after it', async () => {
    let done!: () => void;
    const { bridge } = live({ leaveRoom: vi.fn(() => new Promise<void>((resolve) => void (done = resolve))) });
    expect(bridge.leaving()).toBe(false);
    bridge.enter('r1');
    const first = bridge.exit();
    // Nothing is followed any more, but the server has not heard yet (the window closed, then the app quits).
    expect(bridge.current()).toBeNull();
    expect(bridge.leaving()).toBe(true);
    let second = false;
    void bridge.exit().then(() => void (second = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(second).toBe(false);
    done();
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(second).toBe(true);
    expect(bridge.leaving()).toBe(false);
  });

  test('entering another room leaves the first one before subscribing to the second', async () => {
    const { bridge, backend, log } = live();
    bridge.enter('r1');
    bridge.enter('r2');
    expect(bridge.current()).toBe('r2');
    expect(log).toEqual(['subscribe r1', 'unsubscribe r1', 'leave r1', 'subscribe r2']);
    await vi.advanceTimersByTimeAsync(HEARTBEAT);
    expect(backend.roomHeartbeat).toHaveBeenCalledTimes(1);
    expect(backend.roomHeartbeat).toHaveBeenCalledWith('r2');
  });

  test('entering the room you are in keeps the seat: no leave, one subscription, one timer', async () => {
    const { bridge, backend, log } = live();
    bridge.enter('r1');
    bridge.enter('r1');
    expect(log).toEqual(['subscribe r1']);
    await vi.advanceTimersByTimeAsync(HEARTBEAT);
    expect(backend.roomHeartbeat).toHaveBeenCalledTimes(1);
  });
});

describe('a create or join on its way when the seat is given up', () => {
  test('exit while the join is on its way: the room is left when the join answers, never followed', async () => {
    let answer!: (roomId: string) => void;
    const { bridge, backend, log } = live();
    const joined = bridge.entering(() => new Promise<string>((resolve) => void (answer = resolve)));
    // The window reloads (or crashes, closes, signs out) before the server answers.
    const exited = bridge.exit();
    let exitDone = false;
    void exited.then(() => void (exitDone = true));
    await vi.advanceTimersByTimeAsync(0);
    // Quitting waits for it: the seat will be given up.
    expect(exitDone).toBe(false);
    expect(bridge.leaving()).toBe(true);
    answer('r1');
    await expect(joined).resolves.toBe('r1');
    await exited;
    expect(bridge.current()).toBeNull();
    expect(log).toEqual(['leave r1']);
    expect(backend.subscribeRoom).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3 * HEARTBEAT);
    expect(backend.roomHeartbeat).not.toHaveBeenCalled();
    expect(bridge.leaving()).toBe(false);
  });

  test('without an exit the room it entered is followed; a refused call follows nothing and leaves nothing', async () => {
    const { bridge, backend, log } = live();
    await expect(bridge.entering(async () => 'r1')).resolves.toBe('r1');
    expect(bridge.current()).toBe('r1');
    expect(log).toEqual(['subscribe r1']);
    await expect(bridge.entering(async () => Promise.reject(new Error('room is full')))).rejects.toThrow('room is full');
    expect(bridge.current()).toBe('r1');
    // A join that fails after an exit leaves nothing.
    let refuse!: (e: Error) => void;
    const joining = bridge.entering(() => new Promise<string>((_, reject) => void (refuse = reject)));
    const exited = bridge.exit();
    refuse(new Error('offline'));
    await expect(joining).rejects.toThrow('offline');
    await exited;
    expect(backend.leaveRoom).toHaveBeenCalledTimes(1);
    expect(log).toEqual(['subscribe r1', 'unsubscribe r1', 'leave r1']);
  });

  test('only an exit after the call started counts: a join started after the exit is followed', async () => {
    const { bridge } = live();
    await bridge.exit();
    await bridge.entering(async () => 'r2');
    expect(bridge.current()).toBe('r2');
  });

  test('with the fake backend: sign-out during the join leaves the seat free', async () => {
    const fake = createFakeSocialBackend({ seed: 'people', now: () => Date.now() });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => void (release = resolve));
    const bridge = createRoomLive({ backend: fake, emit: () => {} });
    const biaRoom = (await fake.liveRooms())[0]!.id;
    const joining = bridge.entering(async () => {
      await gate;
      await fake.joinRoom(biaRoom);
      return biaRoom;
    });
    const exited = bridge.exit();
    release();
    await joining;
    await exited;
    expect(bridge.current()).toBeNull();
    expect((await fake.roomState(biaRoom))?.me.live).toBe(false);
    expect((await fake.liveRooms())[0]!.people.map((p) => p.displayName)).toEqual(['Bia', 'Caio']);
  });
});

describe('events', () => {
  test('forwards the events of the room and nothing after exit', async () => {
    const { bridge, listeners, events } = live();
    bridge.enter('r1');
    const hear = listeners.get('r1')!;
    hear({ kind: 'changed' });
    hear({ kind: 'signal', from: 'u2', signal: 'offer', payload: 'sdp' });
    expect(events).toEqual([{ kind: 'changed' }, { kind: 'signal', from: 'u2', signal: 'offer', payload: 'sdp' }]);
    await bridge.exit();
    hear({ kind: 'changed' });
    hear({ kind: 'online' });
    expect(events).toHaveLength(2);
  });

  test('nothing from the first room arrives once the second is entered', () => {
    const { bridge, listeners, events } = live();
    bridge.enter('r1');
    const old = listeners.get('r1')!;
    bridge.enter('r2');
    old({ kind: 'changed' });
    expect(events).toEqual([]);
    listeners.get('r2')!({ kind: 'changed' });
    expect(events).toEqual([{ kind: 'changed' }]);
  });

  test('with the fake backend: this room\'s changes and the signals addressed to me, not other rooms or other pairs', async () => {
    const backend = createFakeSocialBackend({ seed: 'people' });
    const ids = Object.fromEntries((await backend.peopleForTest()).map((p) => [p.displayName, p.id])) as Record<string, string>;
    const as = <T,>(name: string, act: (x: SocialBackend) => Promise<T>) => backend.actAsForTest(ids[name]!, act) as Promise<T>;
    const events: RoomLiveEvent[] = [];
    const bridge = createRoomLive({ backend, emit: (e) => events.push(e) });

    const mine = await backend.createRoom({ title: 'Code review night', theme: 'code_review', level: null });
    const biaRoom = (await backend.liveRooms()).find((r) => r.hostName === 'Bia')!.id;
    bridge.enter(mine);
    events.length = 0;

    // Another room changes: not mine to hear.
    await as('Caio', (x) => x.nextCard(biaRoom));
    expect(events).toEqual([]);

    // People join mine: I hear that it changed.
    await as('Ana', (x) => x.joinRoom(mine));
    await as('Dani', (x) => x.joinRoom(mine));
    expect(events.filter((e) => e.kind === 'changed').length).toBeGreaterThan(0);
    events.length = 0;

    // A signal between two other people is theirs; one addressed to me reaches me.
    await as('Ana', (x) => x.sendRoomSignal(mine, ids['Dani']!, 'offer', 'for-dani'));
    expect(events).toEqual([]);
    await as('Ana', (x) => x.sendRoomSignal(mine, ids['Rian']!, 'offer', 'for-rian'));
    expect(events).toEqual([{ kind: 'signal', from: ids['Ana'], signal: 'offer', payload: 'for-rian' }]);

    // exit leaves: the seat is gone and nothing arrives any more.
    events.length = 0;
    await bridge.exit();
    expect((await backend.roomState(mine))?.me.live).toBe(false);
    await as('Dani', (x) => x.nextCard(mine));
    await as('Ana', (x) => x.sendRoomSignal(mine, ids['Dani']!, 'bye', ''));
    expect(events).toEqual([]);
  });
});

describe('heartbeat', () => {
  test('a heartbeat that says false emits changed once and stops: no leave, no more beats, no more events', async () => {
    const { bridge, backend, events, log, listeners } = live({ roomHeartbeat: vi.fn(async () => false) });
    bridge.enter('r1');
    await vi.advanceTimersByTimeAsync(HEARTBEAT);
    expect(events).toEqual([{ kind: 'changed' }]);
    expect(bridge.current()).toBeNull();
    await vi.advanceTimersByTimeAsync(4 * HEARTBEAT);
    expect(backend.roomHeartbeat).toHaveBeenCalledTimes(1);
    expect(backend.leaveRoom).not.toHaveBeenCalled();
    expect(log).toEqual(['subscribe r1', 'unsubscribe r1']);
    listeners.get('r1')!({ kind: 'changed' });
    expect(events).toHaveLength(1);
    // Entering again (joining after being removed from the list) starts everything over.
    bridge.enter('r1');
    expect(bridge.current()).toBe('r1');
  });

  test('a heartbeat that throws is tried again every 5 seconds; offline once, online when one works, then every 30 s again', async () => {
    const beats = [new Error('offline'), new Error('offline'), true, true];
    const { bridge, backend, events } = live({
      roomHeartbeat: vi.fn(async () => {
        const next = beats.shift();
        if (next instanceof Error) throw next;
        return next;
      }),
    });
    bridge.enter('r1');
    await vi.advanceTimersByTimeAsync(HEARTBEAT);
    expect(events).toEqual([{ kind: 'offline' }]);
    await vi.advanceTimersByTimeAsync(RETRY);
    expect(backend.roomHeartbeat).toHaveBeenCalledTimes(2);
    expect(events).toEqual([{ kind: 'offline' }]);
    await vi.advanceTimersByTimeAsync(RETRY);
    expect(backend.roomHeartbeat).toHaveBeenCalledTimes(3);
    expect(events).toEqual([{ kind: 'offline' }, { kind: 'online' }]);
    // Back to the usual pace.
    await vi.advanceTimersByTimeAsync(HEARTBEAT - 1);
    expect(backend.roomHeartbeat).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(backend.roomHeartbeat).toHaveBeenCalledTimes(4);
    expect(events).toHaveLength(2);
    expect(bridge.current()).toBe('r1');
  });

  test('two failed heartbeats no longer lose the seat: fails at 30 s and 60 s, the retry at 65 s gets through (fake backend)', async () => {
    const fake = createFakeSocialBackend({ seed: 'people', now: () => Date.now() });
    let down = false;
    const tries: number[] = [];
    const start = Date.now();
    const backend = {
      subscribeRoom: fake.subscribeRoom.bind(fake),
      leaveRoom: fake.leaveRoom.bind(fake),
      roomHeartbeat: async (room: string) => {
        tries.push(Date.now() - start);
        if (down) throw new SocialError('offline', 'fetch failed');
        return fake.roomHeartbeat(room);
      },
    };
    const events: RoomLiveEvent[] = [];
    const bridge = createRoomLive({ backend, emit: (e) => events.push(e) });
    const room = await fake.createRoom({ title: 'Night shift talk', theme: 'free', level: null });
    bridge.enter(room);
    expect(events).toEqual([{ kind: 'online' }]);
    // The network drops just before the first heartbeat and comes back at 62 s.
    await vi.advanceTimersByTimeAsync(HEARTBEAT - 1);
    down = true;
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toEqual([{ kind: 'online' }, { kind: 'offline' }]);
    await vi.advanceTimersByTimeAsync(32_000);
    down = false;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(tries).toEqual([30_000, 35_000, 40_000, 45_000, 50_000, 55_000, 60_000, 65_000]);
    expect(events).toEqual([{ kind: 'online' }, { kind: 'offline' }, { kind: 'online' }]);
    // 65 s after joining the seat is still there (it would have gone at 90 s with a heartbeat only every 30 s).
    expect((await fake.roomState(room))?.me.live).toBe(true);
    await vi.advanceTimersByTimeAsync(HEARTBEAT);
    expect(tries.at(-1)).toBe(95_000);
    expect((await fake.roomState(room))?.me.live).toBe(true);
    expect(bridge.current()).toBe(room);
  });

  test('a hung heartbeat counts as failed after 10 seconds and does not block the next try; its late answer is ignored', async () => {
    const finishers: ((still: boolean) => void)[] = [];
    const answers: (boolean | 'hang')[] = ['hang', true];
    const { bridge, backend, events } = live({
      roomHeartbeat: vi.fn(() => {
        const next = answers.shift() ?? true;
        return next === 'hang' ? new Promise<boolean>((resolve) => void finishers.push(resolve)) : Promise.resolve(next);
      }),
    });
    bridge.enter('r1');
    await vi.advanceTimersByTimeAsync(HEARTBEAT);
    expect(backend.roomHeartbeat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(TIMEOUT - 1);
    expect(events).toEqual([]);
    expect(backend.roomHeartbeat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toEqual([{ kind: 'offline' }]);
    await vi.advanceTimersByTimeAsync(RETRY);
    expect(backend.roomHeartbeat).toHaveBeenCalledTimes(2);
    expect(events).toEqual([{ kind: 'offline' }, { kind: 'online' }]);
    // The hung request finally answers "not here": too late, it changes nothing.
    finishers[0]!(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toHaveLength(2);
    expect(bridge.current()).toBe('r1');
    await vi.advanceTimersByTimeAsync(HEARTBEAT);
    expect(backend.roomHeartbeat).toHaveBeenCalledTimes(3);
  });

  test('a slow heartbeat that answers within 10 seconds is waited for: no second one starts meanwhile', async () => {
    let finish!: (still: boolean) => void;
    const { bridge, backend, events } = live({
      roomHeartbeat: vi.fn(() => new Promise<boolean>((resolve) => void (finish = resolve))),
    });
    bridge.enter('r1');
    await vi.advanceTimersByTimeAsync(HEARTBEAT + TIMEOUT - 2_000);
    expect(backend.roomHeartbeat).toHaveBeenCalledTimes(1);
    finish(true);
    await vi.advanceTimersByTimeAsync(HEARTBEAT - 1);
    expect(backend.roomHeartbeat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(backend.roomHeartbeat).toHaveBeenCalledTimes(2);
    expect(events).toEqual([]);
  });

  test('when the room channel is online again, a heartbeat goes at once', async () => {
    const { bridge, backend, listeners, events } = live();
    bridge.enter('r1');
    const hear = listeners.get('r1')!;
    // The first online (the channel opening) is not a return.
    hear({ kind: 'online' });
    await vi.advanceTimersByTimeAsync(0);
    expect(backend.roomHeartbeat).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    hear({ kind: 'offline' });
    hear({ kind: 'online' });
    await vi.advanceTimersByTimeAsync(0);
    expect(backend.roomHeartbeat).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ kind: 'online' }, { kind: 'offline' }, { kind: 'online' }]);
    // The next one comes 30 seconds after that one, not at the old time.
    await vi.advanceTimersByTimeAsync(HEARTBEAT - 1);
    expect(backend.roomHeartbeat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(backend.roomHeartbeat).toHaveBeenCalledTimes(2);
  });

  test('back online while the heartbeat is failing: the heartbeat at once brings online back', async () => {
    let up = false;
    const { bridge, backend, listeners, events } = live({
      roomHeartbeat: vi.fn(async () => {
        if (!up) throw new Error('offline');
        return true;
      }),
    });
    bridge.enter('r1');
    const hear = listeners.get('r1')!;
    hear({ kind: 'online' });
    hear({ kind: 'offline' });
    await vi.advanceTimersByTimeAsync(HEARTBEAT);
    expect(events).toEqual([{ kind: 'online' }, { kind: 'offline' }]);
    await vi.advanceTimersByTimeAsync(2_000);
    up = true;
    hear({ kind: 'online' });
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([{ kind: 'online' }, { kind: 'offline' }, { kind: 'online' }]);
    expect(backend.roomHeartbeat).toHaveBeenCalledTimes(2);
  });

  test('the answer of a heartbeat sent before exit is ignored', async () => {
    let finish!: (still: boolean) => void;
    const { bridge, events } = live({ roomHeartbeat: vi.fn(() => new Promise<boolean>((resolve) => void (finish = resolve))) });
    bridge.enter('r1');
    await vi.advanceTimersByTimeAsync(HEARTBEAT);
    await bridge.exit();
    finish(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([]);
  });

  test('the answer of a heartbeat for the old room does not stop the new one', async () => {
    const finishers: ((still: boolean) => void)[] = [];
    const { bridge, events } = live({ roomHeartbeat: vi.fn(() => new Promise<boolean>((resolve) => void finishers.push(resolve))) });
    bridge.enter('r1');
    await vi.advanceTimersByTimeAsync(HEARTBEAT);
    bridge.enter('r2');
    finishers[0]!(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([]);
    expect(bridge.current()).toBe('r2');
  });

  test('connection changes of the channel are forwarded once, and combine with the heartbeat', async () => {
    const beats = [true, new Error('offline'), true];
    const { bridge, events, listeners } = live({
      roomHeartbeat: vi.fn(async () => {
        const next = beats.shift();
        if (next instanceof Error) throw next;
        return next;
      }),
    });
    bridge.enter('r1');
    const hear = listeners.get('r1')!;
    hear({ kind: 'online' });
    hear({ kind: 'online' });
    hear({ kind: 'offline' });
    hear({ kind: 'offline' });
    hear({ kind: 'online' });
    expect(events).toEqual([{ kind: 'online' }, { kind: 'offline' }, { kind: 'online' }]);
    // The channel is back: the heartbeat at once works, nothing changes.
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toHaveLength(3);
    events.length = 0;
    // The heartbeat fails while the channel is up: offline. The retry works: online.
    await vi.advanceTimersByTimeAsync(HEARTBEAT);
    await vi.advanceTimersByTimeAsync(RETRY);
    expect(events).toEqual([{ kind: 'offline' }, { kind: 'online' }]);
  });
});

describe('never throws', () => {
  test('a failing leave, subscribe or unsubscribe is swallowed', async () => {
    const { bridge } = live({
      leaveRoom: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    bridge.enter('r1');
    await expect(bridge.exit()).resolves.toBeUndefined();
    expect(bridge.current()).toBeNull();

    const broken = live({
      subscribeRoom: () => {
        throw new Error('no socket');
      },
    });
    expect(() => broken.bridge.enter('r1')).not.toThrow();
    // The seat is still kept alive by the heartbeat, and leaving still works.
    expect(broken.bridge.current()).toBe('r1');
    await vi.advanceTimersByTimeAsync(HEARTBEAT);
    expect(broken.backend.roomHeartbeat).toHaveBeenCalledTimes(1);
    await expect(broken.bridge.exit()).resolves.toBeUndefined();
    expect(broken.backend.leaveRoom).toHaveBeenCalledWith('r1');
    expect(broken.events).toEqual([]);

    const sloppy = live({
      subscribeRoom: () => () => {
        throw new Error('already closed');
      },
    });
    sloppy.bridge.enter('r1');
    await expect(sloppy.bridge.exit()).resolves.toBeUndefined();
    expect(sloppy.backend.leaveRoom).toHaveBeenCalledWith('r1');
  });

  test('works with the injected timers: the next beat, the deadline of one on its way, and the retry', async () => {
    const calls: { fn: () => void; ms: number; cleared: boolean }[] = [];
    let fail = true;
    const { backend } = stub({
      roomHeartbeat: vi.fn(async () => {
        if (fail) throw new Error('offline');
        return true;
      }),
    });
    const bridge = createRoomLive({
      backend,
      emit: () => {},
      heartbeatMs: 1000,
      retryMs: 200,
      beatTimeoutMs: 500,
      setTimeout: (fn, ms) => {
        const timer = { fn, ms, cleared: false };
        calls.push(timer);
        return timer;
      },
      clearTimeout: (id) => void ((id as (typeof calls)[number] | null) && ((id as (typeof calls)[number]).cleared = true)),
    });
    const pending = () => calls.filter((c) => !c.cleared).map((c) => c.ms);
    bridge.enter('r1');
    expect(pending()).toEqual([1000]);
    calls[0]!.fn();
    // On its way: only its deadline is pending.
    expect(backend.roomHeartbeat).toHaveBeenCalledWith('r1');
    expect(pending()).toEqual([500]);
    await vi.advanceTimersByTimeAsync(0);
    // It failed: the retry is pending.
    expect(pending()).toEqual([200]);
    fail = false;
    calls.at(-1)!.fn();
    await vi.advanceTimersByTimeAsync(0);
    expect(pending()).toEqual([1000]);
    await bridge.exit();
    expect(pending()).toEqual([]);
  });
});

describe('roomConnectTimeoutMs', () => {
  test('20 seconds by default', () => {
    expect(ROOM_CONNECT_TIMEOUT_MS).toBe(20_000);
    expect(roomConnectTimeoutMs({}, false)).toBe(20_000);
    expect(roomConnectTimeoutMs({ DEVTALK_ROOM_TIMEOUT_MS: undefined }, true)).toBe(20_000);
  });
  test('DEVTALK_ROOM_TIMEOUT_MS overrides it for dev and e2e, never when packaged', () => {
    expect(roomConnectTimeoutMs({ DEVTALK_ROOM_TIMEOUT_MS: '1500' }, false)).toBe(1500);
    expect(roomConnectTimeoutMs({ DEVTALK_ROOM_TIMEOUT_MS: '1500' }, true)).toBe(20_000);
  });
  test('only a positive whole number counts', () => {
    for (const bad of ['', '0', '-5', '1.5', 'abc', '1e3', ' 12', '12ms', '99999999999999999999']) {
      expect(roomConnectTimeoutMs({ DEVTALK_ROOM_TIMEOUT_MS: bad }, false)).toBe(20_000);
    }
  });
});
