// The real avatar decoder and encoder (Chromium canvas). Kept apart from image.ts so tests run without a DOM.
import type { AvatarDeps } from './image';

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
