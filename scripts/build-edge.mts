// Joins the delete-account function into one file for the Supabase dashboard editor
// (Edge Functions › Deploy a new function › Via editor). Run: npm run build:edge
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEADER = `// DevTalk — delete-account Edge Function, as one file for the Supabase dashboard editor.
// Generated from supabase/functions/delete-account by \`npm run build:edge\`. Do not edit by hand.
`;

export function buildEdgeFunction(root: string): string {
  const dir = join(root, 'supabase', 'functions', 'delete-account');
  const handler = readFileSync(join(dir, 'handler.ts'), 'utf8')
    .replace(/^\/\/.*\n/gm, '')
    .replace(/^export /gm, '')
    .trim();
  const index = readFileSync(join(dir, 'index.ts'), 'utf8').replace(/^\/\/.*\n/gm, '');
  const lines = index.split('\n');
  const imports = lines.filter((l) => l.startsWith('import ') && !l.includes("'./handler.ts'"));
  const body = lines.filter((l) => !l.startsWith('import ')).join('\n').trim();
  return `${HEADER}\n${imports.join('\n')}\n\n${handler}\n\n${body}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
  writeFileSync(join(root, 'supabase', 'functions', 'delete-account', 'single-file.ts'), buildEdgeFunction(root));
  console.log('Wrote supabase/functions/delete-account/single-file.ts');
}
