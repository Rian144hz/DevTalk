// One person's seat in a voice room, from entering to leaving: the room's live events, its latest state, the call to
// every other live person, and what the room view should tell them. The view renders `snapshot()`. Nothing is
// recorded: the microphone goes only into the call.
import type { RoomDraft, RoomLiveEvent, RoomState } from '../../core/social/rooms';
import type { DevtalkApi, Result } from '../../shared/ipc-contract';
import { unwrap } from './result';
import { latestOnly } from './latest';
import { RoomCall, type PeerLike, type PeerState } from './room-call';
import type { RoomOutcome } from './rooms';

export type RoomsApi = Pick<DevtalkApi['rooms'], 'join' | 'create' | 'leave' | 'state' | 'signal' | 'settings' | 'setMuted' | 'onEvent'>;

export interface PeerView {
  state: PeerState;
  /** Their voice, once it arrives; null before that and once failed. */
  stream: MediaStream | null;
}

export interface RoomSnapshot {
  /** Null until the first state arrives. */
  state: RoomState | null;
  /** Why the last read of the room failed; null once a read works. The room shown, if any, stays. */
  readError: string | null;
  /** The call to each person, by id. */
  peers: Readonly<Record<string, PeerView>>;
  /** Your microphone is off. */
  muted: boolean;
  /** The host or a room moderator asked you to mute; shown until you unmute. */
  hostMuted: boolean;
  /** The connection to the community is down; the room comes back with it. */
  offline: boolean;
  /** People the call could not reach, in the order it gave up; each stays until they connect or leave. */
  unreachable: readonly string[];
  /** The latest arrivals, departures and host change, as one line. A new id means a new line. */
  activity: { id: number; text: string } | null;
  /** Set when you are out of the room without pressing Leave (removed, room ended, seat lost). */
  outcome: RoomOutcome | null;
}

export interface EnterOptions {
  rooms: RoomsApi;
  myId: string;
  /** Your microphone; from here on the session owns it and stops it when it ends. */
  stream: MediaStream;
  createPeer(): PeerLike;
  target: { join: string } | { create: RoomDraft };
}

/** Events kept while join or create is on its way (the others may already be offering). */
const MAX_EARLY = 500;

/**
 * Enters a room: listens to room events first, then joins (or creates) it, so nothing sent in between is lost.
 * Throws the friendly error when the room cannot be entered; the microphone is then still the caller's.
 */
export async function enterRoom(o: EnterOptions): Promise<RoomSession> {
  const settings = await o.rooms.settings();
  const timeoutMs = settings.ok ? settings.data.connectTimeoutMs : undefined;
  const early: RoomLiveEvent[] = [];
  let session: RoomSession | null = null;
  const off = o.rooms.onEvent((e) => {
    if (session) session.receive(e);
    else if (early.length < MAX_EARLY) early.push(e);
  });
  let roomId: string;
  try {
    if ('join' in o.target) {
      unwrap(await o.rooms.join(o.target.join));
      roomId = o.target.join;
    } else {
      roomId = unwrap(await o.rooms.create(o.target.create));
    }
  } catch (e) {
    off();
    throw e;
  }
  const entered = new RoomSession(o, roomId, off, timeoutMs);
  session = entered;
  for (const e of early) entered.receive(e);
  void entered.refresh();
  return entered;
}

export class RoomSession {
  readonly stream: MediaStream;
  private snap: RoomSnapshot = {
    state: null, readError: null, peers: {}, muted: false, hostMuted: false, offline: false, unreachable: [], activity: null, outcome: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly call: RoomCall;
  private readonly latest = latestOnly();
  private closed = false;
  private lines = 0;
  /** The last mute request seen; a new session starts with none. */
  private muteRequest: string | null = null;
  /** The other live people of the last state, id → name. */
  private people = new Map<string, string>();
  /** What to say when someone leaves, instead of "<name> left." (you removed them). */
  private readonly departures = new Map<string, string>();

  constructor(
    private readonly o: EnterOptions,
    readonly roomId: string,
    private readonly off: () => void,
    timeoutMs?: number,
  ) {
    this.stream = o.stream;
    this.call = new RoomCall({
      myId: o.myId,
      stream: o.stream,
      createPeer: o.createPeer,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      send: (to, signal, payload) => o.rooms.signal(roomId, to, signal, payload),
      onPeer: (id, state, stream) => this.onPeer(id, state, stream),
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): RoomSnapshot => this.snap;

  /** A room event from main: a signal for the call, a change to read, or the connection going down or up. */
  receive(e: RoomLiveEvent): void {
    if (this.closed) return;
    if (e.kind === 'signal') {
      void this.call.handle(e.from, e.signal, e.payload);
    } else if (e.kind === 'offline') {
      this.set({ offline: true });
    } else {
      if (e.kind === 'online') this.set({ offline: false });
      void this.refresh();
    }
  }

  /** Reads the room again; only the answer to the newest read is used, so an older, slower one never undoes it. */
  async refresh(): Promise<void> {
    if (this.closed) return;
    try {
      await this.latest(this.o.rooms.state(this.roomId), (r) => this.apply(r));
    } catch {
      // The window is going away; the next event reads again.
    }
  }

  /** Turns your microphone off or on for everyone, and tells the room so it can show it. Unmuting also clears the host's request. */
  setMuted(muted: boolean): void {
    if (this.closed) return;
    this.call.setMuted(muted);
    this.set({ muted, hostMuted: muted && this.snap.hostMuted });
    this.tellMuted(muted);
  }

  /** You are removing this person: when they go, say so instead of "<name> left.". */
  noteRemoval(id: string, name: string): void {
    this.departures.set(id, `${name} was removed from the room.`);
  }

  /** Leaves on purpose (Leave, navigation, closing the screen): goodbye to every peer first, then the seat. Never throws. */
  async leave(): Promise<void> {
    if (this.closed) return;
    this.close();
    await this.giveUpSeat();
  }

  private apply(r: Result<RoomState | null>): void {
    if (this.closed) return;
    // A failed read keeps what is shown and says why; Try again, the next change or reconnection reads again.
    if (!r.ok) {
      this.set({ readError: r.error.message });
      return;
    }
    const s = r.data;
    if (!s || s.me.removed || s.endedAt !== null || !s.me.live) {
      this.finish(s?.me.removed ? 'removed' : s?.endedAt ? 'ended' : 'gone');
      return;
    }
    const myId = this.o.myId;
    const next = new Map(s.people.filter((p) => p.id !== myId).map((p) => [p.id, p.displayName] as const));
    const said: string[] = [];
    const before = this.snap.state;
    if (before) {
      for (const [id, name] of next) if (!this.people.has(id)) said.push(`${name} joined.`);
      for (const [id, name] of this.people) if (!next.has(id)) said.push(this.departures.get(id) ?? `${name} left.`);
      if (s.hostId !== null && s.hostId !== before.hostId) {
        said.push(s.hostId === myId ? 'You are the host now.' : `${next.get(s.hostId) ?? 'Someone else'} is the host now.`);
      }
    }
    for (const id of this.people.keys()) if (!next.has(id)) this.departures.delete(id);
    this.people = next;

    let { muted, hostMuted } = this.snap;
    const asked = s.me.muteRequestedAt;
    if (asked !== null && asked !== this.muteRequest) {
      muted = true;
      hostMuted = true;
      this.call.setMuted(true);
    }
    this.muteRequest = asked;

    // The room shows your microphone from what you told it: when that is not what it is (the host's request, or an
    // earlier call that did not get through), tell it again.
    const shown = s.people.find((p) => p.id === myId);
    if (shown && shown.muted !== muted) this.tellMuted(muted);

    this.set({
      state: s,
      readError: null,
      muted,
      hostMuted,
      unreachable: this.snap.unreachable.filter((id) => next.has(id)),
      activity: said.length > 0 ? { id: ++this.lines, text: said.join(' ') } : this.snap.activity,
    });
    this.call.sync(s.people.map((p) => p.id));
  }

  /** Best effort: when it fails, the next read of the room shows the difference and tells it again. */
  private tellMuted(muted: boolean): void {
    void this.o.rooms.setMuted(this.roomId, muted).catch(() => {});
  }

  private onPeer(id: string, state: PeerState, stream: MediaStream | null): void {
    if (this.closed) return;
    const was = this.snap.peers[id]?.state;
    let unreachable = this.snap.unreachable;
    // Said on the move into failed; a retry (connecting again) keeps it. Someone not in the room yet is not named.
    if (state === 'failed' && was !== 'failed' && this.people.has(id) && !unreachable.includes(id)) unreachable = [...unreachable, id];
    if (state === 'connected') unreachable = unreachable.filter((x) => x !== id);
    this.set({ peers: { ...this.snap.peers, [id]: { state, stream } }, unreachable });
  }

  /** Out of the room without pressing Leave: the call closes, main stops following the room, the view is told why. */
  private finish(outcome: RoomOutcome): void {
    if (this.closed) return;
    this.close();
    this.set({ outcome });
    void this.giveUpSeat();
  }

  private close(): void {
    this.closed = true;
    // Byes go out while the seat is still yours; the microphone stops with the call.
    this.call.close();
    this.off();
  }

  private async giveUpSeat(): Promise<void> {
    try {
      await this.o.rooms.leave(this.roomId);
    } catch {
      // Offline: the seat frees itself after 90 seconds without a heartbeat.
    }
  }

  private set(change: Partial<RoomSnapshot>): void {
    this.snap = { ...this.snap, ...change };
    for (const listener of [...this.listeners]) listener();
  }
}
