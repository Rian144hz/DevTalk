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

// --- Sky-blue palette (spec §4): every text pair passes AA on every ground of both themes ---

const tokensCss = readFileSync(join(__dirname, '../../src/renderer/design-system/tokens.css'), 'utf8');
const lightStart = tokensCss.indexOf(':root[data-theme="light"]');
const THEME_BLOCKS = {
  dark: tokensCss.slice(0, lightStart),
  light: tokensCss.slice(lightStart, tokensCss.indexOf('}', lightStart)),
} as const;

/** The raw value of a custom property declared in one theme block, or null. */
const declared = (block: string, token: string): string | null =>
  new RegExp(`(?:^|[\\s;{])${token}:\\s*([^;]+);`).exec(block)?.[1]?.trim() ?? null;

type Channels = [number, number, number];
/** A token as 8-bit channels plus alpha; reads `#rrggbb` and `rgb(r g b / a)`. */
function colourOf(block: string, token: string): { rgb: Channels; alpha: number } {
  const raw = declared(block, token);
  if (raw === null) throw new Error(`${token} is not declared`);
  const alias = /^var\((--[\w-]+)\)$/.exec(raw);
  if (alias) return colourOf(block, alias[1]!);
  if (/^#[0-9a-f]{6}$/i.test(raw)) return { rgb: rgb(raw), alpha: 1 };
  const m = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+)\s*)?\)$/.exec(raw);
  if (!m) throw new Error(`${token}: cannot read "${raw}"`);
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: m[4] === undefined ? 1 : Number(m[4]) };
}
const hexOf = (c: Channels) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
/** The token's hex; a translucent token is blended over `over` (a hex) first, the way the browser paints it. */
function solid(block: string, token: string, over?: string): string {
  const { rgb: c, alpha } = colourOf(block, token);
  if (alpha === 1) return hexOf(c);
  if (!over) throw new Error(`${token} is translucent: say what it sits on`);
  const under = rgb(over);
  return hexOf(c.map((v, i) => v * alpha + under[i]! * (1 - alpha)) as Channels);
}

describe.each(['dark', 'light'] as const)('sky-blue tokens, %s theme', (theme) => {
  const block = THEME_BLOCKS[theme];
  const at = (token: string, over?: string) => solid(block, token, over);
  const pass = (fg: string, bg: string, min: number, label: string) =>
    expect(contrast(fg, bg), `${label} (${fg} on ${bg})`).toBeGreaterThanOrEqual(min);

  test('the button pair exists, the old pencil ink is gone', () => {
    for (const token of ['--accent', '--accent-hover', '--on-accent']) expect(declared(block, token), token).not.toBeNull();
    expect(tokensCss).not.toContain('--pencil-ink');
  });

  test('text tokens pass AA on every ground', () => {
    for (const ink of ['--ink', '--ink-2', '--ink-3']) {
      for (const ground of ['--bg', '--bg-rail', '--sheet', '--sheet-hover']) pass(at(ink), at(ground), 4.5, `${ink} on ${ground}`);
    }
    for (const ground of ['--bg', '--sheet']) pass(at('--pencil'), at(ground), 4.5, `--pencil on ${ground}`);
    for (const fill of ['--accent', '--accent-hover']) pass(at('--on-accent'), at(fill), 4.5, `--on-accent on ${fill}`);
    const sheet = at('--sheet');
    pass(at('--del'), at('--del-wash', sheet), 4.5, '--del on its wash');
    pass(at('--ins'), at('--ins-wash', sheet), 4.5, '--ins on its wash');
    pass(at('--warn'), sheet, 4.5, '--warn on --sheet');
  });

  test('the focus ring reads at 3:1 on the grounds', () => {
    for (const ground of ['--bg', '--sheet']) pass(at('--focus'), at(ground), 3, `--focus on ${ground}`);
  });

  test('the warning notice, its line and the scrim are tokens; the warning text reads on its wash', () => {
    for (const token of ['--warn-line', '--warn-wash', '--scrim']) expect(declared(block, token), token).not.toBeNull();
    pass(at('--warn'), at('--warn-wash', at('--sheet')), 4.5, '--warn on --warn-wash');
  });

  test('ink reads on the sky wash that marks a selected row, on the grounds it sits on', () => {
    for (const ground of ['--bg', '--bg-rail', '--sheet']) pass(at('--ink'), at('--pencil-wash', at(ground)), 4.5, `--ink on --pencil-wash over ${ground}`);
  });

  test('the badge grounds and neutral in stack-icons.ts mirror --bg, --sheet and --ink-2', () => {
    expect(THEME_GROUNDS[theme].map((g) => g.toLowerCase())).toEqual([at('--bg'), at('--sheet')]);
    expect(languageColour('my-company-lib', theme).toLowerCase()).toBe(at('--ink-2'));
  });
});
