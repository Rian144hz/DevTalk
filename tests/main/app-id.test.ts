import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_ID, appUserModelId } from '../../src/main/app-id';

test('on Windows the running window uses the id the installer gives its shortcuts, so the taskbar shows one DevTalk', () => {
  expect(appUserModelId('win32')).toBe(APP_ID);
});

test('Linux and macOS have no such id, so nothing is set there', () => {
  expect(appUserModelId('linux')).toBeNull();
  expect(appUserModelId('darwin')).toBeNull();
});

test('that id is the appId in electron-builder.yml: the installer stamps it on the Start menu and desktop shortcuts', () => {
  const config = readFileSync(join(__dirname, '../../electron-builder.yml'), 'utf8');
  expect(config.match(/^appId: (\S+)$/m)?.[1]).toBe(APP_ID);
});
