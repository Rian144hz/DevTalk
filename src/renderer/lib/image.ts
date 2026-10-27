// Profile photo and banner preparation in the window. Still images are cropped, resized and re-encoded as WebP:
// re-encoding through a canvas drops EXIF data (including GPS) before anything leaves the machine. Animated banners
// are sent as chosen and the main process removes their metadata without re-encoding.
import { inspectBanner, isAnimatedBanner } from '../../core/media/banner';

export const AVATAR_SIZE = 256;
export const MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 200 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

export class AvatarInputError extends Error {
  constructor(readonly reason: 'unsupported' | 'too_large') {
    super(reason === 'unsupported' ? 'Choose a JPEG, PNG or WebP image.' : 'Choose an image under 8 MB.');
    this.name = 'AvatarInputError';
  }
}

export interface ImageBitmapLike {
  width: number;
  height: number;
  close?(): void;
}

export interface Crop {
  sx: number;
  sy: number;
  size: number;
}

export interface AvatarDeps {
  decode(file: { type: string; size: number }): Promise<ImageBitmapLike>;
  encode(source: ImageBitmapLike, crop: Crop, out: number, quality: number): Promise<Uint8Array>;
}

export function centreSquare(width: number, height: number): Crop {
  const size = Math.min(width, height);
  return { sx: Math.round((width - size) / 2), sy: Math.round((height - size) / 2), size };
}

export async function prepareAvatar(file: { type: string; size: number }, deps: AvatarDeps): Promise<Uint8Array> {
  if (!ACCEPTED.includes(file.type)) throw new AvatarInputError('unsupported');
  if (file.size > MAX_INPUT_BYTES) throw new AvatarInputError('too_large');
  let bitmap: ImageBitmapLike;
  try {
    bitmap = await deps.decode(file);
  } catch {
    throw new AvatarInputError('unsupported');
  }
  try {
    const crop = centreSquare(bitmap.width, bitmap.height);
    for (const quality of [0.8, 0.6]) {
      const bytes = await deps.encode(bitmap, crop, AVATAR_SIZE, quality);
      if (bytes.byteLength <= MAX_OUTPUT_BYTES) return bytes;
    }
    throw new AvatarInputError('too_large');
  } finally {
    bitmap.close?.();
  }
}

/**
 * A photo that came as a data: URL (the GitHub suggestion) through the same preparation as a picked file: cropped,
 * resized and re-encoded as WebP, which drops its metadata. Null when it cannot be used; the caller just goes without.
 */
export async function prepareSuggestedAvatar(src: string, deps: AvatarDeps): Promise<Uint8Array | null> {
  try {
    const parsed = parseDataUrl(src);
    if (!parsed) return null;
    // The window's CSP refuses fetch() of a data: URL, and createImageBitmap needs a Blob, so the bytes go back into one.
    return await prepareAvatar(new Blob([parsed.bytes as Uint8Array<ArrayBuffer>], { type: parsed.type }), deps);
  } catch {
    return null;
  }
}

// ---- Banner ----

export const BANNER_WIDTH = 1500;
export const BANNER_HEIGHT = 500;
export const MAX_BANNER_BYTES = 2 * 1024 * 1024;
const BANNER_ACCEPTED = ['image/gif', 'image/webp', 'image/jpeg', 'image/png'];

export type BannerInputReason = 'unsupported' | 'too_large' | 'animated_too_large' | 'animated_too_small';
const BANNER_MESSAGES: Record<BannerInputReason, string> = {
  unsupported: 'Choose a GIF, WebP, JPEG or PNG image.',
  too_large: 'Choose an image under 8 MB.',
  animated_too_large: 'An animated banner must be under 2 MB.',
  animated_too_small: 'An animated banner must be at least 600 × 200 pixels.',
};

export class BannerInputError extends Error {
  constructor(readonly reason: BannerInputReason) {
    super(BANNER_MESSAGES[reason]);
    this.name = 'BannerInputError';
  }
}

export interface RectCrop {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface BannerDeps {
  read(file: { type: string; size: number }): Promise<Uint8Array>;
  decode(file: { type: string; size: number }): Promise<ImageBitmapLike>;
  encode(source: ImageBitmapLike, crop: RectCrop, width: number, height: number, quality: number): Promise<Uint8Array>;
}

/** The largest centred 3:1 band of a width × height image. */
export function centreCrop(width: number, height: number): RectCrop {
  const [sw, sh] = width / height > 3 ? [Math.round(height * 3), height] : [width, Math.round(width / 3)];
  return { sx: Math.round((width - sw) / 2), sy: Math.round((height - sh) / 2), sw, sh };
}

/** An animated GIF/WebP as chosen (up to 2 MB), or any still image as a 1500 × 500 WebP. */
export async function prepareBanner(
  file: { type: string; size: number },
  deps: BannerDeps,
): Promise<{ bytes: Uint8Array; type: 'image/gif' | 'image/webp' }> {
  if (!BANNER_ACCEPTED.includes(file.type)) throw new BannerInputError('unsupported');
  if (file.size > MAX_INPUT_BYTES) throw new BannerInputError('too_large');
  if (file.type === 'image/gif' || file.type === 'image/webp') {
    // Decided from the bytes, the same way the main process reads them (frame count, WebP animation flag).
    const bytes = await deps.read(file);
    if (isAnimatedBanner(bytes)) {
      if (file.size > MAX_BANNER_BYTES) throw new BannerInputError('animated_too_large');
      const info = inspectBanner(bytes);
      if ('error' in info) throw new BannerInputError(info.error === 'bad_dimensions' ? 'animated_too_small' : 'unsupported');
      return { bytes, type: file.type };
    }
  }
  let bitmap: ImageBitmapLike;
  try {
    bitmap = await deps.decode(file);
  } catch {
    throw new BannerInputError('unsupported');
  }
  try {
    const crop = centreCrop(bitmap.width, bitmap.height);
    for (const quality of [0.8, 0.6]) {
      const bytes = await deps.encode(bitmap, crop, BANNER_WIDTH, BANNER_HEIGHT, quality);
      if (bytes.byteLength <= MAX_BANNER_BYTES) return { bytes, type: 'image/webp' };
    }
    throw new BannerInputError('too_large');
  } finally {
    bitmap.close?.();
  }
}

/** The bytes and type of a base64 data: URL (images reach the window this way), or null for anything else. */
export function parseDataUrl(src: string): { type: string; bytes: Uint8Array } | null {
  const m = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]*)$/.exec(src);
  if (!m) return null;
  const raw = atob(m[2]!);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return { type: m[1]!, bytes };
}
