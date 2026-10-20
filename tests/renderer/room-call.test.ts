import { ROOM_CONNECT_TIMEOUT_MS, ROOM_SIGNAL_MAX_BYTES, type RoomSignalKind } from '../../src/core/social/rooms';
import { ICE_SERVERS, OFFER_RESEND_MS, RoomCall, browserPeer, type PeerState } from '../../src/renderer/lib/room-call';
import { FakeNet, FakeStream, FakeWorld, asStream, settle, type FakePeer, type Sent } from './fake-peer';

const TIMEOUT = 1_000;

interface Person {
  id: string;
  call: RoomCall;
  mic: FakeStream;
  /** The last state reported for each peer. */
  states: Map<string, PeerState>;
  streams: Map<string, MediaStream | null>;
  /** Every report, as "peer:state". */
  log: string[];
  /** The connections this window made. */
  pcs: FakePeer[];
}

/** `timeoutMs` null leaves the call's default. */
function room(timeoutMs: number | null = TIMEOUT) {
  const world = new FakeWorld();
  const net = new FakeNet();
  const join = (id: string): Person => {
    const mic = new FakeStream(`mic-${id}`);
    const person = { id, mic, states: new Map(), streams: new Map(), log: [], pcs: [] } as unknown as Person;
    person.call = new RoomCall({
      myId: id,
      stream: asStream(mic),
      send: (to, signal, payload) => net.send(id, to, signal, payload),
      createPeer: () => {
        const pc = world.peer(id);
        person.pcs.push(pc);
        return pc;
      },
      onPeer: (peer, state, stream) => {
        person.states.set(peer, state);
        person.streams.set(peer, stream);
        person.log.push(`${peer}:${state}`);
      },
      ...(timeoutMs === null ? {} : { timeoutMs }),
    });
    net.attach(id, person.call);
    return person;
  };
  return { world, net, join };
}

/** Everyone syncs with the same live list: themselves plus `extra` people whose windows never answer. */
function syncAll(people: Person[], extra: string[] = []): void {
  const live = [...people.map((p) => p.id), ...extra];
  for (const p of people) p.call.sync(live);
}

function expectConnected(people: Person[]): void {
  for (const p of people) for (const q of people) if (p !== q) expect(p.states.get(q.id), `${p.id} → ${q.id}`).toBe('connected');
}

/** The app crashes: its connections vanish without a bye (the other side only notices when the network says so). */
function crash(p: Person): void {
  for (const pc of p.pcs) pc.close();
}

const bytes = (s: string) => new TextEncoder().encode(s).byteLength;
const offerPayload = (sdp: string) => JSON.stringify({ sdp: { type: 'offer', sdp } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('two people connect through the signals; the smaller id makes the offer', async () => {
  const { world, net, join } = room();
  const a = join('a');
  const b = join('b');
  b.call.sync(['a', 'b']);
  a.call.sync(['b', 'a']);
  await settle();

  expectConnected([a, b]);
  expect(net.of('offer')).toEqual(['a>b']);
  expect(net.of('answer')).toEqual(['b>a']);
  expect(world.links()).toEqual(['a>b', 'b>a']);
  // Each side hears the other's microphone.
  expect(a.streams.get('b')?.id).toBe('mic-b');
  expect(b.streams.get('a')?.id).toBe('mic-a');
  expect(a.log[0]).toBe('b:connecting');
  expect(a.log.at(-1)).toBe('b:connected');
  expect([...a.log, ...b.log].some((l) => l.endsWith(':failed'))).toBe(false);
  // The payloads are small JSON strings: a description or one candidate.
  const offer = net.sent.find((m) => m.signal === 'offer')!;
  expect(JSON.parse(offer.payload)).toEqual({ sdp: { type: 'offer', sdp: expect.any(String) } });
  const candidate = net.sent.find((m) => m.signal === 'candidate')!;
  expect(JSON.parse(candidate.payload)).toEqual({
    candidate: { candidate: expect.any(String), sdpMid: '0', sdpMLineIndex: 0, usernameFragment: expect.any(String) },
  });
  // Nothing more goes out once the pair is up.
  const sent = net.sent.length;
  vi.advanceTimersByTime(ROOM_CONNECT_TIMEOUT_MS * 2);
  await settle();
  expect(net.sent.length).toBe(sent);
});

test('three people form a full mesh with one connection per pair', async () => {
  const { world, net, join } = room();
  const people = ['c', 'a', 'b'].map(join);
  syncAll(people);
  await settle();

  expectConnected(people);
  expect(world.links()).toEqual(['a>b', 'a>c', 'b>a', 'b>c', 'c>a', 'c>b']);
  expect(world.peers).toHaveLength(6); // no spare connection was ever made
  expect(net.of('offer').sort()).toEqual(['a>b', 'a>c', 'b>c']);
});

test.each([
  ['has not heard of the caller yet', false],
  ['is already waiting for the offer', true],
])('candidates that overtake the offer are kept and added after it (the answerer %s)', async (_, waiting) => {
  const { world, net, join } = room();
  const a = join('a');
  const b = join('b');
  if (waiting) b.call.sync(['a', 'b']);
  net.hold();
  a.call.sync(['a', 'b']);
  await settle();
  expect(net.of('candidate')).toEqual(['a>b', 'a>b']);
  net.release((kept) => [...kept.filter((m) => m.signal === 'candidate'), ...kept.filter((m) => m.signal !== 'candidate')]);
  await settle();

  expectConnected([a, b]);
  b.call.sync(['a', 'b']);
  await settle();
  expect(world.peers).toHaveLength(2);
  expect(b.states.get('a')).toBe('connected');
});

test.each([
  ['in the order sent', (kept: Sent[]) => kept],
  ['in reverse order', (kept: Sent[]) => [...kept].reverse()],
])('two offers at once (glare) still end with one connected pair, delivered %s', async (_, order) => {
  const { world, net, join } = room();
  const a = join('a');
  const b = join('b');
  // First attempt fails for both (the network blocks it), so both try again on the next sync, each with an offer.
  world.stuck = true;
  syncAll([a, b]);
  await settle();
  vi.advanceTimersByTime(TIMEOUT);
  await settle();
  expect(a.states.get('b')).toBe('failed');
  expect(b.states.get('a')).toBe('failed');

  world.stuck = false;
  net.hold();
  syncAll([a, b]);
  await settle();
  expect(net.of('offer').sort()).toEqual(['a>b', 'a>b', 'b>a']);
  net.release(order);
  await settle();

  expectConnected([a, b]);
  expect(world.links()).toEqual(['a>b', 'b>a']);
  expect(world.openOf('a')).toHaveLength(1);
  expect(world.openOf('b')).toHaveLength(1);
  // The smaller id kept its offer and the larger one answered it.
  expect(world.between('a', 'b').local?.type).toBe('offer');
  expect(world.between('b', 'a').local?.type).toBe('answer');
});

test('people whose windows never answer show failed after the timeout while the others stay connected', async () => {
  const { world, join } = room();
  const b = join('b');
  const c = join('c');
  // a (smaller: b and c wait for its offer) and d (larger: b and c offer to it) are live but never answer.
  syncAll([b, c], ['a', 'd']);
  await settle();
  expectConnected([b, c]);
  expect(b.states.get('a')).toBe('connecting');
  expect(b.states.get('d')).toBe('connecting');

  vi.advanceTimersByTime(TIMEOUT - 1);
  await settle();
  expect(b.states.get('a')).toBe('connecting');
  vi.advanceTimersByTime(1);
  await settle();

  for (const p of [b, c]) {
    expect(p.states.get('a')).toBe('failed');
    expect(p.states.get('d')).toBe('failed');
    expect(p.streams.get('d')).toBeNull();
  }
  expectConnected([b, c]);
  expect(world.links()).toEqual(['b>c', 'c>b']);
  expect(b.log.filter((l) => l.startsWith('c:')).at(-1)).toBe('c:connected');
  expect(c.log).not.toContain('b:failed');
  // The failed connections were closed; only the working one is open.
  expect(world.openOf('b')).toHaveLength(1);
  expect(world.openOf('c')).toHaveLength(1);
});

test('the default timeout is the room connect timeout; an unanswered offer is sent again a few times', async () => {
  const { net, join } = room(null);
  const b = join('b');
  b.call.sync(['b', 'd']);
  await settle();
  vi.advanceTimersByTime(ROOM_CONNECT_TIMEOUT_MS - 1);
  await settle();
  expect(b.states.get('d')).toBe('connecting');
  vi.advanceTimersByTime(1);
  await settle();
  expect(b.states.get('d')).toBe('failed');
  expect(net.of('offer')).toEqual(['b>d', 'b>d', 'b>d', 'b>d']);
});

test('an offer lost on the way is sent again, with its candidates', async () => {
  const { world, net, join } = room(ROOM_CONNECT_TIMEOUT_MS);
  const a = join('a');
  const b = join('b');
  // The first offer and its candidates are lost (b's window was not listening yet).
  net.lose = (m) => m.from === 'a' && net.of('offer').length === 1 && m.signal !== 'bye';
  syncAll([a, b]);
  await settle();
  expect(b.states.get('a')).toBe('connecting');
  net.lose = null;

  vi.advanceTimersByTime(OFFER_RESEND_MS);
  await settle();
  expectConnected([a, b]);
  expect(net.of('offer')).toEqual(['a>b', 'a>b']);
  expect(world.peers).toHaveLength(2);
});

test('an answer lost on the way is sent again when the same offer comes again', async () => {
  const { world, net, join } = room(ROOM_CONNECT_TIMEOUT_MS);
  const a = join('a');
  const b = join('b');
  net.lose = (m) => m.from === 'b' && net.of('answer').length === 1;
  syncAll([a, b]);
  await settle();
  expect(a.states.get('b')).toBe('connecting');
  net.lose = null;

  vi.advanceTimersByTime(OFFER_RESEND_MS);
  await settle();
  expectConnected([a, b]);
  expect(net.of('answer')).toEqual(['b>a', 'b>a']);
  expect(world.peers).toHaveLength(2); // b answered from the same connection; it did not start over
});

test('a connection that fails is reported at once and closed', async () => {
  const { world, join } = room();
  const a = join('a');
  const b = join('b');
  syncAll([a, b]);
  await settle();
  world.between('a', 'b').become('failed');
  await settle();
  expect(a.states.get('b')).toBe('failed');
  expect(a.streams.get('b')).toBeNull();
  expect(world.openOf('a')).toHaveLength(0);
});

test('a dropped connection that comes back in time is not a failure; one that stays down is', async () => {
  const { world, join } = room();
  const a = join('a');
  const b = join('b');
  syncAll([a, b]);
  await settle();
  const pc = world.between('a', 'b');

  pc.become('disconnected');
  await settle();
  expect(a.states.get('b')).toBe('connecting');
  expect(a.streams.get('b')?.id).toBe('mic-b'); // still the same voice, coming back
  vi.advanceTimersByTime(TIMEOUT - 1);
  pc.become('connected');
  await settle();
  expect(a.states.get('b')).toBe('connected');
  vi.advanceTimersByTime(TIMEOUT * 5);
  await settle();
  expect(a.log).not.toContain('b:failed');

  pc.become('disconnected');
  await settle();
  vi.advanceTimersByTime(TIMEOUT);
  await settle();
  expect(a.states.get('b')).toBe('failed');
});

test('a failed pair is tried once more on a later sync; an offer from the larger id is answered too', async () => {
  const { net, world, join } = room();
  const a = join('a');
  const b = join('b');
  world.stuck = true;
  syncAll([a, b]);
  await settle();
  vi.advanceTimersByTime(TIMEOUT);
  await settle();
  expect(a.states.get('b')).toBe('failed');

  a.call.sync(['a', 'b']);
  await settle();
  expect(a.states.get('b')).toBe('connecting');
  expect(net.of('offer')).toEqual(['a>b', 'a>b']);
  vi.advanceTimersByTime(TIMEOUT);
  await settle();
  expect(a.states.get('b')).toBe('failed');

  // No third try from a.
  a.call.sync(['a', 'b']);
  await settle();
  expect(net.of('offer')).toEqual(['a>b', 'a>b']);
  expect(a.states.get('b')).toBe('failed');

  // The network gets better and b uses its own retry: a answers it although b has the larger id.
  world.stuck = false;
  b.call.sync(['a', 'b']);
  await settle();
  expect(net.of('offer')).toEqual(['a>b', 'a>b', 'b>a']);
  expectConnected([a, b]);
  expect(world.links()).toEqual(['a>b', 'b>a']);
});

test('after the network is down for longer than the timeout, the next sync connects the pair again', async () => {
  const { world, join } = room();
  const a = join('a');
  const b = join('b');
  syncAll([a, b]);
  await settle();
  world.stuck = true;
  world.between('a', 'b').become('disconnected');
  world.between('b', 'a').become('disconnected');
  await settle();
  expect(a.states.get('b')).toBe('connecting');
  vi.advanceTimersByTime(TIMEOUT);
  await settle();
  expect(a.states.get('b')).toBe('failed');
  expect(b.states.get('a')).toBe('failed');

  // The window hears "online" and syncs with the room again.
  world.stuck = false;
  syncAll([a, b]);
  await settle();
  expectConnected([a, b]);
  expect(world.links()).toEqual(['a>b', 'b>a']);
});

test('someone who restarts the app is connected again', async () => {
  const { world, join } = room();
  const a = join('a');
  const b = join('b');
  syncAll([a, b]);
  await settle();

  // a (the offerer) restarts: its new window offers, and b starts a new pair from that offer.
  crash(a);
  const a2 = join('a');
  a2.call.sync(['a', 'b']);
  await settle();
  expectConnected([a2, b]);
  expect(world.openOf('b')).toHaveLength(1);
  expect(world.between('b', 'a').partner?.owner).toBe('a');

  // b (who waits for offers) restarts: once a's old connection drops and fails, a's next sync offers again.
  crash(b);
  const b2 = join('b');
  b2.call.sync(['a', 'b']);
  world.between('a', 'b').become('disconnected');
  await settle();
  vi.advanceTimersByTime(TIMEOUT);
  await settle();
  expect(a2.states.get('b')).toBe('failed');
  a2.call.sync(['a', 'b']);
  await settle();
  expectConnected([a2, b2]);
});

test('bye and a sync without that person close the pair; a later sync that lists them connects again', async () => {
  const { world, net, join } = room();
  const [a, b, c] = ['a', 'b', 'c'].map(join) as [Person, Person, Person];
  syncAll([a, b, c]);
  await settle();

  // a's room list no longer has c: a says bye and both sides close the pair.
  a.call.sync(['a', 'b']);
  await settle();
  expect(net.of('bye')).toEqual(['a>c']);
  expect(net.sent.find((m) => m.signal === 'bye')?.payload).toBe('');
  expect(world.links()).toEqual(['a>b', 'b>a', 'b>c', 'c>b']);

  // A bye alone (c leaves b too) closes that pair as well.
  c.call.sync(['c']);
  await settle();
  expect(world.links()).toEqual(['a>b', 'b>a']);
  expect([...a.log, ...b.log, ...c.log].some((l) => l.endsWith(':failed'))).toBe(false);

  syncAll([a, b, c]);
  await settle();
  expectConnected([a, b, c]);
  expect(world.links()).toHaveLength(6);
});

test('setMuted turns the microphone track off and on without stopping it', async () => {
  const { world, join } = room();
  const a = join('a');
  const b = join('b');
  const track = a.mic.tracks[0]!;
  a.call.setMuted(true);
  expect(track.enabled).toBe(false);
  syncAll([a, b]);
  await settle();
  // The muted track is the one sent: the pair connects, the voice is silent.
  expect(world.between('a', 'b').sent[0]?.track).toBe(track);
  a.call.setMuted(false);
  expect(track.enabled).toBe(true);
  expect(track.stopped).toBe(false);
});

test('close says bye to everyone, closes every connection and stops the microphone; nothing happens after it', async () => {
  const { world, net, join } = room();
  const [a, b, c] = ['a', 'b', 'c'].map(join) as [Person, Person, Person];
  syncAll([a, b, c], ['d']);
  await settle();
  vi.advanceTimersByTime(TIMEOUT);
  await settle();
  expect(a.states.get('d')).toBe('failed');

  a.call.close();
  await settle();
  expect(net.of('bye').sort()).toEqual(['a>b', 'a>c', 'a>d']);
  expect(world.openOf('a')).toHaveLength(0);
  expect(a.mic.tracks[0]!.stopped).toBe(true);
  expect(world.links()).toEqual(['b>c', 'c>b']);

  const sent = net.sent.length;
  const made = world.peers.length;
  const reports = a.log.length;
  a.call.sync(['a', 'b', 'c', 'e']);
  await a.call.handle('b', 'offer', offerPayload('offer pc1 1'));
  a.call.setMuted(true);
  a.call.close();
  vi.advanceTimersByTime(ROOM_CONNECT_TIMEOUT_MS * 2);
  await settle();
  expect(net.sent.length).toBe(sent);
  expect(world.peers.length).toBe(made);
  expect(a.log.length).toBe(reports);
});

test('malformed or unknown signals are ignored and never throw', async () => {
  const { world, net, join } = room();
  const a = join('a');
  const bad: [string, string][] = [
    ['offer', 'not json'],
    ['offer', '{"sdp":{"type":"answer","sdp":"x"}}'],
    ['offer', '{"sdp":{"type":"offer","sdp":5}}'],
    ['offer', '{}'],
    ['answer', '[]'],
    ['answer', 'null'],
    ['candidate', '{"candidate":null}'],
    ['candidate', '{"candidate":{"candidate":7}}'],
    ['candidate', '"x"'],
    ['bye', '{}'],
    ['hello', '{}'],
  ];
  for (const [signal, payload] of bad) {
    await expect(a.call.handle('b', signal as RoomSignalKind, payload)).resolves.toBeUndefined();
  }
  expect(world.peers).toHaveLength(0);
  // A well-formed offer the connection refuses does not throw either, and a signal "from yourself" is ignored.
  await expect(a.call.handle('b', 'offer', offerPayload('from nowhere'))).resolves.toBeUndefined();
  await expect(a.call.handle('a', 'offer', offerPayload('from me'))).resolves.toBeUndefined();
  await settle();
  expect(net.sent).toHaveLength(0);
});

test('a candidate bigger than a signal may be is never sent', async () => {
  const { world, net, join } = room();
  const a = join('a');
  const b = join('b');
  world.hugeCandidates = true;
  syncAll([a, b]);
  await settle();
  expect(net.of('offer')).toEqual(['a>b']);
  expect(net.of('answer')).toEqual(['b>a']);
  expect(net.of('candidate')).toEqual([]);
  for (const m of net.sent) expect(bytes(m.payload)).toBeLessThanOrEqual(ROOM_SIGNAL_MAX_BYTES);
});

test('the window connects through the Cloudflare STUN server only', () => {
  expect(ICE_SERVERS).toEqual([{ urls: 'stun:stun.cloudflare.com:3478' }]);
  const made: unknown[] = [];
  vi.stubGlobal(
    'RTCPeerConnection',
    class {
      constructor(config: unknown) {
        made.push(config);
      }
    },
  );
  browserPeer();
  expect(made).toEqual([{ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] }]);
});
