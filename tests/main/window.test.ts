import { mainWindowOptions } from '../../src/main/window';

const PRELOAD = '/app/out/preload/index.cjs';
const ICON = '/app/out/main/chunks/icon.png';
const options = (platform: NodeJS.Platform) => mainWindowOptions({ preload: PRELOAD, icon: ICON, platform });

test('on Linux the window gets the duck icon, for the dock and the taskbar', () => {
  expect(options('linux').icon).toBe(ICON);
});

test('on macOS and Windows no icon is set: the app bundle carries it', () => {
  expect(options('darwin')).not.toHaveProperty('icon');
  expect(options('win32')).not.toHaveProperty('icon');
});

test('the platform defaults to the one the app runs on', () => {
  const here = mainWindowOptions({ preload: PRELOAD, icon: ICON });
  expect('icon' in here).toBe(process.platform === 'linux');
});

test('the window stays isolated and sandboxed on every platform', () => {
  for (const platform of ['linux', 'darwin', 'win32'] as const) {
    expect(options(platform).webPreferences).toMatchObject({
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    });
  }
});

test('the window keeps its size, stays hidden until it is ready and opens on the dark ground', () => {
  expect(options('linux')).toMatchObject({
    width: 1280, height: 820, minWidth: 900, minHeight: 600, show: false, backgroundColor: '#0f1726',
  });
});
