import { isSkipKey, splashTiming } from '../../src/renderer/lib/splash';

test('the splash shows for 1.5 s, then fades for 0.25 s', () => {
  expect(splashTiming(false)).toEqual({ showMs: 1500, fadeMs: 250 });
});

test('with reduced motion the still name shows for 0.3 s and does not fade', () => {
  expect(splashTiming(true)).toEqual({ showMs: 300, fadeMs: 0 });
});

test('Enter, Space and Escape skip the splash; other keys do not', () => {
  for (const key of ['Enter', ' ', 'Escape']) expect(isSkipKey(key)).toBe(true);
  for (const key of ['a', 'Tab', 'Shift', 'Control', 'ArrowDown', 'Backspace', 'k']) expect(isSkipKey(key)).toBe(false);
});
