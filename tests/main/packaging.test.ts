// The Windows installer and the Linux AppImage are made from electron-builder.yml. These tests fail when a decision
// recorded there drifts: the targets, the file names, what gets packaged, the scripts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { block } from './yaml-block';

const text = (path: string) => readFileSync(join(__dirname, '../..', path), 'utf8');
const config = text('electron-builder.yml');

test('Windows gets a one-click NSIS installer for x64 that installs for the person, not the machine, with the app icon', () => {
  const win = block(config, 'win');
  expect(win).toMatch(/target:\n {4}- target: nsis\n {6}arch: \[x64\]\n/);
  expect(win).toMatch(/^ {2}icon: build\/icon\.png$/m);
  expect(block(config, 'nsis')).toMatch(/^ {2}oneClick: true\n {2}perMachine: false$/m);
});

test('the installer and the AppImage are named from the package version', () => {
  expect(block(config, 'win')).toContain('  artifactName: DevTalk-Setup-${version}.${ext}');
  expect(block(config, 'linux')).toContain('  artifactName: DevTalk-${version}.${ext}');
  expect(block(config, 'linux')).toMatch(/target: \[AppImage\]/);
});

test('what gets packaged is unchanged: out/, package.json and the coach prompts', () => {
  expect(config).toMatch(/^files:\n {2}- out\/\*\*\n {2}- package\.json\n/m);
  expect(config).toMatch(/^extraResources:\n {2}- from: prompts\n {4}to: prompts\n/m);
});

test('package.json builds each platform from the same build', () => {
  const scripts = (JSON.parse(text('package.json')) as { scripts: Record<string, string> }).scripts;
  expect(scripts['dist:linux']).toBe('electron-vite build && electron-builder --linux --publish never');
  expect(scripts['dist:win']).toBe('electron-vite build && electron-builder --win --publish never');
});
