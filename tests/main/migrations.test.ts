import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS } from '../../src/main/db/migrations';
import { DatabaseTooNewError, openDatabase } from '../../src/main/db/open';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'devtalk-db-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test('migrations set user_version and are idempotent', () => {
  const file = join(dir, 'a.sqlite');
  openDatabase(file).close();
  const db = openDatabase(file);
  expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
  expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
  db.close();
});

test('refuses a database from a newer app version', () => {
  const file = join(dir, 'b.sqlite');
  const raw = new Database(file);
  raw.pragma(`user_version = ${MIGRATIONS.length + 1}`);
  raw.close();
  expect(() => openDatabase(file)).toThrow(DatabaseTooNewError);
});

test('corrections.category rejects values outside the fixed list', () => {
  const db = openDatabase(':memory:');
  db.prepare("INSERT INTO attempts (challenge_id, text, source, created_at) VALUES (NULL, 't', 'typed', '2026-10-13T00:00:00.000Z')").run();
  db.prepare("INSERT INTO feedbacks (attempt_id, natural_rewrite, provider, model, latency_ms, raw_json, created_at) VALUES (1, 'r', 'p', 'm', 1, '{}', '2026-10-13T00:00:00.000Z')").run();
  expect(() =>
    db.prepare("INSERT INTO corrections (feedback_id, position, original, corrected, explanation, category) VALUES (1, 0, 'a', 'b', 'x', 'spelling')").run(),
  ).toThrow(/CHECK constraint/);
});

test('attempts.source rejects unknown sources', () => {
  const db = openDatabase(':memory:');
  expect(() =>
    db.prepare("INSERT INTO attempts (challenge_id, text, source, created_at) VALUES (NULL, 't', 'email', '2026-10-13T00:00:00.000Z')").run(),
  ).toThrow(/CHECK constraint/);
});
