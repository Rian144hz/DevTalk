// The live room bridge: while the person sits in a voice room, the room's changes and the signals for them reach the
// window as room events, and a heartbeat keeps their seat. The voice itself never passes through main.
import { ROOM_HEARTBEAT_MS, type RoomLiveEvent } from '../../core/social/rooms';
import type { SocialBackend } from './backend';

export type { RoomLiveEvent };

export interface RoomLive {
  /**
   * Follows a room the person has just entered (created or joined): leaves any other room first, subscribes and
   * starts the heartbeat. Entering the room already followed changes nothing. Never throws.
   */
  enter(roomId: string): void;
  /**
   * Gives up the seat: stops the heartbeat, unsubscribes and tells the server. Never throws. With no room followed it
   * resolves once any leave already on its way is done, so quitting can wait for it.
   */
  exit(): Promise<void>;
  /** The room being followed; null when none, or after the server said the person is no longer in it. */
  current(): string | null;
  /** True while a leave call is still on its way to the server. */
  leaving(): boolean;
}

export interface RoomLiveDeps {
  backend: Pick<SocialBackend, 'subscribeRoom' | 'roomHeartbeat' | 'leaveRoom'>;
  emit: (e: RoomLiveEvent) => void;
  /** Default 30 s. */
  heartbeatMs?: number;
  /** Timers can be replaced in tests. */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
}

/** One followed room. Everything that arrives late, from an earlier room or after exit, finds `open` false and is dropped. */
interface Following {
  roomId: string;
  open: boolean;
  timer: unknown;
  off: (() => void) | null;
  /** A heartbeat is on its way; the next tick waits for it. */
  beating: boolean;
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
  const setTimer = deps.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearTimer = deps.clearInterval ?? ((id) => globalThis.clearInterval(id as ReturnType<typeof globalThis.setInterval>));
  let following: Following | null = null;
  /** Leave calls on their way. */
  const leaves = new Set<Promise<void>>();

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
    try {
      f.off?.();
    } catch {
      // Already closed.
    }
    f.off = null;
    if (following === f) following = null;
  };

  const leave = (roomId: string): Promise<void> => {
    const done = (async () => {
      try {
        await backend.leaveRoom(roomId);
      } catch {
        // Offline: the seat frees itself after 90 seconds without a heartbeat.
      }
    })();
    leaves.add(done);
    void done.then(() => leaves.delete(done));
    return done;
  };

  const beat = async (f: Following) => {
    if (f.beating) return;
    f.beating = true;
    try {
      const still = await backend.roomHeartbeat(f.roomId);
      if (!f.open) return;
      if (!still) {
        // The seat is gone (removed, room ended, or too long offline). The window asks for the state and shows what happened.
        stop(f);
        emit({ kind: 'changed' });
        return;
      }
      if (!f.beat) {
        f.beat = true;
        publish(f);
      }
    } catch {
      if (!f.open) return;
      if (f.beat) {
        f.beat = false;
        publish(f);
      }
    } finally {
      f.beating = false;
    }
  };

  return {
    enter(roomId) {
      if (following?.roomId === roomId) return;
      const previous = following;
      if (previous) {
        stop(previous);
        void leave(previous.roomId);
      }
      const f: Following = { roomId, open: true, timer: null, off: null, beating: false, socket: null, beat: true, shown: null };
      following = f;
      try {
        // The channel may open a little later; whatever comes back is what closes it.
        f.off = backend.subscribeRoom(roomId, (e) => {
          if (!f.open) return;
          if (e.kind === 'online' || e.kind === 'offline') {
            f.socket = e.kind === 'online';
            publish(f);
          } else {
            emit(e);
          }
        });
      } catch {
        // No channel right now: the heartbeat still keeps the seat, and the window refreshes when it asks.
      }
      f.timer = setTimer(() => void beat(f), heartbeatMs);
    },

    async exit() {
      const f = following;
      if (!f) {
        await Promise.all([...leaves]);
        return;
      }
      stop(f);
      await leave(f.roomId);
    },

    current: () => following?.roomId ?? null,
    leaving: () => leaves.size > 0,
  };
}
