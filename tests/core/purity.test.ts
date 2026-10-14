import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CORE = join(__dirname, '../../src/core');
const ALLOWED = new Set(['zod', 'ts-fsrs']);

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return tsFiles(p);
    return e.name.endsWith('.ts') ? [p] : [];
  });
}

function importSpecifiers(source: string): string[] {
  const re = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm;
  return [...source.matchAll(re)].map((m) => (m[1] ?? m[2] ?? m[3])!);
}

test('core imports nothing outside zod, ts-fsrs and itself', () => {
  const offenders: string[] = [];
  for (const file of tsFiles(CORE)) {
    for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('.') && !ALLOWED.has(spec)) offenders.push(`${file}: ${spec}`);
    }
  }
  expect(offenders).toEqual([]);
});

test('the import scanner catches a forbidden import', () => {
  expect(importSpecifiers("import { app } from 'electron';\nimport x from './y';")).toEqual(['electron', './y']);
});
