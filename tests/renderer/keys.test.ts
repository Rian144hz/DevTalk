import { isInDialog, isTextEntry, isTypingTarget } from '../../src/renderer/lib/keys';

/** A stand-in element whose closest() matches the listed selectors. */
const el = (matches: string[]) =>
  ({ closest: (sel: string) => (sel.split(',').some((s) => matches.includes(s.trim())) ? {} : null) }) as unknown as EventTarget;

test('anything inside an open dialog is guarded by every helper', () => {
  const inPalette = el(['dialog[open]']);
  expect(isInDialog(inPalette)).toBe(true);
  expect(isTextEntry(inPalette)).toBe(true);
  expect(isTypingTarget(inPalette)).toBe(true);
});

test('text fields are text entry; buttons are only typing targets', () => {
  expect(isTextEntry(el(['textarea']))).toBe(true);
  expect(isTextEntry(el(['button']))).toBe(false);
  expect(isTypingTarget(el(['button']))).toBe(true);
});

test('plain targets and null are not guarded', () => {
  expect(isTypingTarget(el([]))).toBe(false);
  expect(isInDialog(null)).toBe(false);
});
