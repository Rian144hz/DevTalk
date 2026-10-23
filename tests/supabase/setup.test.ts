import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { buildSetupSql } from '../../scripts/build-setup-sql.mjs';

const root = join(__dirname, '..', '..');

test('supabase/setup.sql is up to date with the migrations (run npm run build:setup-sql)', () => {
  expect(readFileSync(join(root, 'supabase', 'setup.sql'), 'utf8')).toBe(buildSetupSql(root));
});

test('setup.sql runs as one script on a fresh project', async () => {
  const db = await PGlite.create();
  await db.exec(readFileSync(join(__dirname, 'stubs.sql'), 'utf8'));
  await db.exec(buildSetupSql(root));
  const r = await db.query<{ n: number }>(
    `select count(*)::int as n from pg_tables where schemaname = 'public' and rowsecurity`,
  );
  expect(r.rows[0]!.n).toBe(23);
});
