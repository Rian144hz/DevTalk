// The splash's lockup: the pencil duck and the name, laid out like the official horizontal lockup
// (docs/design/logo/kit/devtalk-horizontal.svg). Splash.tsx reads these values; tests/renderer/lockup.test.ts checks them.
//
// Lengths are SVG units. The name is set at 100 (Public Sans 700), the origin of its first letter is x = 0 and its
// baseline is y = 0. The official lockup is drawn with a cap height of 74 and its distances are scaled to the name's.

/** Public Sans's cap height at a size of 100: 1446 of its 2000 units per em. */
export const CAP_HEIGHT = 72.3;
const scaled = (lockupUnits: number) => (lockupUnits * CAP_HEIGHT) / 74;

/** The duck's square 256-unit box: 2.38 times the cap height (176 against 74 in the lockup). */
export const DUCK_SIZE = scaled(176);
/** From the bill tip to the first letter's origin: 0.46 times the cap height (34 against 74). */
export const TIP_GAP = scaled(34);
/** The duck's box sits this far above the middle of the capitals, so its drawing is about 4 % of its height above it. */
const LIFT = scaled(4);

/** What the duck draws inside its 256-unit box: the hull's leftmost point, the head's top, the lead's tip, the hull's bottom. */
export const DUCK_DRAWN = { left: 16.24, top: 32, right: 241, bottom: 220 } as const;

/** The bill tip, the point the name is written from. */
export const TIP_X = -TIP_GAP;
/** The top left corner of the duck's box. */
export const DUCK_X = TIP_X - (DUCK_SIZE * DUCK_DRAWN.right) / 256;
export const DUCK_Y = -CAP_HEIGHT / 2 - LIFT - DUCK_SIZE / 2;

/** Where the ink of the last letter ends: "devTalk" (the name being written) and "DevTalk" (the still), measured in the app. */
export const INK_RIGHT = { written: 369.78, still: 380.93 } as const;

const VIEW_WIDTH = 580;
/** Tall enough for the correction above the name (its "D" wash reaches up to y = -146) and the duck below the baseline. */
const VIEW_HEIGHT = 230;

const n = (value: number) => String(Number(value.toFixed(2)));
/** A view that centres the drawn lockup (from the duck's hull to the last letter) across, and the capitals' middle down. */
function view(inkRight: number): string {
  const inkLeft = DUCK_X + (DUCK_SIZE * DUCK_DRAWN.left) / 256;
  return [(inkLeft + inkRight) / 2 - VIEW_WIDTH / 2, -CAP_HEIGHT / 2 - VIEW_HEIGHT / 2, VIEW_WIDTH, VIEW_HEIGHT].map(n).join(' ');
}

/** The splash's viewBox while the name is written and marked, and for the still (reduced motion). */
export const VIEW = view(INK_RIGHT.written);
export const VIEW_PLAIN = view(INK_RIGHT.still);
