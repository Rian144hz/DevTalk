import { resolveTheme } from '../../src/renderer/lib/theme';

test('explicit settings win; system follows the OS', () => {
  expect(resolveTheme('dark', true)).toBe('dark');
  expect(resolveTheme('light', false)).toBe('light');
  expect(resolveTheme('system', true)).toBe('light');
  expect(resolveTheme('system', false)).toBe('dark');
});
