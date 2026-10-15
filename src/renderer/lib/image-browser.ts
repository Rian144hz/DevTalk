// The real avatar decoder and encoder (Chromium canvas). Kept apart from image.ts so tests run without a DOM.
import { parseDataUrl, type AvatarDeps, type BannerDeps } from './image';

export const browserAvatarDeps: AvatarDeps = {
  decode: (file) => createImageBitmap(file as Blob, { imageOrientation: 'from-image' }),
  async encode(source, crop, out, quality) {
    const canvas = new OffscreenCanvas(out, out);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source as ImageBitmap, crop.sx, crop.sy, crop.size, crop.size, 0, 0, out, out);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
    if (blob.type !== 'image/webp') throw new Error('WebP encoding is not available.');
    return new Uint8Array(await blob.arrayBuffer());
  },
};

const canvasToBytes = async (canvas: OffscreenCanvas, quality: number) => {
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
  if (blob.type !== 'image/webp') throw new Error('WebP encoding is not available.');
  return new Uint8Array(await blob.arrayBuffer());
};

export const browserBannerDeps: BannerDeps = {
  read: async (file) => new Uint8Array(await (file as Blob).arrayBuffer()),
  decode: (file) => createImageBitmap(file as Blob, { imageOrientation: 'from-image' }),
  async encode(source, crop, width, height, quality) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source as ImageBitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
    return canvasToBytes(canvas, quality);
  },
};

/** A data: URL for bytes (the window's CSP allows data: images, not blob:). */
export function bytesToDataUrl(bytes: Uint8Array, type: string): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(s)}`;
}

/** The first frame of a data: URL image (animated or not) as a still WebP data: URL. */
export async function firstFrame(src: string): Promise<string> {
  // Decoded here rather than fetched: the window's CSP (connect-src 'self') refuses fetch() of data: URLs.
  const parsed = parseDataUrl(src);
  if (!parsed) throw new Error('Only data: URLs are expected here.');
  const decoder = new ImageDecoder({ data: parsed.bytes, type: parsed.type });
  try {
    const { image } = await decoder.decode({ frameIndex: 0 });
    try {
      const canvas = new OffscreenCanvas(image.displayWidth, image.displayHeight);
      canvas.getContext('2d')!.drawImage(image, 0, 0);
      return bytesToDataUrl(await canvasToBytes(canvas, 0.9), 'image/webp');
    } finally {
      image.close();
    }
  } finally {
    decoder.close();
  }
}
