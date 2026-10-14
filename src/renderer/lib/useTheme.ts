import { useEffect } from 'react';
import { resolveTheme, type ThemeSetting } from './theme';

/** Applies the theme to <html>, following the OS live when the setting is 'system'. */
export function useThemeEffect(setting: ThemeSetting): void {
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      document.documentElement.dataset['theme'] = resolveTheme(setting, query.matches);
    };
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [setting]);
}
