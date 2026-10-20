// In-memory stand-ins for RTCPeerConnection, the microphone stream and the room's signal channel, so a room call
// runs in tests without a browser. A pair connects once each side holds the other's offer/answer and has added a
// candidate from the other; a world that is `stuck` never connects anyone (a network that blocks calls).
import type { RoomSignalKind } from '../../src/core/social/rooms';
import type { PeerLike } from '../../src/renderer/lib/room-call';

export class FakeTrack {
  readonly kind = 'audio';
  enabled = true;
  stopped = false;
  constructor(readonly id: string) {}
  stop(): void {
    this.stopped = true;
  }
}

export class FakeStream {
  readonly tracks: FakeTrack[];
  constructor(readonly id: string) {
    this.tracks = [new FakeTrack(`${id}/audio`)];
  }
  getAudioTracks(): FakeTrack[] {
    return this.tracks;
  }
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
}

/** The fake where the code wants a real MediaStream. */
export const asStream = (s: FakeStream): MediaStream => s as unknown as MediaStream;

function domError(name: string, message: string): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

interface Desc {
  type: 'offer' | 'answer';
  sdp: string;
}

export class FakeWorld {
  readonly peers: FakePeer[] = [];
  /** While true, no pair gets through. */
  stuck = false;
  /** Every candidate is bigger than a signal may be. */
  hugeCandidates = false;
  private count = 0;
  private readonly made = new Map<string, FakePeer>();

  /** A new connection belonging to `owner` (the person whose window made it). */
  peer(owner: string): FakePeer {
    const p = new FakePeer(this, owner, `pc${++this.count}`);
    this.peers.push(p);
    return p;
  }

  /** Connections of one person that are not closed. */
  openOf(owner: string): FakePeer[] {
    return this.peers.filter((p) => p.owner === owner && p.connectionState !== 'closed');
  }

  /** Each open connected connection as "owner>partner". */
  links(): string[] {
    return this.peers
      .filter((p) => p.connectionState === 'connected')
      .map((p) => `${p.owner}>${p.partner?.owner ?? '?'}`)
      .sort();
  }

  /** The open connection from `owner` to `to`, when there is exactly one. */
  between(owner: string, to: string): FakePeer {
    const found = this.openOf(owner).filter((p) => p.partner?.owner === to || p.remoteOwner?.owner === to);
    if (found.length !== 1) throw new Error(`expected one open connection ${owner}>${to}, found ${found.length}`);
    return found[0]!;
  }

  register(sdp: string, peer: FakePeer): void {
    this.made.set(sdp, peer);
  }

  ownerOf(sdp: string): FakePeer | undefined {
    return this.made.get(sdp);
  }

  /** Connects `p` and its partner once both sides are ready. */
  check(p: FakePeer): void {
    if (this.stuck || p.partner) return;
    const partner = p.readyWith();
    if (!partner || partner.partner) return;
    p.partner = partner;
    partner.partner = p;
    p.become('connected');
    partner.become('connected');
  }
}

export class FakePeer implements PeerLike {
  connectionState: RTCPeerConnectionState = 'new';
  signalingState: RTCSignalingState = 'stable';
  onicecandidate: ((ev: RTCPeerConnectionIceEvent) => void) | null = null;
  ontrack: ((ev: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: ((ev: Event) => void) | null = null;
  local: Desc | null = null;
  remote: Desc | null = null;
  /** The connection that made the remote description. */
  remoteOwner: FakePeer | null = null;
  /** The connection this one is connected to. */
  partner: FakePeer | null = null;
  readonly sent: { track: MediaStreamTrack; stream: MediaStream }[] = [];
  /** Connections a candidate was added from. */
  readonly heard = new Set<string>();
  private made = 0;
  private gathered = false;

  constructor(
    private readonly world: FakeWorld,
    readonly owner: string,
    readonly id: string,
  ) {}

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.assertOpen();
    const sdp = `offer ${this.id} ${++this.made}`;
    this.world.register(sdp, this);
    return { type: 'offer', sdp };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    this.assertOpen();
    if (this.signalingState !== 'have-remote-offer') throw domError('InvalidStateError', 'No remote offer to answer');
    const sdp = `answer ${this.id} ${++this.made}`;
    this.world.register(sdp, this);
    return { type: 'answer', sdp };
  }

  async setLocalDescription(d: RTCSessionDescriptionInit): Promise<void> {
    this.assertOpen();
    if (d.type === 'rollback') {
      if (this.signalingState !== 'have-local-offer') throw domError('InvalidStateError', 'Nothing to roll back');
      this.local = null;
      this.signalingState = 'stable';
      return;
    }
    if (typeof d.sdp !== 'string' || this.world.ownerOf(d.sdp) !== this) throw domError('OperationError', 'Not made here');
    if (d.type === 'offer' && this.signalingState === 'stable') this.signalingState = 'have-local-offer';
    else if (d.type === 'answer' && this.signalingState === 'have-remote-offer') this.signalingState = 'stable';
    else throw domError('InvalidStateError', `Cannot set a local ${d.type} in ${this.signalingState}`);
    this.local = { type: d.type, sdp: d.sdp };
    this.gather();
    this.world.check(this);
  }

  async setRemoteDescription(d: RTCSessionDescriptionInit): Promise<void> {
    this.assertOpen();
    const owner = typeof d.sdp === 'string' ? this.world.ownerOf(d.sdp) : undefined;
    if (!owner || owner === this) throw domError('OperationError', 'Unknown description');
    // No implicit rollback here: an offer over a local offer is refused, so the code under test must sort out glare.
    if (d.type === 'offer' && this.signalingState === 'stable') this.signalingState = 'have-remote-offer';
    else if (d.type === 'answer' && this.signalingState === 'have-local-offer') this.signalingState = 'stable';
    else throw domError('InvalidStateError', `Cannot set a remote ${d.type} in ${this.signalingState}`);
    this.remote = { type: d.type, sdp: d.sdp! };
    this.remoteOwner = owner;
    const sent = owner.sent[0];
    if (sent) {
      const stream = new FakeStream(sent.stream.id);
      queueMicrotask(() => {
        if (this.connectionState === 'closed') return;
        this.ontrack?.({ track: stream.tracks[0], streams: [asStream(stream)] } as unknown as RTCTrackEvent);
      });
    }
    this.world.check(this);
  }

  async addIceCandidate(c: RTCIceCandidateInit): Promise<void> {
    this.assertOpen();
    if (!this.remote || !this.remoteOwner) throw domError('InvalidStateError', 'No remote description');
    if (c.usernameFragment !== this.remoteOwner.id) throw domError('OperationError', 'Candidate of another connection');
    this.heard.add(this.remoteOwner.id);
    this.world.check(this);
  }

  addTrack(track: MediaStreamTrack, ...streams: MediaStream[]): unknown {
    this.assertOpen();
    this.sent.push({ track, stream: streams[0]! });
    return {};
  }

  close(): void {
    this.connectionState = 'closed';
    this.signalingState = 'closed';
  }

  /** The partner this connection would connect to now, if both sides are ready. */
  readyWith(): FakePeer | null {
    const p = this.remoteOwner;
    if (!p || !this.local || this.signalingState !== 'stable' || this.connectionState === 'closed') return null;
    if (p.remoteOwner !== this || p.signalingState !== 'stable' || p.connectionState === 'closed') return null;
    if (p.remote?.sdp !== this.local.sdp || p.local?.sdp !== this.remote?.sdp) return null;
    return this.heard.has(p.id) && p.heard.has(this.id) ? p : null;
  }

  /** Moves to a connection state and tells the listener, as the browser does, a moment later. */
  become(state: RTCPeerConnectionState): void {
    queueMicrotask(() => {
      if (this.connectionState === 'closed') return;
      this.connectionState = state;
      this.onconnectionstatechange?.({} as Event);
    });
  }

  /** Two candidates a moment after the first local description, then the end-of-candidates event (null). */
  private gather(): void {
    if (this.gathered) return;
    this.gathered = true;
    queueMicrotask(() => {
      for (const n of [1, 2]) {
        if (this.connectionState === 'closed') return;
        const text = this.world.hugeCandidates ? 'x'.repeat(17_000) : `candidate:${this.id}:${n} 1 udp 2122260223 192.0.2.${n} 5000${n} typ host`;
        const candidate = { candidate: text, sdpMid: '0', sdpMLineIndex: 0, usernameFragment: this.id };
        this.onicecandidate?.({ candidate } as unknown as RTCPeerConnectionIceEvent);
      }
      this.onicecandidate?.({ candidate: null } as unknown as RTCPeerConnectionIceEvent);
    });
  }

  private assertOpen(): void {
    if (this.connectionState === 'closed') throw domError('InvalidStateError', 'The connection is closed');
  }
}

export interface Sent {
  from: string;
  to: string;
  signal: RoomSignalKind;
  payload: string;
}

interface Receiver {
  handle(from: string, signal: RoomSignalKind, payload: string): Promise<void>;
}

/** The room's signal channel: delivers each signal a moment later, in order; signals to someone not here are lost. */
export class FakeNet {
  readonly sent: Sent[] = [];
  private readonly receivers = new Map<string, Receiver>();
  private held: Sent[] | null = null;
  /** Signals matching this are lost on the way. */
  lose: ((m: Sent) => boolean) | null = null;

  attach(id: string, r: Receiver): void {
    this.receivers.set(id, r);
  }

  detach(id: string): void {
    this.receivers.delete(id);
  }

  send(from: string, to: string, signal: RoomSignalKind, payload: string): void {
    const m = { from, to, signal, payload };
    this.sent.push(m);
    if (this.held) this.held.push(m);
    else this.deliver(m);
  }

  /** Keeps every signal until `release`. */
  hold(): void {
    this.held ??= [];
  }

  /** Delivers what was kept, in the order `order` gives (default: as sent). */
  release(order: (kept: Sent[]) => Sent[] = (kept) => kept): void {
    const kept = this.held ?? [];
    this.held = null;
    for (const m of order(kept)) this.deliver(m);
  }

  /** Signals of one kind, as "from>to". */
  of(signal: RoomSignalKind): string[] {
    return this.sent.filter((m) => m.signal === signal).map((m) => `${m.from}>${m.to}`);
  }

  private deliver(m: Sent): void {
    if (this.lose?.(m)) return;
    queueMicrotask(() => {
      // A rejected handle would surface as an unhandled rejection and fail the test: handle must never throw.
      void this.receivers.get(m.to)?.handle(m.from, m.signal, m.payload);
    });
  }
}

/** Lets every pending microtask and the hand-offs between them run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}
