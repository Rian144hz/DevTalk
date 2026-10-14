// Profile photo preparation: centre-crop, resize to 256×256 and re-encode as WebP in the window.
// Re-encoding through a canvas drops EXIF data (including GPS) before anything leaves the machine.

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
