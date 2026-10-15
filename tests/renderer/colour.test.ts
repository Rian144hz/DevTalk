import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contrast, ensureContrast } from '../../src/renderer/lib/colour';
import { STACK_ICONS } from '../../src/renderer/lib/stack-icons.generated';
import { languageColour, THEME_GROUNDS } from '../../src/renderer/lib/stack-icons';

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

test('contrast follows WCAG', () => {
  expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  expect(contrast('#16181d', '#16181d')).toBe(1);
  expect(contrast('#ffffff', '#000000')).toBe(contrast('#000000', '#ffffff'));
});

test('a colour too dark for the dark ground is lightened just enough', () => {
  const out = ensureContrast('#00599C', '#16181d');
  expect(out).not.toBe('#00599C');
  expect(contrast(out, '#16181d')).toBeGreaterThanOrEqual(3);
  expect(contrast(out, '#16181d')).toBeLessThan(3.25);
  const [r, g, b] = rgb(out);
  expect(b).toBeGreaterThan(g);
  expect(g).toBeGreaterThan(r);
});

test('a colour too light for the light ground is darkened; a good one is kept', () => {
  const out = ensureContrast('#F7DF1E', '#eef0f3');
  expect(contrast(out, '#eef0f3')).toBeGreaterThanOrEqual(3);
  expect(rgb(out)[0]).toBeLessThan(0xf7);
  expect(ensureContrast('#ED8B00', '#16181d')).toBe('#ED8B00');
});

test('every curated language colour reads at 3:1 on both grounds of both themes', () => {
  for (const slug of Object.keys(STACK_ICONS)) {
    for (const theme of ['dark', 'light'] as const) {
      const c = languageColour(slug, theme);
      for (const ground of THEME_GROUNDS[theme]) expect(contrast(c, ground), `${slug} ${theme} on ${ground}`).toBeGreaterThanOrEqual(3);
    }
  }
});

test('Java is orange, black logos and unknown tags are neutral', () => {
  expect(languageColour('java', 'dark')).toBe('#ED8B00');
  const [r, g, b] = rgb(languageColour('Java', 'light'));
  expect(r).toBeGreaterThan(g);
  expect(g).toBeGreaterThan(b);
  expect(languageColour('python', 'light')).toBe('#3776AB');
  expect(languageColour('Next.js', 'dark')).toBe(languageColour('my-company-lib', 'dark'));
  expect(languageColour('my-company-lib', 'light')).toBe(languageColour('express', 'light'));
});

test('badge tokens reach 3:1 on both grounds of both themes', () => {
  const css = readFileSync(join(__dirname, '../../src/renderer/design-system/tokens.css'), 'utf8');
  const light = css.slice(css.indexOf(':root[data-theme="light"]'));
  const dark = css.slice(0, css.indexOf(':root[data-theme="light"]'));
  for (const [theme, block] of [['dark', dark], ['light', light]] as const) {
    for (const token of ['--badge-community', '--badge-evolution']) {
      const hex = new RegExp(`${token}: (#[0-9a-f]{6})`).exec(block)![1]!;
      for (const ground of THEME_GROUNDS[theme]) expect(contrast(hex, ground), `${token} ${theme}`).toBeGreaterThanOrEqual(3);
    }
  }
});
