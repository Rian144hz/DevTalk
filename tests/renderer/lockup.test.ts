// The splash's lockup follows the official horizontal lockup (docs/design/logo/kit/devtalk-horizontal.svg): the duck's size,
// the bill tip's distance to the first letter and the duck's height against the capitals, and both views centre the
// finished lockup. Lengths are SVG units, with the name set at 100 and its baseline at y = 0.
import {
  CAP_HEIGHT, DUCK_DRAWN, DUCK_SIZE, DUCK_X, DUCK_Y, INK_RIGHT, TIP_GAP, TIP_X, VIEW, VIEW_PLAIN,
} from '../../src/renderer/lib/lockup';

const box = (view: string) => {
  const [x, y, w, h] = view.split(' ').map(Number) as [number, number, number, number];
  return { x, y, w, h };
};
const drawn = (() => {
  const k = DUCK_SIZE / 256;
  return {
    left: DUCK_X + DUCK_DRAWN.left * k,
    right: DUCK_X + DUCK_DRAWN.right * k,
    top: DUCK_Y + DUCK_DRAWN.top * k,
    bottom: DUCK_Y + DUCK_DRAWN.bottom * k,
  };
})();

test('the duck is about 2.38 times the cap height', () => {
  expect(DUCK_SIZE / CAP_HEIGHT).toBeCloseTo(2.38, 1);
});

test('the bill tip is about 0.46 cap heights before the first letter, and the box ends 15 of 256 units after the tip', () => {
  expect(TIP_GAP / CAP_HEIGHT).toBeCloseTo(0.46, 2);
  expect(TIP_X).toBeCloseTo(-TIP_GAP, 6);
  expect(drawn.right).toBeCloseTo(TIP_X, 6);
});

test('the duck sits about 4 % of its height above the middle of the capitals', () => {
  const duckMiddle = (drawn.top + drawn.bottom) / 2;
  const capMiddle = -CAP_HEIGHT / 2;
  expect((capMiddle - duckMiddle) / (drawn.bottom - drawn.top)).toBeCloseTo(0.04, 2);
});

test('the duck\'s head rises above the capitals and its hull dips a little below the baseline', () => {
  expect(drawn.top).toBeLessThan(-CAP_HEIGHT);
  expect(drawn.bottom).toBeGreaterThan(0);
  expect(drawn.bottom).toBeLessThan(CAP_HEIGHT / 2);
});

describe.each([['the written name', VIEW, INK_RIGHT.written], ['the still name', VIEW_PLAIN, INK_RIGHT.still]] as const)('the view of %s', (_label, view, inkRight) => {
  const v = box(view);

  test('centres the drawn lockup, from the duck to the last letter, across the splash', () => {
    const left = drawn.left - v.x;
    const right = v.x + v.w - inkRight;
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    expect(Math.abs(left - right)).toBeLessThan(0.5);
  });

  test('centres the capitals down the splash and keeps the correction above the name inside', () => {
    expect(v.y + v.h / 2).toBeCloseTo(-CAP_HEIGHT / 2, 0);
    // The correction's "D" wash reaches up to y = -146.
    expect(v.y).toBeLessThanOrEqual(-146);
  });
});

test('both views have the same size, so one width fits the splash', () => {
  expect(box(VIEW).w).toBe(box(VIEW_PLAIN).w);
  expect(box(VIEW).h).toBe(box(VIEW_PLAIN).h);
});
