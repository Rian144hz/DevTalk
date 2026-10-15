import { AvatarInputError, BannerInputError, centreCrop, centreSquare, parseDataUrl, prepareAvatar, prepareBanner } from '../../src/renderer/lib/image';
import type { AvatarDeps, BannerDeps } from '../../src/renderer/lib/image';
import { gif, webp } from '../main/banner-fixtures';

const MB = 1024 * 1024;

function deps(sizes: number[] = [10_000]) {
  const calls: { crop: unknown; out: number; quality: number }[] = [];
  let decoded = 0;
  const d: AvatarDeps = {
    decode: async () => {
      decoded++;
      return { width: 1000, height: 600 };
    },
    encode: async (_src, crop, out, quality) => {
      calls.push({ crop, out, quality });
      return new Uint8Array(sizes[calls.length - 1] ?? 10);
    },
  };
  return { d, calls, decoded: () => decoded };
}

test('centreSquare crops the middle of the longer side', () => {
  expect(centreSquare(1000, 600)).toEqual({ sx: 200, sy: 0, size: 600 });
  expect(centreSquare(300, 500)).toEqual({ sx: 0, sy: 100, size: 300 });
});

test('a landscape photo becomes a 256×256 WebP at quality 0.8', async () => {
  const { d, calls } = deps();
  const out = await prepareAvatar({ type: 'image/jpeg', size: 2 * MB }, d);
  expect(out.byteLength).toBe(10_000);
  expect(calls).toEqual([{ crop: { sx: 200, sy: 0, size: 600 }, out: 256, quality: 0.8 }]);
});

test('re-encodes at 0.6 when the first try is over 200 KB', async () => {
  const { d, calls } = deps([250 * 1024, 150 * 1024]);
  const out = await prepareAvatar({ type: 'image/png', size: MB }, d);
  expect(out.byteLength).toBe(150 * 1024);
  expect(calls.map((c) => c.quality)).toEqual([0.8, 0.6]);
});

test('still over 200 KB after re-encoding is refused', async () => {
  const { d } = deps([250 * 1024, 210 * 1024]);
  await expect(prepareAvatar({ type: 'image/webp', size: MB }, d)).rejects.toMatchObject({ reason: 'too_large' });
});

test.each([
  ['an SVG', { type: 'image/svg+xml', size: 2_000 }, 'unsupported'],
  ['a GIF', { type: 'image/gif', size: 2_000 }, 'unsupported'],
  ['a renamed text file', { type: 'text/plain', size: 2_000 }, 'unsupported'],
  ['a 9 MB JPEG', { type: 'image/jpeg', size: 9 * MB }, 'too_large'],
  ['a 30 MB PNG', { type: 'image/png', size: 30 * MB }, 'too_large'],
])('refuses %s before decoding', async (_label, file, reason) => {
  const { d, decoded } = deps();
  const err = await prepareAvatar(file, d).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(AvatarInputError);
  expect((err as AvatarInputError).reason).toBe(reason);
  expect(decoded()).toBe(0);
});

test('a file that cannot be decoded is unsupported', async () => {
  const d: AvatarDeps = { decode: async () => { throw new Error('bad image'); }, encode: async () => new Uint8Array(1) };
  await expect(prepareAvatar({ type: 'image/jpeg', size: 1000 }, d)).rejects.toMatchObject({ reason: 'unsupported' });
});

describe('banner', () => {
  function bannerDeps(o: { bytes?: Uint8Array; sizes?: number[]; width?: number; height?: number } = {}) {
    const calls: { crop: unknown; w: number; h: number; quality: number }[] = [];
    let decoded = 0;
    let read = 0;
    const d: BannerDeps = {
      read: async () => {
        read++;
        return o.bytes ?? gif({ frames: 1 });
      },
      decode: async () => {
        decoded++;
        return { width: o.width ?? 3000, height: o.height ?? 1000 };
      },
      encode: async (_src, crop, w, h, quality) => {
        calls.push({ crop, w, h, quality });
        return new Uint8Array(o.sizes?.[calls.length - 1] ?? 100);
      },
    };
    return { d, calls, decoded: () => decoded, read: () => read };
  }

  test('centreCrop keeps the middle 3:1 band', () => {
    expect(centreCrop(3000, 1000)).toEqual({ sx: 0, sy: 0, sw: 3000, sh: 1000 });
    expect(centreCrop(2000, 1000)).toEqual({ sx: 0, sy: 167, sw: 2000, sh: 667 });
    expect(centreCrop(4000, 1000)).toEqual({ sx: 500, sy: 0, sw: 3000, sh: 1000 });
  });

  test('a still image becomes a 1500×500 WebP, re-encoded at 0.6 when over 2 MB', async () => {
    const { d, calls, read } = bannerDeps({ sizes: [3 * MB, MB] });
    const out = await prepareBanner({ type: 'image/png', size: 4 * MB }, d);
    expect(out).toEqual({ bytes: new Uint8Array(MB), type: 'image/webp' });
    expect(calls).toEqual([
      { crop: { sx: 0, sy: 0, sw: 3000, sh: 1000 }, w: 1500, h: 500, quality: 0.8 },
      { crop: { sx: 0, sy: 0, sw: 3000, sh: 1000 }, w: 1500, h: 500, quality: 0.6 },
    ]);
    expect(read()).toBe(0);
  });

  test('an animated GIF or WebP is sent as chosen, decided from its bytes', async () => {
    const animatedGif = gif({ frames: 3 });
    const g = bannerDeps({ bytes: animatedGif });
    expect(await prepareBanner({ type: 'image/gif', size: MB }, g.d)).toEqual({ bytes: animatedGif, type: 'image/gif' });
    expect(g.decoded()).toBe(0);
    const w = bannerDeps({ bytes: webp() });
    expect((await prepareBanner({ type: 'image/webp', size: MB }, w.d)).type).toBe('image/webp');
    expect(w.decoded()).toBe(0);
  });

  test('a single-frame GIF or a still WebP is treated as a still image', async () => {
    for (const [type, bytes] of [['image/gif', gif({ frames: 1 })], ['image/webp', webp({ animated: false })]] as const) {
      const { d, calls } = bannerDeps({ bytes });
      expect((await prepareBanner({ type, size: MB }, d)).type).toBe('image/webp');
      expect(calls).toHaveLength(1);
    }
  });

  test('an animated GIF smaller than 600 × 200 is refused when chosen, not when saved', async () => {
    const { d } = bannerDeps({ bytes: gif({ w: 498, h: 280 }) });
    await expect(prepareBanner({ type: 'image/gif', size: 100_000 }, d)).rejects.toMatchObject({
      reason: 'animated_too_small',
      message: 'An animated banner must be at least 600 × 200 pixels.',
    });
  });

  test.each([
    ['an SVG', { type: 'image/svg+xml', size: 2_000 }, 'unsupported', 'Choose a GIF, WebP, JPEG or PNG image.'],
    ['a 9 MB JPEG', { type: 'image/jpeg', size: 9 * MB }, 'too_large', 'Choose an image under 8 MB.'],
    ['a 3 MB animated GIF', { type: 'image/gif', size: 3 * MB }, 'animated_too_large', 'An animated banner must be under 2 MB.'],
  ])('refuses %s', async (_label, file, reason, message) => {
    const { d, calls } = bannerDeps({ bytes: gif() });
    const err = await prepareBanner(file, d).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BannerInputError);
    expect(err).toMatchObject({ reason, message });
    expect(calls).toHaveLength(0);
  });

  test('a file that cannot be decoded is unsupported', async () => {
    const { d } = bannerDeps();
    d.decode = async () => { throw new Error('bad'); };
    await expect(prepareBanner({ type: 'image/jpeg', size: 1000 }, d)).rejects.toMatchObject({ reason: 'unsupported' });
  });
});

test('parseDataUrl reads base64 data: URLs and nothing else', () => {
  expect(parseDataUrl('data:image/gif;base64,R0lGOA==')).toEqual({ type: 'image/gif', bytes: new Uint8Array([71, 73, 70, 56]) });
  expect(parseDataUrl('https://example.com/a.gif')).toBeNull();
  expect(parseDataUrl('data:image/gif,R0lGOA==')).toBeNull();
});
