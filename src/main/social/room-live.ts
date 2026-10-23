// The live room bridge: while the person sits in a voice room, the room's changes and the signals for them reach the
// window as room events, and a heartbeat keeps their seat. The voice itself never passes through main.
import { ROOM_HEARTBEAT_MS, type RoomLiveEvent } from '../../core/social/rooms';
import type { SocialBackend } from './backend';

export type { RoomLiveEvent };

/** After a failed heartbeat the next try comes this soon, until one gets through (a seat lasts 90 s without one). */
export const ROOM_HEARTBEAT_RETRY_MS = 5_000;
/** A heartbeat with no answer for this long counts as failed, so a hung request never holds up the next try. */
export const ROOM_HEARTBEAT_TIMEOUT_MS = 10_000;

export interface RoomLive {
  /**
   * Follows a room the person has just entered (created or joined): leaves any other room first, subscribes and
   * starts the heartbeat. Entering the room already followed changes nothing. Never throws.
   */
  enter(roomId: string): void;
  /**
   * Runs a create or join call and follows the room it entered (see enter). When exit() runs while the call is on its
   * way (the window reloaded, crashed or closed, or the person signed out), that room is left as soon as the call
   * answers, never followed. Resolves or rejects as the call does, after that leave.
   */
  entering(call: () => Promise<string>): Promise<string>;
  /**
   * Gives up the seat: stops the heartbeat, unsubscribes and tells the server. Never throws. Resolves once every leave
   * on its way is done, including the leave of a create or join that was on its way, so quitting can wait for it.
   */
  exit(): Promise<void>;
  /** The room being followed; null when none, or after the server said the person is no longer in it. */
  current(): string | null;
  /** True while a leave call is still on its way to the server, or a create or join whose room may need leaving. */
  leaving(): boolean;
}

export interface RoomLiveDeps {
  backend: Pick<SocialBackend, 'subscribeRoom' | 'roomHeartbeat' | 'leaveRoom'>;
  emit: (e: RoomLiveEvent) => void;
  /** Default 30 s. */
  heartbeatMs?: number;
  /** Default 5 s. */
  retryMs?: number;
  /** Default 10 s. */
  beatTimeoutMs?: number;
  /** Timers can be replaced in tests. */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

/** One followed room. Everything that arrives late, from an earlier room or after exit, finds `open` false and is dropped. */
interface Following {
  roomId: string;
  open: boolean;
  /** The next heartbeat, or the deadline of the one on its way. */
  timer: unknown;
  off: (() => void) | null;
  /** Numbers the heartbeats: an answer that is not for the latest one, or comes after its deadline, is ignored. */
  beats: number;
  /** What the channel last said; null until it says anything. */
  socket: boolean | null;
  /** Whether the last heartbeat got through. */
  beat: boolean;
  /** The connection state the window was last told about. */
  shown: boolean | null;
}

export function createRoomLive(deps: RoomLiveDeps): RoomLive {
  const { backend } = deps;
  const heartbeatMs = deps.heartbeatMs ?? ROOM_HEARTBEAT_MS;
  const retryMs = deps.retryMs ?? ROOM_HEARTBEAT_RETRY_MS;
  const beatTimeoutMs = deps.beatTimeoutMs ?? ROOM_HEARTBEAT_TIMEOUT_MS;
  const setTimer = deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearTimer = deps.clearTimeout ?? ((id) => globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>));
  let following: Following | null = null;
  /** Leave calls on their way. */
  const leaves = new Set<Promise<void>>();
  /** Create and join calls on their way (settled once their room is followed or left). */
  const entries = new Set<Promise<void>>();
  /** Moves on at every exit: a create or join that started before it must not follow its room. */
  let generation = 0;

  const emit = (e: RoomLiveEvent) => {
    try {
      deps.emit(e);
    } catch {
      // The window is gone; there is nobody to tell.
    }
  };

  /** Tells the window about the connection only when it changes: online needs the channel and the heartbeat both well. */
  const publish = (f: Following) => {
    const up = f.beat && f.socket !== false;
    if (up === f.shown) return;
    f.shown = up;
    emit({ kind: up ? 'online' : 'offline' });
  };

  /** Stops listening and beating. The server is told separately, or already knows. */
  const stop = (f: Following) => {
    f.open = false;
    clearTimer(f.timer);
    f.timer = null;
    try {
      f.off?.();
    } catch {
      // Already closed.
    }
    f.off = null;
    if (following === f) following = null;
  };

  const track = (set: Set<Promise<void>>, p: Promise<void>) => {
    set.add(p);
    void p.then(() => set.delete(p));
    return p;
  };

  const leave = (roomId: string): Promise<void> =>
    track(
      leaves,
      (async () => {
        try {
          await backend.leaveRoom(roomId);
        } catch {
          // Offline: the seat frees itself after 90 seconds without a heartbeat.
        }
      })(),
    );

  const schedule = (f: Following, ms: number) => {
    clearTimer(f.timer);
    f.timer = setTimer(() => beat(f), ms);
  };

  /**
   * Sends a heartbeat now, in place of any one waiting or on its way. Through: the next in 30 s. Failed or no answer
   * within the deadline: offline, and the next try in 5 s. "Not here any more": stop, and the window asks for the state.
   */
  const beat = (f: Following) => {
    if (!f.open) return;
    const id = ++f.beats;
    const settle = (still: boolean | null) => {
      if (!f.open || f.beats !== id) return;
      // Whatever answers next for this heartbeat (its deadline, or a late reply) is too late.
      f.beats++;
      if (still === false) {
        // The seat is gone (removed, room ended, or too long offline). The window asks for the state and shows what happened.
        stop(f);
        emit({ kind: 'changed' });
        return;
      }
      const through = still === true;
      if (f.beat !== through) {
        f.beat = through;
        publish(f);
      }
      schedule(f, through ? heartbeatMs : retryMs);
    };
    clearTimer(f.timer);
    f.timer = setTimer(() => settle(null), beatTimeoutMs);
    new Promise<boolean>((resolve) => resolve(backend.roomHeartbeat(f.roomId))).then(
      (still) => settle(Boolean(still)),
      () => settle(null),
    );
  };

  const enter = (roomId: string) => {
    if (following?.roomId === roomId) return;
    const previous = following;
    if (previous) {
      stop(previous);
      void leave(previous.roomId);
    }
    const f: Following = { roomId, open: true, timer: null, off: null, beats: 0, socket: null, beat: true, shown: null };
    following = f;
    schedule(f, heartbeatMs);
    try {
      // The channel may open a little later; whatever comes back is what closes it.
      f.off = backend.subscribeRoom(roomId, (e) => {
        if (!f.open) return;
        if (e.kind === 'online' || e.kind === 'offline') {
          const wasDown = f.socket === false;
          f.socket = e.kind === 'online';
          publish(f);
          // The connection is back: say "still here" at once rather than at the next beat or retry.
          if (f.socket && wasDown) beat(f);
        } else {
          emit(e);
        }
      });
    } catch {
      // No channel right now: the heartbeat still keeps the seat, and the window refreshes when it asks.
    }
  };

  return {
    enter,

    entering(call) {
      const ticket = generation;
      const run = (async () => {
        const roomId = await call();
        if (ticket === generation) enter(roomId);
        // The seat was given up while the call was on its way. A newer entry may already follow this same room.
        else if (following?.roomId !== roomId) await leave(roomId);
        return roomId;
      })();
      track(
        entries,
        run.then(
          () => {},
          () => {},
        ),
      );
      return run;
    },

    async exit() {
      generation++;
      const f = following;
      const waits = [...leaves, ...entries];
      if (f) {
        stop(f);
        waits.push(leave(f.roomId));
      }
      await Promise.all(waits);
    },

    current: () => following?.roomId ?? null,
    leaving: () => leaves.size > 0 || entries.size > 0,
  };
}
