import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDailyStore } from '../../src/main/daily/store';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'devtalk-daily-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});
const file = () => join(dir, 'daily.json');
const DEFAULTS = { enabled: false, time: '19:00', lastNotifiedDay: null, pick: null };
const PICK = { day: '2026-11-04', category: 'code_review', challengeId: 7 } as const;

test('defaults are off, 19:00, no notice, no pick', () => {
  const store = createDailyStore({ filePath: file() });
  expect(store.get()).toEqual(DEFAULTS);
  // Asking writes nothing: the file appears with the first change.
  expect(existsSync(file())).toBe(false);
});

test('update persists and a new store reads it', () => {
  const store = createDailyStore({ filePath: file() });
  expect(store.update({ enabled: true, time: '08:30' })).toEqual({ ...DEFAULTS, enabled: true, time: '08:30' });
  expect(store.update({ pick: PICK, lastNotifiedDay: '2026-11-03' })).toEqual({ enabled: true, time: '08:30', lastNotifiedDay: '2026-11-03', pick: PICK });
  // The patch is merged: the fields it does not mention stay.
  expect(store.get()).toEqual({ enabled: true, time: '08:30', lastNotifiedDay: '2026-11-03', pick: PICK });

  const again = createDailyStore({ filePath: file() });
  expect(again.get()).toEqual({ enabled: true, time: '08:30', lastNotifiedDay: '2026-11-03', pick: PICK });
  // null clears a field (a pick that is gone, a notice that did not happen).
  expect(again.update({ pick: null, lastNotifiedDay: null })).toEqual({ ...DEFAULTS, enabled: true, time: '08:30' });
  expect(createDailyStore({ filePath: file() }).get()).toEqual({ ...DEFAULTS, enabled: true, time: '08:30' });
});

test('a damaged file and a bad time (25:99) give the defaults', () => {
  const store = createDailyStore({ filePath: file() });
  const good = { enabled: true, time: '08:30', lastNotifiedDay: null, pick: null };
  const bad = [
    '', '{', 'null', '[]', '"text"', '42', '{"enabled":',
    JSON.stringify({ ...good, time: '25:99' }),
    JSON.stringify({ ...good, time: '24:00' }),
    JSON.stringify({ ...good, time: '7:05' }),
    JSON.stringify({ ...good, time: 1900 }),
    JSON.stringify({ ...good, enabled: 'yes' }),
    JSON.stringify({ ...good, lastNotifiedDay: 'yesterday' }),
    JSON.stringify({ ...good, pick: { day: '2026-11-04', category: 'poetry', challengeId: null } }),
    JSON.stringify({ ...good, pick: { day: 'today', category: 'code_review', challengeId: null } }),
    JSON.stringify({ ...good, pick: { day: '2026-11-04', category: 'code_review', challengeId: 0 } }),
    JSON.stringify({ ...good, pick: { day: '2026-11-04', category: 'code_review', challengeId: 1.5 } }),
    JSON.stringify({ ...good, pick: { day: '2026-11-04', category: 'code_review' } }),
  ];
  for (const text of bad) {
    writeFileSync(file(), text);
    expect(store.get(), text).toEqual(DEFAULTS);
  }
  // A file that is fine is read again straight after.
  writeFileSync(file(), JSON.stringify(good));
  expect(store.get()).toEqual(good);
});

test('after a damaged file the next change starts again from the defaults and leaves a good file', () => {
  writeFileSync(file(), '{ not json');
  const store = createDailyStore({ filePath: file() });
  expect(store.update({ enabled: true })).toEqual({ ...DEFAULTS, enabled: true });
  expect(JSON.parse(readFileSync(file(), 'utf8'))).toEqual({ ...DEFAULTS, enabled: true });
  expect(createDailyStore({ filePath: file() }).get()).toEqual({ ...DEFAULTS, enabled: true });
});

test('a file with missing fields keeps what it has and fills the rest from the defaults; unknown fields are ignored', () => {
  writeFileSync(file(), JSON.stringify({ enabled: true, time: '06:45', somethingNew: [1, 2, 3] }));
  expect(createDailyStore({ filePath: file() }).get()).toEqual({ enabled: true, time: '06:45', lastNotifiedDay: null, pick: null });
  writeFileSync(file(), '{}');
  expect(createDailyStore({ filePath: file() }).get()).toEqual(DEFAULTS);
});

test('update refuses what it could not read back, and writes nothing', () => {
  const store = createDailyStore({ filePath: file() });
  store.update({ enabled: true, time: '08:30' });
  const before = readFileSync(file(), 'utf8');
  expect(() => store.update({ time: '24:00' })).toThrow();
  expect(() => store.update({ time: '25:99' })).toThrow();
  expect(() => store.update({ lastNotifiedDay: 'soon' })).toThrow();
  expect(() => store.update({ pick: { day: '2026-11-04', category: 'poetry', challengeId: null } as never })).toThrow();
  expect(readFileSync(file(), 'utf8')).toBe(before);
  expect(store.get()).toEqual({ ...DEFAULTS, enabled: true, time: '08:30' });
  expect(readdirSync(dir)).toEqual(['daily.json']);
});

test('no temp file is left behind', () => {
  const store = createDailyStore({ filePath: file() });
  for (let i = 0; i < 5; i++) store.update({ time: `0${i}:15`, enabled: i % 2 === 0 });
  store.update({ pick: PICK });
  expect(readdirSync(dir)).toEqual(['daily.json']);
  // The file is plain JSON, written whole.
  expect(JSON.parse(readFileSync(file(), 'utf8'))).toEqual({ enabled: true, time: '04:15', lastNotifiedDay: null, pick: PICK });
});

test('a write that fails throws and leaves no temp file behind', () => {
  // The folder is gone: the temp file cannot be created at all.
  const gone = createDailyStore({ filePath: join(dir, 'missing', 'daily.json') });
  expect(() => gone.update({ enabled: true })).toThrow();
  expect(readdirSync(dir)).toEqual([]);

  // The temp file is written but cannot take the real file's place (here a folder is in the way): it is removed again.
  mkdirSync(file());
  const blocked = createDailyStore({ filePath: file() });
  expect(() => blocked.update({ enabled: true })).toThrow();
  expect(readdirSync(dir)).toEqual(['daily.json']);
  // Reading still works and gives the defaults.
  expect(blocked.get()).toEqual(DEFAULTS);
});
