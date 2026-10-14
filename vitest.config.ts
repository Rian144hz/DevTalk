import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    projects: [
      { test: { name: 'core', globals: true, environment: 'node', include: ['tests/core/**/*.test.ts'] } },
      { test: { name: 'renderer', globals: true, environment: 'node', include: ['tests/renderer/**/*.test.ts'] } },
      // RLS and schema tests: the Supabase migrations applied to an in-memory Postgres (PGlite).
      { test: { name: 'supabase', globals: true, environment: 'node', include: ['tests/supabase/**/*.test.ts'], testTimeout: 20_000 } },
      // Runs under Electron's Node (ELECTRON_RUN_AS_NODE) so better-sqlite3 loads with Electron's ABI.
      { test: { name: 'main', globals: true, environment: 'node', pool: 'forks', include: ['tests/main/**/*.test.ts'] } },
    ],
  },
});
