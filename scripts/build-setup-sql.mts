// Joins supabase/migrations/*.sql into supabase/setup.sql, the single script pasted in the
// Supabase SQL Editor. Run: npm run build:setup-sql
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEADER = `-- DevTalk — database setup for a new Supabase project.
-- Generated from supabase/migrations by \`npm run build:setup-sql\`. Do not edit by hand.
-- Paste the whole file in Supabase › SQL Editor › New query, then click Run. Run it once.
`;

export function buildSetupSql(root: string): string {
  const dir = join(root, 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const parts = files.map((f) => `-- ===== ${f} =====\n\n${readFileSync(join(dir, f), 'utf8').trimEnd()}\n`);
  return `${HEADER}\n${parts.join('\n')}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
  writeFileSync(join(root, 'supabase', 'setup.sql'), buildSetupSql(root));
  console.log('Wrote supabase/setup.sql');
}
