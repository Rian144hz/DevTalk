export type ThemeSetting = 'system' | 'dark' | 'light';

export function resolveTheme(setting: ThemeSetting, prefersLight: boolean): 'dark' | 'light' {
  if (setting === 'system') return prefersLight ? 'light' : 'dark';
  return setting;
}

/** Where the last run's theme setting is kept (localStorage in the app). */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const KEY = 'devtalk.theme';
const SETTINGS: readonly string[] = ['system', 'dark', 'light'] satisfies ThemeSetting[];

/** The theme setting of the last run, so the first frame (the splash) has the right ground before the profile loads. */
export function rememberedTheme(store: KeyValueStore): ThemeSetting | null {
  try {
    const value = store.get(KEY);
    return value !== null && SETTINGS.includes(value) ? (value as ThemeSetting) : null;
  } catch {
    return null;
  }
}

export function rememberTheme(setting: ThemeSetting, store: KeyValueStore): void {
  try {
    store.set(KEY, setting);
  } catch {
    // Storage can be unavailable; the next start then follows the system until the profile loads.
  }
}
