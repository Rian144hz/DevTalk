import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    projects: [
      { test: { name: 'core', globals: true, environment: 'node', include: ['tests/core/**/*.test.ts'] } },
      { test: { name: 'renderer', globals: true, environment: 'node', include: ['tests/renderer/**/*.test.ts'] } },
      // Runs under Electron's Node (ELECTRON_RUN_AS_NODE) so better-sqlite3 loads with Electron's ABI.
      { test: { name: 'main', globals: true, environment: 'node', pool: 'forks', include: ['tests/main/**/*.test.ts'] } },
    ],
  },
});
