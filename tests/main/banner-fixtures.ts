// GIF and WebP byte builders for banner tests.

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

export function gif(o: { w?: number; h?: number; frames?: number; frameBytes?: number; comment?: string; netscape?: boolean; loops?: number; xmp?: boolean } = {}) {
  const { w = 960, h = 320, frames = 2, frameBytes = 4, comment, netscape = true, loops = 0, xmp } = o;
  const b = [...ascii('GIF89a'), ...u16(w), ...u16(h), 0x80, 0, 0, 0, 0, 0, 255, 255, 255];
  if (netscape) b.push(0x21, 0xff, 11, ...ascii('NETSCAPE2.0'), 3, 1, ...u16(loops), 0);
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

export function webp(o: { w?: number; h?: number; animated?: boolean; exif?: boolean; xmp?: boolean; simple?: boolean } = {}) {
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
