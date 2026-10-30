// The app icon and the favicon are copies of the logo kit's exports (docs/design/logo/kit/export/icons), and the
// packaging and the page point at them. These tests fail when a copy drifts from its source or a link is lost.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../..');
const KIT = 'docs/design/logo/kit/export/icons';
const bytes = (path: string) => readFileSync(join(ROOT, path));
const text = (path: string) => readFileSync(join(ROOT, path), 'utf8');
/** Width and height of a PNG, from its IHDR chunk. */
function pngSize(file: Buffer): { width: number; height: number } {
  expect(file.subarray(1, 4).toString()).toBe('PNG');
  return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) };
}

test('build/icon.png is the kit icon at 1024 px: electron-builder needs a square PNG of 512 px or more for Linux', () => {
  const icon = bytes('build/icon.png');
  expect(pngSize(icon)).toEqual({ width: 1024, height: 1024 });
  expect(icon.equals(bytes(`${KIT}/icon-1024.png`))).toBe(true);
});

test('the window icon is that same file, imported as an asset that electron-vite emits into out/, which the package ships', () => {
  const main = text('src/main/index.ts');
  expect(main).toContain("import icon from '../../build/icon.png?asset';");
  // Not from resources/: that is electron-vite's public folder, which it does not copy into out/. `files` ships only out/.
  expect(main).not.toMatch(/resources\/[^'"]*\?asset/);
});

test('electron-builder takes its resources from build/ and the Linux icon from build/icon.png, and still ships only out/', () => {
  const config = text('electron-builder.yml');
  expect(config).toMatch(/^directories:\n(?: {2}.+\n)*? {2}buildResources: build$/m);
  expect(config).toMatch(/^linux:\n(?: {2}.+\n)*? {2}icon: build\/icon\.png$/m);
  expect(config).toMatch(/^files:\n {2}- out\/\*\*\n {2}- package\.json\n/m);
  expect(config).toMatch(/target: \[AppImage\]/);
});

test('the favicon is the kit\'s duck-blue small cut, served from the renderer\'s public folder and linked from the page', () => {
  expect(text('src/renderer/public/favicon.svg')).toBe(text(`${KIT}/favicon.svg`));
  expect(text('src/renderer/index.html')).toMatch(/<link rel="icon" href="\.?\/favicon\.svg" type="image\/svg\+xml"\s*\/?>/);
});
