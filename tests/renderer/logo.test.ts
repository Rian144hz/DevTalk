// The logo in the app is a copy of the kit (docs/design/logo/kit): these tests fail when a copy drifts from its source.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DUCK_PARTS } from '../../src/renderer/design-system/duck';

const ROOT = join(__dirname, '../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** The paths of a kit symbol in paint order: `{ id, d, evenodd }`. */
function kitPaths(file: string) {
  const svg = read(`docs/design/logo/kit/${file}`);
  return [...svg.matchAll(/<path id="(\w+)"([^>]*?)\sd="([^"]+)"/g)].map((m) => ({
    id: m[1]!,
    d: m[3]!,
    evenodd: /fill-rule="evenodd"/.test(m[2]!),
  }));
}

describe('the DuckMark drawing is the kit symbol, path for path and in the same paint order', () => {
  test('full: bill, lead, hull and head', () => {
    const drawn = DUCK_PARTS.full.map((p) => ({ id: p.part, d: p.d, evenodd: p.evenodd === true }));
    expect(drawn.map((p) => p.id)).toEqual(['bill', 'lead', 'hull', 'head']);
    expect(drawn).toEqual(kitPaths('devtalk-symbol.svg'));
  });

  test('small: a solid bill, the hull and a head with the bigger eye, and no lead', () => {
    const drawn = DUCK_PARTS.small.map((p) => ({ id: p.part, d: p.d, evenodd: p.evenodd === true }));
    expect(drawn.map((p) => p.id)).toEqual(['bill', 'hull', 'head']);
    expect(drawn).toEqual(kitPaths('devtalk-symbol-small.svg'));
  });

  test('the head is the one path with the eye cut out (evenodd)', () => {
    for (const variant of ['full', 'small'] as const) {
      expect(DUCK_PARTS[variant].filter((p) => p.evenodd).map((p) => p.part)).toEqual(['head']);
    }
  });
});
