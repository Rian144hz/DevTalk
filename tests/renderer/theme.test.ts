import { rememberedTheme, rememberTheme, resolveTheme, type KeyValueStore } from '../../src/renderer/lib/theme';

test('explicit settings win; system follows the OS', () => {
  expect(resolveTheme('dark', true)).toBe('dark');
  expect(resolveTheme('light', false)).toBe('light');
  expect(resolveTheme('system', true)).toBe('light');
  expect(resolveTheme('system', false)).toBe('dark');
});

function store(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) };
}

test('the theme of the last run is remembered for the next start', () => {
  const s = store();
  expect(rememberedTheme(s)).toBeNull();
  rememberTheme('light', s);
  expect(rememberedTheme(s)).toBe('light');
  rememberTheme('system', s);
  expect(rememberedTheme(s)).toBe('system');
});

test('an unknown stored value counts as nothing remembered', () => {
  expect(rememberedTheme(store({ 'devtalk.theme': 'sepia' }))).toBeNull();
});

test('storage that throws counts as nothing remembered', () => {
  const broken: KeyValueStore = { get: () => { throw new Error('denied'); }, set: () => { throw new Error('denied'); } };
  expect(rememberedTheme(broken)).toBeNull();
  expect(() => rememberTheme('dark', broken)).not.toThrow();
});
