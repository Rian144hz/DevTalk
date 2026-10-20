import { applyCorrections, wordDiff } from '../../src/core/social/diff';

const show = (parts: { kind: string; text: string }[]) => parts.map((p) => (p.kind === 'same' ? p.text : `[${p.kind}:${p.text}]`)).join('');

test('wordDiff marks removed and added words and keeps the rest', () => {
  expect(show(wordDiff('Yesterday I have a meeting.', 'Yesterday I had a meeting.'))).toBe('Yesterday I [del:have][ins:had] a meeting.');
  expect(show(wordDiff('I agree', 'I agree'))).toBe('I agree');
  expect(show(wordDiff('We discuss about it', 'We discuss it'))).toBe('We discuss [del:about ]it');
  expect(show(wordDiff('', 'Hello'))).toBe('[ins:Hello]');
});

test('wordDiff keeps newlines and odd text as text', () => {
  expect(show(wordDiff('a\nb <b>x</b>', 'a\nb <i>x</i>'))).toBe('a\nb [del:<b>x</b>][ins:<i>x</i>]');
  expect(wordDiff('Hi 👋', 'Hi 👋!').map((p) => p.kind)).toContain('ins');
});

test('wordDiff stays fast on the longest messages', () => {
  const a = 'word '.repeat(400).trim();
  const b = `${'word '.repeat(200)}change ${'word '.repeat(199)}`.trim();
  const t0 = Date.now();
  expect(wordDiff(a, b).some((p) => p.kind === 'ins')).toBe(true);
  expect(Date.now() - t0).toBeLessThan(500);
});

test('applyCorrections replaces each original once, in order; unknown ones are skipped', () => {
  const corrections = [
    { original: 'have fixed', corrected: 'fixed' },
    { original: 'discuss about', corrected: 'discuss' },
    { original: 'not in the text', corrected: 'x' },
  ];
  expect(applyCorrections('Yesterday I have fixed it. We discuss about it.', corrections)).toBe('Yesterday I fixed it. We discuss it.');
  expect(applyCorrections('Nothing to fix.', [])).toBe('Nothing to fix.');
});
