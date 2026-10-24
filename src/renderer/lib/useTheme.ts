import { useEffect } from 'react';
import { rememberedTheme, rememberTheme, resolveTheme, type KeyValueStore, type ThemeSetting } from './theme';

const LIGHT = '(prefers-color-scheme: light)';
const browserStore: KeyValueStore = {
  get: (k) => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
};

/** The setting to use while the profile is unknown or absent: the last run's, else the system's. */
export const startTheme = (): ThemeSetting => rememberedTheme(browserStore) ?? 'system';

/** Sets the theme on <html> before the first frame, so the splash opens on the right ground. */
export function applyStartTheme(): void {
  document.documentElement.dataset['theme'] = resolveTheme(startTheme(), window.matchMedia(LIGHT).matches);
}

/**
 * Applies the theme to <html>, following the OS live when the setting is 'system'.
 * `remember` keeps a profile's setting for the next start.
 */
export function useThemeEffect(setting: ThemeSetting, remember = false): void {
  useEffect(() => {
    if (remember) rememberTheme(setting, browserStore);
    const query = window.matchMedia(LIGHT);
    const apply = () => {
      document.documentElement.dataset['theme'] = resolveTheme(setting, query.matches);
    };
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [setting, remember]);
}
