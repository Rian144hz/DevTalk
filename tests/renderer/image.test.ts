import { AvatarInputError, centreSquare, prepareAvatar } from '../../src/renderer/lib/image';
import type { AvatarDeps } from '../../src/renderer/lib/image';

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
