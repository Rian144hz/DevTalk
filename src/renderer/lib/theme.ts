export type ThemeSetting = 'system' | 'dark' | 'light';

export function resolveTheme(setting: ThemeSetting, prefersLight: boolean): 'dark' | 'light' {
  if (setting === 'system') return prefersLight ? 'light' : 'dark';
  return setting;
}
