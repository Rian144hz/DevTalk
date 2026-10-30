// The pencil duck's drawing, in the 256-unit box of the logo kit (docs/design/logo/kit). The path data is copied from
// the kit's symbols, and tests/renderer/logo.test.ts fails when it drifts. Paint order: the bill first, then the lead,
// the hull and the head, so the bill grows out of the head's curve. The head has the eye cut out (even-odd fill).

export type DuckVariant = 'full' | 'small';
export type DuckPartName = 'bill' | 'lead' | 'hull' | 'head';

export interface DuckPart {
  part: DuckPartName;
  d: string;
  /** Fill the path even-odd: the eye is a hole in the head. */
  evenodd?: true;
}

/**
 * `full` (devtalk-symbol.svg): the pencil's wood and a separate graphite lead, for 48 px and up.
 * `small` (devtalk-symbol-small.svg): one solid bill, a bigger eye and no separate lead, for 16 to 40 px.
 */
export const DUCK_PARTS: Record<DuckVariant, readonly DuckPart[]> = {
  full: [
    { part: 'bill', d: 'M177 72 L217 88.25 L217 107.75 L177 124 Z' },
    { part: 'lead', d: 'M223 90.69 L241 98 L223 105.31 Z' },
    { part: 'hull', d: 'M21 102 C43 122 77 130 113 128 L161 128 C205 130 225 156 225 180 C225 204 199 220 161 220 L81 220 C41 220 19 200 17 170 C16 144 15 120 21 102 Z' },
    { part: 'head', d: 'M83 86 A54 54 0 1 1 191 86 A54 54 0 1 1 83 86 Z M141.5 74 A9.5 9.5 0 1 0 160.5 74 A9.5 9.5 0 1 0 141.5 74 Z', evenodd: true },
  ],
  small: [
    { part: 'bill', d: 'M177 72 L241 98 L177 124 Z' },
    { part: 'hull', d: 'M21 102 C43 122 77 130 113 128 L161 128 C205 130 225 156 225 180 C225 204 199 220 161 220 L81 220 C41 220 19 200 17 170 C16 144 15 120 21 102 Z' },
    { part: 'head', d: 'M83 86 A54 54 0 1 1 191 86 A54 54 0 1 1 83 86 Z M137 74 A12 12 0 1 0 161 74 A12 12 0 1 0 137 74 Z', evenodd: true },
  ],
};
