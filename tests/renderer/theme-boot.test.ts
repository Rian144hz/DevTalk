import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { rememberedTheme, resolveTheme, type KeyValueStore } from '../../src/renderer/lib/theme';

// public/theme-boot.js is a blocking script in <head>: it sets the theme before the first paint, which the bundle
// (a deferred module) cannot promise. It must pick what lib/theme.ts picks.
const SCRIPT = readFileSync(join(__dirname, '../../src/renderer/public/theme-boot.js'), 'utf8');

function boot(stored: string | null | 'throws', prefersLight: boolean): string | undefined {
  const dataset: Record<string, string> = {};
  const localStorage = {
    getItem: () => {
      if (stored === 'throws') throw new Error('denied');
      return stored;
    },
  };
  const window = { matchMedia: (q: string) => ({ matches: q === '(prefers-color-scheme: light)' && prefersLight }) };
  runInNewContext(SCRIPT, { window, localStorage, document: { documentElement: { dataset } } });
  return dataset['theme'];
}

test('the boot script picks the same theme as the app for every stored value and system preference', () => {
  for (const stored of [null, 'dark', 'light', 'system', 'sepia', ''] as const) {
    for (const prefersLight of [true, false]) {
      const store: KeyValueStore = { get: () => stored, set: () => undefined };
      const expected = resolveTheme(rememberedTheme(store) ?? 'system', prefersLight);
      expect(boot(stored, prefersLight), `${String(stored)} / light=${prefersLight}`).toBe(expected);
    }
  }
});

test('with unreadable storage the boot script follows the system', () => {
  expect(boot('throws', true)).toBe('light');
  expect(boot('throws', false)).toBe('dark');
});
