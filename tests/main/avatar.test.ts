import { validateAvatar } from '../../src/main/social/avatar';

function webp(size: number): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0x52, 0x49, 0x46, 0x46], 0);
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  return b;
}

test('accepts a small WebP', () => {
  expect(validateAvatar(webp(1024))).toBe('ok');
  expect(validateAvatar(webp(200 * 1024))).toBe('ok');
});

test('rejects anything that is not a WebP', () => {
  expect(validateAvatar(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe('not_webp');
  expect(validateAvatar(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('not_webp');
  expect(validateAvatar(new Uint8Array(4))).toBe('not_webp');
});

test('rejects a WebP over 200 KB', () => {
  expect(validateAvatar(webp(200 * 1024 + 1))).toBe('too_large');
});
