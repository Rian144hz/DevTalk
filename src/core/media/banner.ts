// Profile banners, read from their bytes: kind, size, whether they move, and metadata removal without re-encoding.
// Pure (no DOM, no Node): the window uses it to tell animated from still, the main process to check and clean.
// The window re-encodes still images itself; animated GIF/WebP arrive as chosen and are cleaned in main.

export type BannerKind = 'gif' | 'webp-animated' | 'webp-static';
export type BannerError = 'unsupported' | 'too_large' | 'bad_dimensions' | 'corrupt';

export const MAX_BANNER_BYTES = 2 * 1024 * 1024;
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MIN_W = 600;
const MIN_H = 200;
const MAX_SIDE = 4096;

class Corrupt extends Error {}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const u16 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);
const u24 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);
const u32 = (b: Uint8Array, at: number) => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;

function need(b: Uint8Array, end: number): void {
  if (end > b.length) throw new Corrupt();
}

const isGif = (b: Uint8Array) => b.length >= 6 && (ascii(b, 0, 6) === 'GIF89a' || ascii(b, 0, 6) === 'GIF87a');
const isWebp = (b: Uint8Array) => b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP';

// ---- GIF ----

interface GifBlock {
  start: number;
  end: number;
  keep: boolean;
}

/** Skips data sub-blocks starting at `at`; returns the index after the 0 terminator. */
function skipSubBlocks(b: Uint8Array, at: number): number {
  let i = at;
  for (;;) {
    need(b, i + 1);
    const size = b[i]!;
    i += 1;
    if (size === 0) return i;
    need(b, i + size);
    i += size;
  }
}

/** Walks a GIF and lists its top-level blocks after the header and colour table. */
function walkGif(b: Uint8Array): { headerEnd: number; blocks: GifBlock[]; frames: number } {
  need(b, 13);
  const packed = b[10]!;
  let i = 13 + (packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0);
  need(b, i);
  const headerEnd = i;
  const blocks: GifBlock[] = [];
  let frames = 0;
  for (;;) {
    need(b, i + 1);
    const start = i;
    const intro = b[i]!;
    if (intro === 0x3b) {
      blocks.push({ start, end: i + 1, keep: true });
      return { headerEnd, blocks, frames };
    }
    if (intro === 0x21) {
      need(b, i + 2);
      const label = b[i + 1]!;
      let keep = label === 0xf9;
      if (label === 0xff) {
        need(b, i + 3 + 11);
        const id = ascii(b, i + 3, 11);
        keep = id === 'NETSCAPE2.0' || id === 'ANIMEXTS1.0';
      }
      i = skipSubBlocks(b, i + 2);
      blocks.push({ start, end: i, keep });
    } else if (intro === 0x2c) {
      need(b, i + 10);
      const local = b[i + 9]!;
      i += 10 + (local & 0x80 ? 3 * (1 << ((local & 7) + 1)) : 0);
      need(b, i + 1);
      i = skipSubBlocks(b, i + 1);
      frames++;
      blocks.push({ start, end: i, keep: true });
    } else {
      throw new Corrupt();
    }
  }
}

/** The application extension that makes a GIF loop forever (loop count 0). */
const LOOP_FOREVER = new Uint8Array([0x21, 0xff, 11, ...Array.from('NETSCAPE2.0', (c) => c.charCodeAt(0)), 3, 1, 0, 0, 0]);

const isLoopBlock = (b: Uint8Array, k: GifBlock) => b[k.start] === 0x21 && b[k.start + 1] === 0xff && k.keep;

/**
 * Removes comment, plain-text and application extensions (except the animation loop). An animated GIF is set to
 * loop forever, as banners do: a missing loop extension is added and a finite loop count becomes 0.
 */
export function stripGifMetadata(bytes: Uint8Array): Uint8Array {
  const { headerEnd, blocks, frames } = walkGif(bytes);
  const kept = blocks.filter((k) => k.keep).map((k) => {
    const part = bytes.slice(k.start, k.end);
    // NETSCAPE2.0 / ANIMEXTS1.0: 11-byte id, then a 3-byte sub-block [1, count lo, count hi].
    if (frames > 1 && isLoopBlock(bytes, k) && part[14] === 3 && part[15] === 1) part.set([0, 0], 16);
    return part;
  });
  const hasLoop = blocks.some((k) => isLoopBlock(bytes, k));
  const parts = [bytes.subarray(0, headerEnd), ...(frames > 1 && !hasLoop ? [LOOP_FOREVER] : []), ...kept];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---- WebP ----

interface WebpChunk {
  fourcc: string;
  start: number;
  end: number;
  payload: number;
  size: number;
}

function walkWebp(b: Uint8Array): WebpChunk[] {
  need(b, 12);
  const riffEnd = 8 + u32(b, 4);
  if (riffEnd > b.length) throw new Corrupt();
  const chunks: WebpChunk[] = [];
  let i = 12;
  while (i < riffEnd) {
    need(b, i + 8);
    const size = u32(b, i + 4);
    const end = i + 8 + size + (size % 2);
    if (end > riffEnd) throw new Corrupt();
    chunks.push({ fourcc: ascii(b, i, 4), start: i, end, payload: i + 8, size });
    i = end;
  }
  if (chunks.length === 0) throw new Corrupt();
  return chunks;
}

function webpInfo(b: Uint8Array): { kind: BannerKind; width: number; height: number } {
  const chunks = walkWebp(b);
  const first = chunks[0]!;
  if (first.fourcc === 'VP8X') {
    if (first.size < 10) throw new Corrupt();
    const flags = b[first.payload]!;
    const animated = (flags & 0x02) !== 0 || chunks.some((c) => c.fourcc === 'ANIM');
    return {
      kind: animated ? 'webp-animated' : 'webp-static',
      width: u24(b, first.payload + 4) + 1,
      height: u24(b, first.payload + 7) + 1,
    };
  }
  if (first.fourcc === 'VP8L') {
    if (first.size < 5 || b[first.payload] !== 0x2f) throw new Corrupt();
    const bits = u32(b, first.payload + 1);
    return { kind: 'webp-static', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (first.fourcc === 'VP8 ') {
    if (first.size < 10) throw new Corrupt();
    return { kind: 'webp-static', width: u16(b, first.payload + 6) & 0x3fff, height: u16(b, first.payload + 8) & 0x3fff };
  }
  throw new Corrupt();
}

/** Removes EXIF and XMP chunks, clears their VP8X flags and fixes the RIFF size. An animation loops forever. */
export function stripWebpMetadata(bytes: Uint8Array): Uint8Array {
  const kept = walkWebp(bytes).filter((c) => c.fourcc !== 'EXIF' && c.fourcc !== 'XMP ');
  const bodyLength = kept.reduce((n, c) => n + (c.end - c.start), 0);
  const out = new Uint8Array(12 + bodyLength);
  out.set(bytes.subarray(0, 12), 0);
  let at = 12;
  for (const c of kept) {
    out.set(bytes.subarray(c.start, c.end), at);
    if (c.fourcc === 'VP8X') out[at + 8] = out[at + 8]! & ~(0x08 | 0x04);
    // ANIM payload: background colour (4 bytes), then the loop count (2 bytes); 0 means forever.
    if (c.fourcc === 'ANIM' && c.size >= 6) out.set([0, 0], at + 8 + 4);
    at += c.end - c.start;
  }
  const riff = 4 + bodyLength;
  out.set([riff & 0xff, (riff >> 8) & 0xff, (riff >> 16) & 0xff, (riff >>> 24) & 0xff], 4);
  return out;
}

// ---- entry points ----

/** True for a GIF with two or more frames, or a WebP with the animation flag or an ANIM chunk. */
export function isAnimatedBanner(bytes: Uint8Array): boolean {
  if (bytes.length > MAX_INPUT_BYTES) return false;
  try {
    if (isGif(bytes)) return walkGif(bytes).frames > 1;
    if (isWebp(bytes)) return webpInfo(bytes).kind === 'webp-animated';
  } catch (err) {
    if (!(err instanceof Corrupt)) throw err;
  }
  return false;
}

export function inspectBanner(bytes: Uint8Array): { kind: BannerKind; width: number; height: number } | { error: BannerError } {
  if (bytes.length > MAX_INPUT_BYTES) return { error: 'too_large' };
  try {
    let info: { kind: BannerKind; width: number; height: number };
    if (isGif(bytes)) {
      walkGif(bytes);
      info = { kind: 'gif', width: u16(bytes, 6), height: u16(bytes, 8) };
    } else if (isWebp(bytes)) {
      info = webpInfo(bytes);
    } else {
      return { error: 'unsupported' };
    }
    const fits = info.width >= MIN_W && info.height >= MIN_H && info.width <= MAX_SIDE && info.height <= MAX_SIDE;
    return fits ? info : { error: 'bad_dimensions' };
  } catch (err) {
    if (err instanceof Corrupt) return { error: 'corrupt' };
    throw err;
  }
}

/** Validates a banner, removes its metadata and returns the bytes to upload with their extension. */
export function prepareBannerUpload(bytes: Uint8Array): { bytes: Uint8Array; ext: 'gif' | 'webp' } | { error: BannerError } {
  const info = inspectBanner(bytes);
  if ('error' in info) return info;
  const cleaned = info.kind === 'gif' ? stripGifMetadata(bytes) : stripWebpMetadata(bytes);
  if (cleaned.length > MAX_BANNER_BYTES) return { error: 'too_large' };
  return { bytes: cleaned, ext: info.kind === 'gif' ? 'gif' : 'webp' };
}
