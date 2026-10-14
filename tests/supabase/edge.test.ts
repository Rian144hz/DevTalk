import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildEdgeFunction } from '../../scripts/build-edge.mjs';

const root = join(__dirname, '..', '..');
const SINGLE = join(root, 'supabase', 'functions', 'delete-account', 'single-file.ts');

test('the single-file function is up to date (run npm run build:edge)', () => {
  expect(readFileSync(SINGLE, 'utf8')).toBe(buildEdgeFunction(root));
});

test('the single-file function inlines the handler and keeps the Deno entry', () => {
  const src = buildEdgeFunction(root);
  expect(src).not.toContain("from './handler.ts'");
  expect(src).toContain('async function handle(');
  expect(src).toContain('Deno.serve(');
  expect(src.indexOf("import { createClient }")).toBeLessThan(src.indexOf('async function handle('));
  expect(src).not.toMatch(/^export /m);
});
