// One person's side of a voice room: a direct WebRTC connection to each other live person (a mesh). Offers, answers
// and network candidates travel as room signals through `send`; the voice goes straight between the two windows and
// never through a server. Nothing is recorded.
import { ROOM_CONNECT_TIMEOUT_MS, ROOM_SIGNAL_MAX_BYTES, type RoomSignalKind } from '../../core/social/rooms';
import { meshPlan } from './mesh';

/** Cloudflare's free STUN server tells each side its public address. There is no TURN relay. */
export const ICE_SERVERS: readonly RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];

/** An offer with no answer yet is sent again this often (the other window may not have been listening yet)… */
export const OFFER_RESEND_MS = 3_000;
/** …at most this many times. */
export const OFFER_RESENDS = 3;
/** A signal still on its way after this long no longer holds back the next one to the same person. */
export const SEND_WAIT_MS = 5_000;
/** A failed pair tries again by itself this long after failing… */
export const RETRY_MS = 5_000;
/** …at most this many times in a row; after that it stays failed until a sync gives it one more try. */
export const RETRIES = 3;
/** Candidates kept per person and connection (theirs before their description, ours before ours). */
const MAX_CANDIDATES = 64;
/** People whose candidates are kept before anything else from them has arrived. */
const MAX_EARLY = 8;

export type PeerState = 'connecting' | 'connected' | 'failed';

/** The part of RTCPeerConnection a room call uses. Tests pass a fake; the window passes `browserPeer()`. */
export interface PeerLike {
  readonly connectionState: RTCPeerConnectionState;
  readonly signalingState: RTCSignalingState;
  onicecandidate: ((ev: RTCPeerConnectionIceEvent) => void) | null;
  ontrack: ((ev: RTCTrackEvent) => void) | null;
  onconnectionstatechange: ((ev: Event) => void) | null;
  createOffer(): Promise<RTCSessionDescriptionInit>;
  createAnswer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
  addTrack(track: MediaStreamTrack, ...streams: MediaStream[]): unknown;
  close(): void;
}

/** A real connection, through the STUN server only. */
export function browserPeer(): PeerLike {
  return new RTCPeerConnection({ iceServers: ICE_SERVERS.map((server) => ({ ...server })) });
}

export interface RoomCallOptions {
  myId: string;
  /** The person's microphone (from `openMic`). Its audio goes to every peer; `close` stops it. */
  stream: MediaStream;
  /** Sends a signal to one person in the room. A returned promise is waited for, so signals to one person keep their order. */
  send(to: string, signal: RoomSignalKind, payload: string): void | Promise<unknown>;
  createPeer(): PeerLike;
  /** A peer's state or voice changed. `stream` is their voice once it arrives; null before that and once failed. */
  onPeer(id: string, state: PeerState, stream: MediaStream | null): void;
  /** How long a peer may take to connect, or to come back after dropping, before it is failed. Default 20 s. */
  timeoutMs?: number;
}

/** One RTCPeerConnection to one person. A pair can go through several: a retry, a restart, glare. */
interface Session {
  pc: PeerLike;
  /** createOffer / setLocalDescription are on their way. */
  makingOffer: boolean;
  /** Their description is in, so their candidates can be added. */
  remoteSet: boolean;
  /** The offer this connection answers, to spot the same offer sent again. */
  answering: string | null;
  /** Our offer or answer payload, once sent. */
  description: string | null;
  /** Our candidates found before the description went out; they follow it. */
  held: string[];
  /** Our candidates already sent; sent again with a repeated offer or answer. */
  sent: string[];
  resend: ReturnType<typeof setTimeout> | null;
  resends: number;
}

interface Peer {
  id: string;
  session: Session | null;
  state: PeerState;
  stream: MediaStream | null;
  /** Their candidates that came before their description. */
  waiting: RTCIceCandidateInit[];
  /** Runs while connecting; when it fires the peer is failed. */
  timer: ReturnType<typeof setTimeout> | null;
  /** Runs while failed: the next try by itself. */
  retry: ReturnType<typeof setTimeout> | null;
  /** Runs while we wait for their offer: when it fires we offer ourselves. */
  nudge: ReturnType<typeof setTimeout> | null;
  /** Tries by itself since the pair last connected. */
  retries: number;
  /** A sync already gave this failed pair its extra try; cleared when it connects. */
  syncTried: boolean;
}

type PeerTimer = 'timer' | 'retry' | 'nudge';

const encoder = new TextEncoder();
const bytes = (s: string) => encoder.encode(s).byteLength;
const noop = () => {};

/**
 * The calls of one person in one room. `sync` with the room's live people after every change; `handle` every signal
 * addressed to you. In each pair the smaller id offers (see `meshPlan`); the larger id waits, and offers itself if it
 * hears nothing for 2 × OFFER_RESEND_MS (half the timeout at most). If both offer at once (glare), the smaller id keeps
 * its offer and the larger one answers it. Every peer is reported `connecting`, then `connected`, or `failed` when it
 * has not connected after `timeoutMs`. While that person is still live, a failed pair tries again by itself
 * `RETRIES` times, `RETRY_MS` apart; after that it stays failed until a `sync` gives it one more try.
 */
export class RoomCall {
  private readonly peers = new Map<string, Peer>();
  /** Candidates from people with no peer yet (they overtook the offer). */
  private readonly early = new Map<string, RTCIceCandidateInit[]>();
  /** The last signal on its way to each person. */
  private readonly outbox = new Map<string, Promise<void>>();
  private readonly timeoutMs: number;
  /** How long the waiting side waits for an offer before it offers itself. */
  private readonly nudgeMs: number;
  /** The live people of the last sync, without you. */
  private live = new Set<string>();
  private closed = false;

  constructor(private readonly o: RoomCallOptions) {
    this.timeoutMs = o.timeoutMs ?? ROOM_CONNECT_TIMEOUT_MS;
    this.nudgeMs = Math.min(2 * OFFER_RESEND_MS, Math.floor(this.timeoutMs / 2));
  }

  /** Follows the room's live people (you may be in the list): connects new people, says bye to people who left. */
  sync(live: string[]): void {
    if (this.closed) return;
    this.live = new Set(live);
    this.live.delete(this.o.myId);
    const plan = meshPlan(this.o.myId, live, [...this.peers.keys()]);
    for (const id of plan.drop) {
      this.post(id, 'bye', '');
      this.remove(id);
    }
    for (const id of plan.await) {
      const peer = this.add(id);
      if (peer) this.wait(peer);
    }
    for (const id of plan.offer) {
      const peer = this.add(id);
      if (peer) void this.offer(peer);
    }
    // A failed pair waiting for its next try takes it now; one that used up its tries gets one more from a sync.
    for (const peer of [...this.peers.values()]) {
      if (this.closed) return;
      if (peer.state !== 'failed' || !this.live.has(peer.id)) continue;
      if (peer.retry) {
        this.cancel(peer, 'retry');
        peer.retries++;
      } else if (!peer.syncTried) {
        peer.syncTried = true;
      } else {
        continue;
      }
      this.reconnect(peer);
    }
  }

  /** A signal from someone in the room. Never throws: a signal that cannot be used is dropped. */
  async handle(from: string, signal: RoomSignalKind, payload: string): Promise<void> {
    if (this.closed || from === this.o.myId) return;
    try {
      if (signal === 'bye') {
        this.remove(from);
      } else if (signal === 'offer') {
        const offer = readDescription(payload, 'offer');
        if (offer) await this.onOffer(from, offer);
      } else if (signal === 'answer') {
        const answer = readDescription(payload, 'answer');
        if (answer) await this.onAnswer(from, answer);
      } else if (signal === 'candidate') {
        const candidate = readCandidate(payload);
        if (candidate) await this.onCandidate(from, candidate);
      }
    } catch {
      // The browser refused it. If the pair never connects, the timeout reports it.
    }
  }

  /** Turns your microphone track off or on. The microphone stays open, so unmuting is instant. */
  setMuted(muted: boolean): void {
    for (const track of this.o.stream.getAudioTracks()) track.enabled = !muted;
  }

  /** Leaves the call: bye to everyone, every connection closed, the microphone stopped. Later `sync` and `handle` do nothing. */
  close(): void {
    if (this.closed) return;
    for (const id of this.peers.keys()) this.post(id, 'bye', '');
    this.closed = true;
    for (const peer of this.peers.values()) {
      this.cancel(peer, 'timer', 'retry', 'nudge');
      this.shut(peer);
    }
    this.peers.clear();
    this.early.clear();
    for (const track of this.o.stream.getTracks()) track.stop();
  }

  private async onOffer(from: string, offer: Description): Promise<void> {
    const known = this.peers.get(from);
    const mine = known?.session ?? null;
    if (known && mine && mine.answering === offer.sdp) {
      // The same offer again: our answer was probably lost. Send it again rather than start over.
      if (mine.description) this.repeat(known, mine, 'answer');
      return;
    }
    // Glare: we have an offer of our own on its way. The smaller id keeps its offer and ignores this one; the larger id
    // drops its offer and answers this one on a new connection.
    if (mine && (mine.makingOffer || mine.pc.signalingState === 'have-local-offer') && this.o.myId < from) return;
    // Any other offer starts the pair over: a first offer, a retry, or the other window restarted.
    const peer = known ?? this.add(from);
    if (!peer) return;
    const s = this.open(peer);
    if (!s) return;
    s.answering = offer.sdp;
    await s.pc.setRemoteDescription(offer);
    if (!this.current(peer, s)) return;
    this.remoteIn(peer, s);
    const answer = await s.pc.createAnswer();
    if (!this.current(peer, s)) return;
    await s.pc.setLocalDescription(answer);
    if (!this.current(peer, s)) return;
    this.describe(peer, s, 'answer', answer);
  }

  private async onAnswer(from: string, answer: Description): Promise<void> {
    const peer = this.peers.get(from);
    const s = peer?.session;
    // A late or repeated answer, or one to an offer we dropped: nothing waits for it.
    if (!peer || !s || s.pc.signalingState !== 'have-local-offer') return;
    await s.pc.setRemoteDescription(answer);
    if (this.current(peer, s)) this.remoteIn(peer, s);
  }

  private async onCandidate(from: string, candidate: RTCIceCandidateInit): Promise<void> {
    const peer = this.peers.get(from);
    if (!peer) {
      // Signals can overtake each other: keep it for the offer that should follow.
      const kept = this.early.get(from) ?? (this.early.size < MAX_EARLY ? [] : null);
      if (kept && kept.length < MAX_CANDIDATES) this.early.set(from, [...kept, candidate]);
      return;
    }
    const s = peer.session;
    if (!s || !s.remoteSet) {
      if (peer.waiting.length < MAX_CANDIDATES) peer.waiting.push(candidate);
      return;
    }
    // One from an older connection of theirs is refused; that is fine.
    await s.pc.addIceCandidate(candidate).catch(noop);
  }

  /** A new peer, connecting; its clock starts now. Null once the call is closed (onPeer may close it). */
  private add(id: string): Peer | null {
    if (this.closed) return null;
    const peer: Peer = {
      id,
      session: null,
      state: 'connecting',
      stream: null,
      waiting: this.early.get(id) ?? [],
      timer: null,
      retry: null,
      nudge: null,
      retries: 0,
      syncTried: false,
    };
    this.early.delete(id);
    this.peers.set(id, peer);
    this.arm(peer);
    this.notify(peer);
    return this.closed ? null : peer;
  }

  /** Starts the pair again from the side the id rule gives: the smaller id offers, the larger one waits. */
  private reconnect(peer: Peer): void {
    if (this.o.myId < peer.id) void this.offer(peer);
    else this.wait(peer);
  }

  /** Waits for their offer (they have the smaller id). If nothing comes for a while, offers itself: glare sorts it out. */
  private wait(peer: Peer): void {
    if (this.closed) return;
    this.shut(peer);
    this.cancel(peer, 'retry', 'nudge');
    this.set(peer, 'connecting', null);
    if (this.closed) return;
    if (!peer.timer) this.arm(peer);
    peer.nudge = setTimeout(() => {
      peer.nudge = null;
      const silent = !peer.session && peer.state === 'connecting';
      if (!this.closed && this.peers.get(peer.id) === peer && silent) void this.offer(peer);
    }, this.nudgeMs);
  }

  private async offer(peer: Peer): Promise<void> {
    const s = this.open(peer);
    if (!s) return;
    s.makingOffer = true;
    try {
      const offer = await s.pc.createOffer();
      if (!this.current(peer, s)) return;
      await s.pc.setLocalDescription(offer);
      if (!this.current(peer, s)) return;
      this.describe(peer, s, 'offer', offer);
    } catch {
      // The browser refused: the timeout reports the pair.
    } finally {
      s.makingOffer = false;
    }
  }

  /** A new connection for `peer`, closing any older one. Null when the browser refuses (the peer is then failed). */
  private open(peer: Peer): Session | null {
    if (this.closed) return null;
    this.shut(peer);
    this.cancel(peer, 'retry', 'nudge');
    this.set(peer, 'connecting', null);
    if (this.closed) return null; // onPeer closed the call
    if (!peer.timer) this.arm(peer);
    let pc: PeerLike | null = null;
    try {
      pc = this.o.createPeer();
      for (const track of this.o.stream.getAudioTracks()) pc.addTrack(track, this.o.stream);
    } catch {
      try {
        pc?.close();
      } catch {
        // Already closed.
      }
      this.fail(peer);
      return null;
    }
    const s: Session = {
      pc,
      makingOffer: false,
      remoteSet: false,
      answering: null,
      description: null,
      held: [],
      sent: [],
      resend: null,
      resends: 0,
    };
    peer.session = s;
    pc.onicecandidate = (ev) => this.onLocalCandidate(peer, s, ev.candidate);
    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      if (stream && this.current(peer, s)) this.set(peer, peer.state, stream);
    };
    pc.onconnectionstatechange = () => {
      if (this.current(peer, s)) this.onState(peer, s.pc.connectionState);
    };
    return s;
  }

  private onState(peer: Peer, state: RTCPeerConnectionState): void {
    if (state === 'connected') {
      this.cancel(peer, 'timer');
      peer.retries = 0;
      peer.syncTried = false;
      this.set(peer, 'connected', peer.stream);
    } else if (state === 'failed') {
      this.fail(peer);
    } else if (state === 'disconnected' && peer.state === 'connected') {
      // Often only a moment (the network changing): it may come back by itself, until the timeout.
      this.arm(peer);
      this.set(peer, 'connecting', peer.stream);
    }
  }

  private onLocalCandidate(peer: Peer, s: Session, c: RTCIceCandidate | null): void {
    // null (or an empty candidate) marks the end of gathering: there is nothing to send.
    if (!c?.candidate || !this.current(peer, s)) return;
    const payload = JSON.stringify({
      candidate: {
        candidate: c.candidate,
        sdpMid: c.sdpMid ?? null,
        sdpMLineIndex: c.sdpMLineIndex ?? null,
        usernameFragment: c.usernameFragment ?? null,
      },
    });
    // Too big for a signal: never sent; the connection makes do with the other candidates.
    if (bytes(payload) > ROOM_SIGNAL_MAX_BYTES) return;
    if (s.description) this.sendCandidate(peer, s, payload);
    else if (s.held.length < MAX_CANDIDATES) s.held.push(payload);
  }

  /** Their description is in: add the candidates that came before it. */
  private remoteIn(peer: Peer, s: Session): void {
    s.remoteSet = true;
    for (const c of peer.waiting.splice(0)) void s.pc.addIceCandidate(c).catch(noop);
  }

  /** Sends our offer or answer, then the candidates found so far. An offer is repeated until answered. */
  private describe(peer: Peer, s: Session, kind: 'offer' | 'answer', d: RTCSessionDescriptionInit): void {
    s.description = JSON.stringify({ sdp: { type: kind, sdp: d.sdp ?? '' } });
    this.post(peer.id, kind, s.description);
    for (const payload of s.held.splice(0)) this.sendCandidate(peer, s, payload);
    if (kind === 'offer') this.resendLater(peer, s);
  }

  private sendCandidate(peer: Peer, s: Session, payload: string): void {
    this.post(peer.id, 'candidate', payload);
    if (s.sent.length < MAX_CANDIDATES) s.sent.push(payload);
  }

  /** Our description and candidates once more, for a peer that may have missed them. */
  private repeat(peer: Peer, s: Session, kind: 'offer' | 'answer'): void {
    if (!s.description) return;
    this.post(peer.id, kind, s.description);
    for (const payload of s.sent) this.post(peer.id, 'candidate', payload);
  }

  private resendLater(peer: Peer, s: Session): void {
    if (s.resends >= OFFER_RESENDS) return;
    s.resend = setTimeout(() => {
      s.resend = null;
      if (!this.current(peer, s) || s.pc.signalingState !== 'have-local-offer') return;
      s.resends++;
      this.repeat(peer, s, 'offer');
      this.resendLater(peer, s);
    }, OFFER_RESEND_MS);
  }

  private fail(peer: Peer): void {
    this.cancel(peer, 'timer', 'nudge');
    this.shut(peer);
    this.set(peer, 'failed', null);
    this.retryLater(peer);
  }

  /** While the person is still live, a failed pair tries again by itself, up to RETRIES times in a row. */
  private retryLater(peer: Peer): void {
    if (this.closed || peer.retry || peer.retries >= RETRIES) return;
    if (this.peers.get(peer.id) !== peer || !this.live.has(peer.id)) return;
    peer.retry = setTimeout(() => {
      peer.retry = null;
      if (this.closed || this.peers.get(peer.id) !== peer || peer.state !== 'failed' || !this.live.has(peer.id)) return;
      peer.retries++;
      this.reconnect(peer);
    }, RETRY_MS);
  }

  /** Closes the peer's connection, if any, and stops listening to it. */
  private shut(peer: Peer): void {
    const s = peer.session;
    if (!s) return;
    peer.session = null;
    if (s.resend) clearTimeout(s.resend);
    s.pc.onicecandidate = null;
    s.pc.ontrack = null;
    s.pc.onconnectionstatechange = null;
    try {
      s.pc.close();
    } catch {
      // Already closed.
    }
  }

  /** Forgets a person who left (or said bye). Nothing is reported: the room's people list shows who is here. */
  private remove(id: string): void {
    this.early.delete(id);
    const peer = this.peers.get(id);
    if (!peer) return;
    this.cancel(peer, 'timer', 'retry', 'nudge');
    this.shut(peer);
    this.peers.delete(id);
  }

  private arm(peer: Peer): void {
    this.cancel(peer, 'timer');
    peer.timer = setTimeout(() => {
      peer.timer = null;
      if (!this.closed && this.peers.get(peer.id) === peer && peer.state !== 'connected') this.fail(peer);
    }, this.timeoutMs);
  }

  private cancel(peer: Peer, ...timers: PeerTimer[]): void {
    for (const key of timers) {
      const t = peer[key];
      if (t) clearTimeout(t);
      peer[key] = null;
    }
  }

  /** True while `s` is still the peer's connection and the peer is still in the call. */
  private current(peer: Peer, s: Session): boolean {
    return !this.closed && this.peers.get(peer.id) === peer && peer.session === s;
  }

  private set(peer: Peer, state: PeerState, stream: MediaStream | null): void {
    if (peer.state === state && peer.stream === stream) return;
    peer.state = state;
    peer.stream = stream;
    this.notify(peer);
  }

  private notify(peer: Peer): void {
    try {
      this.o.onPeer(peer.id, peer.state, peer.stream);
    } catch (e) {
      // A screen error must not break the call; it still shows in the console.
      queueMicrotask(() => {
        throw e;
      });
    }
  }

  /** Sends one signal after the ones before it to the same person, so they arrive in order. Never over the size limit. */
  private post(to: string, signal: RoomSignalKind, payload: string): void {
    if (bytes(payload) > ROOM_SIGNAL_MAX_BYTES) return;
    const go = (): Promise<void> => {
      let sending: unknown;
      try {
        sending = this.o.send(to, signal, payload);
      } catch {
        return Promise.resolve();
      }
      if (!isThenable(sending)) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, SEND_WAIT_MS);
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        sending.then(done, done);
      });
    };
    const before = this.outbox.get(to);
    const tail = before ? before.then(go) : go();
    this.outbox.set(to, tail);
    void tail.then(() => {
      if (this.outbox.get(to) === tail) this.outbox.delete(to);
    });
  }
}

interface Description {
  type: 'offer' | 'answer';
  sdp: string;
}

function parse(payload: string): unknown {
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
}

/** A promise, also one from another realm (the preload bridge). */
function isThenable(v: unknown): v is PromiseLike<unknown> {
  return typeof (v as { then?: unknown } | null)?.then === 'function';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The offer or answer in a payload (`{"sdp": {"type", "sdp"}}`), or null when it is not one. */
function readDescription(payload: string, type: Description['type']): Description | null {
  const data = parse(payload);
  const d = isRecord(data) ? data.sdp : null;
  return isRecord(d) && d.type === type && typeof d.sdp === 'string' ? { type, sdp: d.sdp } : null;
}

/** The candidate in a payload (`{"candidate": {...}}`), rebuilt from known fields only, or null when it is not one. */
function readCandidate(payload: string): RTCIceCandidateInit | null {
  const data = parse(payload);
  const c = isRecord(data) ? data.candidate : null;
  if (!isRecord(c) || typeof c.candidate !== 'string') return null;
  const sdpMid = typeof c.sdpMid === 'string' ? c.sdpMid : null;
  const index = c.sdpMLineIndex;
  const sdpMLineIndex = typeof index === 'number' && Number.isInteger(index) && index >= 0 && index <= 65_535 ? index : null;
  if (sdpMid === null && sdpMLineIndex === null) return null;
  const usernameFragment = typeof c.usernameFragment === 'string' ? c.usernameFragment : null;
  return { candidate: c.candidate, sdpMid, sdpMLineIndex, usernameFragment };
}
