// The microphone for voice rooms, and a level meter for any voice stream. Nothing is recorded or stored: the meter
// only reads how loud the sound is right now, and your own voice is never played back to you.

/** The bottom of the meter, in decibels: anything quieter shows as 0. */
const FLOOR_DB = 60;
/** The meter updates about 15 times a second. */
const METER_INTERVAL_MS = 66;

/**
 * Opens the default microphone: audio only, with the browser's echo cancellation, noise suppression and automatic
 * gain. Browser errors are passed on for the screen to explain (NotFoundError: no microphone; NotAllowedError: refused).
 */
export function openMic(media: Pick<MediaDevices, 'getUserMedia'> = navigator.mediaDevices): Promise<MediaStream> {
  return media.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
}

/** How loud a block of samples is: 0 at -60 dB or quieter, 1 at full scale, on a decibel scale like a sound meter. */
export function rmsLevel(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]!;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / samples.length);
  if (!(rms > 0)) return 0; // silence, or NaN from a broken sample
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db + FLOOR_DB) / FLOOR_DB));
}

/**
 * Calls `onLevel` with the stream's loudness (0..1) about 15 times a second, until the returned stop function is
 * called. The stream goes into an analyser only, never to the speakers.
 */
export function levelMeter(stream: MediaStream, onLevel: (level: number) => void): () => void {
  const context = new AudioContext();
  let source: MediaStreamAudioSourceNode;
  let analyser: AnalyserNode;
  try {
    source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
  } catch (e) {
    // A stream with no audio track, for example: free the audio context, then let the caller know.
    void context.close().catch(() => {});
    throw e;
  }
  if (context.state === 'suspended') void context.resume().catch(() => {});
  const samples = new Float32Array(analyser.fftSize);
  let stopped = false;
  let last = Number.NEGATIVE_INFINITY;
  const tick = (now: number) => {
    if (stopped) return;
    // The next frame first, so an error in onLevel does not stop the meter (and onLevel may call stop).
    frame = requestAnimationFrame(tick);
    if (now - last < METER_INTERVAL_MS) return;
    last = now;
    analyser.getFloatTimeDomainData(samples);
    onLevel(rmsLevel(samples));
  };
  let frame = requestAnimationFrame(tick);
  return () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    source.disconnect();
    void context.close().catch(() => {});
  };
}
