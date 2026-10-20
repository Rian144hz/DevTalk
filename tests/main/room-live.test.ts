import { vi } from 'vitest';
import type { RoomLiveEvent } from '../../src/core/social/rooms';
import { ROOM_CONNECT_TIMEOUT_MS } from '../../src/core/social/rooms';
import type { SocialBackend } from '../../src/main/social/backend';
import { roomConnectTimeoutMs } from '../../src/main/social/config';
import { createFakeSocialBackend } from '../../src/main/social/fake-backend';
import { createRoomLive } from '../../src/main/social/room-live';

const HEARTBEAT = 30_000;

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

  test('a heartbeat that throws keeps trying; offline once, online when one works again', async () => {
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
    await vi.advanceTimersByTimeAsync(HEARTBEAT);
    expect(events).toEqual([{ kind: 'offline' }]);
    await vi.advanceTimersByTimeAsync(HEARTBEAT);
    expect(events).toEqual([{ kind: 'offline' }, { kind: 'online' }]);
    await vi.advanceTimersByTimeAsync(HEARTBEAT);
    expect(events).toHaveLength(2);
    expect(backend.roomHeartbeat).toHaveBeenCalledTimes(4);
    expect(bridge.current()).toBe('r1');
  });

  test('a heartbeat does not stack on a slow one', async () => {
    let finish!: (still: boolean) => void;
    const { bridge, backend } = live({ roomHeartbeat: vi.fn(() => new Promise<boolean>((resolve) => void (finish = resolve))) });
    bridge.enter('r1');
    await vi.advanceTimersByTimeAsync(3 * HEARTBEAT);
    expect(backend.roomHeartbeat).toHaveBeenCalledTimes(1);
    finish(true);
    await vi.advanceTimersByTimeAsync(HEARTBEAT);
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
    const beats = [new Error('offline'), true];
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
    events.length = 0;
    // The heartbeat fails while the channel is up: offline. It works again: online.
    await vi.advanceTimersByTimeAsync(HEARTBEAT);
    await vi.advanceTimersByTimeAsync(HEARTBEAT);
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

  test('works with the injected timer', async () => {
    const calls: { fn: () => void; ms: number; cleared: boolean }[] = [];
    const { backend } = stub();
    const bridge = createRoomLive({
      backend,
      emit: () => {},
      heartbeatMs: 1000,
      setInterval: (fn, ms) => {
        const timer = { fn, ms, cleared: false };
        calls.push(timer);
        return timer;
      },
      clearInterval: (id) => void ((id as (typeof calls)[number]).cleared = true),
    });
    bridge.enter('r1');
    expect(calls.map((c) => c.ms)).toEqual([1000]);
    calls[0]!.fn();
    await Promise.resolve();
    expect(backend.roomHeartbeat).toHaveBeenCalledWith('r1');
    await bridge.exit();
    expect(calls[0]!.cleared).toBe(true);
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
