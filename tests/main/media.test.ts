import { inspectBanner, prepareBannerUpload, stripGifMetadata, stripWebpMetadata } from '../../src/main/social/media';

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

/** Data sub-blocks (≤ 255 bytes each) followed by the terminator. */
function subBlocks(data: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 255) {
    const part = data.slice(i, i + 255);
    out.push(part.length, ...part);
  }
  return [...out, 0];
}

function gif(o: { w?: number; h?: number; frames?: number; frameBytes?: number; comment?: string; netscape?: boolean; xmp?: boolean } = {}) {
  const { w = 960, h = 320, frames = 2, frameBytes = 4, comment, netscape = true, xmp } = o;
  const b = [...ascii('GIF89a'), ...u16(w), ...u16(h), 0x80, 0, 0, 0, 0, 0, 255, 255, 255];
  if (netscape) b.push(0x21, 0xff, 11, ...ascii('NETSCAPE2.0'), 3, 1, 0, 0, 0);
  if (comment) b.push(0x21, 0xfe, ...subBlocks(ascii(comment)));
  if (xmp) b.push(0x21, 0xff, 11, ...ascii('XMP DataXMP'), ...subBlocks(ascii('<x:xmpmeta GPS="1"/>')));
  for (let f = 0; f < frames; f++) {
    b.push(0x21, 0xf9, 4, 0, 10, 0, 0, 0);
    b.push(0x2c, ...u16(0), ...u16(0), ...u16(w), ...u16(h), 0, 2);
    for (const byte of subBlocks(new Array<number>(frameBytes).fill(0x4c))) b.push(byte);
  }
  b.push(0x3b);
  return new Uint8Array(b);
}

function chunk(fourcc: string, payload: number[]): number[] {
  return [...ascii(fourcc), ...u32(payload.length), ...payload, ...(payload.length % 2 ? [0] : [])];
}

function webp(o: { w?: number; h?: number; animated?: boolean; exif?: boolean; xmp?: boolean; simple?: boolean } = {}) {
  const { w = 960, h = 320, animated = true, exif, xmp, simple } = o;
  let body: number[];
  if (simple) {
    const bits = (w - 1) | ((h - 1) << 14);
    body = chunk('VP8L', [0x2f, ...u32(bits), 1, 2, 3]);
  } else {
    const flags = (animated ? 0x02 : 0) | (exif ? 0x08 : 0) | (xmp ? 0x04 : 0);
    body = chunk('VP8X', [flags, 0, 0, 0, ...u24(w - 1), ...u24(h - 1)]);
    if (animated) body.push(...chunk('ANIM', [0, 0, 0, 0, 0, 0]), ...chunk('ANMF', new Array<number>(20).fill(7)));
    else body.push(...chunk('VP8L', [0x2f, ...u32((w - 1) | ((h - 1) << 14)), 1, 2, 3]));
    if (exif) body.push(...chunk('EXIF', ascii('Exif\0\0GPSLatitude=12.3')));
    if (xmp) body.push(...chunk('XMP ', ascii('<x:xmpmeta GPS="1"/>')));
  }
  return new Uint8Array([...ascii('RIFF'), ...u32(4 + body.length), ...ascii('WEBP'), ...body]);
}

const text = (b: Uint8Array) => Buffer.from(b).toString('latin1');

describe('GIF', () => {
  test('a comment is removed and the loop extension kept, byte for byte', () => {
    expect(stripGifMetadata(gif({ comment: 'secret comment' }))).toEqual(gif());
    expect(text(stripGifMetadata(gif({ comment: 'secret comment' })))).toContain('NETSCAPE2.0');
  });

  test('an XMP application extension is removed', () => {
    expect(stripGifMetadata(gif({ xmp: true }))).toEqual(gif());
  });

  test('inspect reports the kind and size', () => {
    expect(inspectBanner(gif())).toEqual({ kind: 'gif', width: 960, height: 320 });
  });

  test('absurd or tiny dimensions are refused', () => {
    expect(inspectBanner(gif({ w: 60000, h: 60000 }))).toEqual({ error: 'bad_dimensions' });
    expect(inspectBanner(gif({ w: 300, h: 100 }))).toEqual({ error: 'bad_dimensions' });
  });

  test('a truncated GIF is corrupt', () => {
    const full = gif();
    expect(inspectBanner(full.slice(0, full.length - 12))).toEqual({ error: 'corrupt' });
  });
});

describe('WebP', () => {
  test('EXIF and XMP chunks are removed, flags cleared and the RIFF size fixed', () => {
    const cleaned = stripWebpMetadata(webp({ exif: true, xmp: true }));
    expect(cleaned).toEqual(webp());
    expect(text(cleaned)).not.toContain('GPS');
  });

  test('inspect tells animated from still', () => {
    expect(inspectBanner(webp())).toEqual({ kind: 'webp-animated', width: 960, height: 320 });
    expect(inspectBanner(webp({ animated: false, w: 1500, h: 500 }))).toEqual({ kind: 'webp-static', width: 1500, height: 500 });
    expect(inspectBanner(webp({ simple: true, w: 1500, h: 500 }))).toEqual({ kind: 'webp-static', width: 1500, height: 500 });
  });

  test('a truncated WebP is corrupt', () => {
    const full = webp({ exif: true });
    expect(inspectBanner(full.slice(0, full.length - 9))).toEqual({ error: 'corrupt' });
  });
});

describe('prepareBannerUpload', () => {
  test('a PNG (whatever its name) is unsupported', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array<number>(40).fill(0)]);
    expect(prepareBannerUpload(png)).toEqual({ error: 'unsupported' });
  });

  test('cleans and returns the extension', () => {
    expect(prepareBannerUpload(gif({ comment: 'hello' }))).toEqual({ bytes: gif(), ext: 'gif' });
    expect(prepareBannerUpload(webp({ exif: true }))).toEqual({ bytes: webp(), ext: 'webp' });
  });

  test('over 2 MB after cleaning is too large', () => {
    const big = gif({ frames: 1, frameBytes: 2 * 1024 * 1024 });
    expect(prepareBannerUpload(big)).toEqual({ error: 'too_large' });
  });
});
