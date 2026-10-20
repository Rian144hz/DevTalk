import { levelMeter, openMic, rmsLevel } from '../../src/renderer/lib/mic';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('the level is 0 for silence and 1 for a full-scale sound, on a decibel scale', () => {
  expect(rmsLevel(new Float32Array(512))).toBe(0);
  expect(rmsLevel(new Float32Array(0))).toBe(0);
  expect(rmsLevel(new Float32Array(512).fill(1))).toBe(1);
  expect(rmsLevel(new Float32Array(512).fill(-1))).toBe(1);
  expect(rmsLevel(new Float32Array(512).fill(2))).toBe(1);
  expect(rmsLevel(new Float32Array(512).fill(0.001))).toBeCloseTo(0, 6); // -60 dB: the bottom of the meter
  expect(rmsLevel(new Float32Array(512).fill(0.0001))).toBe(0);
  expect(rmsLevel(new Float32Array(512).fill(0.0316))).toBeCloseTo(0.5, 2); // -30 dB: normal speech, half way
  expect(rmsLevel([Number.NaN, 0.5])).toBe(0);
});

test('a louder sound never gives a lower level', () => {
  let last = 0;
  for (let amp = 0; amp <= 1; amp += 0.01) {
    const level = rmsLevel(new Float32Array(256).fill(amp));
    expect(level).toBeGreaterThanOrEqual(last);
    expect(level).toBeLessThanOrEqual(1);
    last = level;
  }
});

test('openMic asks for audio only, with echo cancellation, noise suppression and automatic gain', async () => {
  const stream = {} as MediaStream;
  const getUserMedia = vi.fn(async () => stream);
  await expect(openMic({ getUserMedia })).resolves.toBe(stream);
  expect(getUserMedia).toHaveBeenCalledWith({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
});

test('openMic passes the browser error on, so the screen can explain it', async () => {
  const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
  await expect(openMic({ getUserMedia: async () => Promise.reject(denied) })).rejects.toBe(denied);
});

class FakeAnalyser {
  fftSize = 2048;
  amplitude = 0;
  connected: unknown[] = [];
  getFloatTimeDomainData(out: Float32Array) {
    out.fill(this.amplitude);
  }
  connect(to: unknown) {
    this.connected.push(to);
  }
}

class FakeSource {
  connected: unknown[] = [];
  disconnected = false;
  constructor(readonly stream: unknown) {}
  connect(to: unknown) {
    this.connected.push(to);
  }
  disconnect() {
    this.disconnected = true;
  }
}

/** Fake AudioContext and animation frames as globals; `run` calls the latest frame. */
function stubAudio(opts: { sourceThrows?: boolean } = {}) {
  const frames: ((t: number) => void)[] = [];
  const cancelled: number[] = [];
  const contexts: FakeContext[] = [];
  class FakeContext {
    state = 'running';
    closed = 0;
    destination = { speakers: true };
    analyser = new FakeAnalyser();
    source: FakeSource | null = null;
    constructor() {
      contexts.push(this);
    }
    createMediaStreamSource(stream: unknown) {
      if (opts.sourceThrows) throw Object.assign(new Error('no audio track'), { name: 'InvalidStateError' });
      this.source = new FakeSource(stream);
      return this.source;
    }
    createAnalyser() {
      return this.analyser;
    }
    async resume() {}
    async close() {
      this.closed++;
    }
  }
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('requestAnimationFrame', (fn: (t: number) => void) => frames.push(fn));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => cancelled.push(id));
  return { frames, cancelled, contexts, run: (t: number) => frames.at(-1)!(t) };
}

const fakeStream = { id: 'mic' } as unknown as MediaStream;

test('the meter reads the analyser about 15 times a second, plays nothing, and stop closes the audio context', () => {
  const { frames, cancelled, contexts, run } = stubAudio();
  const levels: number[] = [];
  const stop = levelMeter(fakeStream, (l) => levels.push(l));
  const ctx = contexts[0]!;
  expect(ctx.source?.stream).toBe(fakeStream);
  expect(ctx.source?.connected).toEqual([ctx.analyser]);
  expect(ctx.analyser.connected).toEqual([]); // never to the speakers: your own voice is not played back

  ctx.analyser.amplitude = 1;
  run(0);
  run(16); // too soon after the last reading
  run(70);
  ctx.analyser.amplitude = 0;
  run(140);
  expect(levels).toEqual([1, 1, 0]);

  stop();
  expect(ctx.closed).toBe(1);
  expect(ctx.source?.disconnected).toBe(true);
  expect(cancelled).toEqual([frames.length]);
  const count = frames.length;
  run(500); // a frame already queued does nothing after stop
  expect(levels).toEqual([1, 1, 0]);
  expect(frames.length).toBe(count);
  stop();
  expect(ctx.closed).toBe(1);
});

test('a stream the audio context cannot read closes the context and passes the error on', () => {
  const { contexts, frames } = stubAudio({ sourceThrows: true });
  expect(() => levelMeter(fakeStream, () => {})).toThrow('no audio track');
  expect(contexts[0]!.closed).toBe(1);
  expect(frames).toHaveLength(0);
});

test('the meter keeps going when onLevel throws', () => {
  const { contexts, frames, run } = stubAudio();
  const levels: number[] = [];
  const stop = levelMeter(fakeStream, (l) => {
    levels.push(l);
    if (levels.length === 1) throw new Error('screen bug');
  });
  contexts[0]!.analyser.amplitude = 1;
  expect(() => run(0)).toThrow('screen bug');
  expect(frames).toHaveLength(2); // the next frame was asked for before onLevel ran
  run(70);
  run(140);
  expect(levels).toEqual([1, 1, 1]);
  stop();
});
