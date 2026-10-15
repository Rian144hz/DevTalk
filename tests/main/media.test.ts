import { inspectBanner, prepareBannerUpload, stripGifMetadata, stripWebpMetadata } from '../../src/main/social/media';
import { gif, webp } from './banner-fixtures';

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
