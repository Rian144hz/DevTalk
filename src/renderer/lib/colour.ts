// WCAG contrast for the few colours that come from outside the token set (brand colours on language badges).

type Rgb = [number, number, number];

const toRgb = (hex: string): Rgb => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
};
const toHex = (c: Rgb) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two #RRGGBB colours (1–21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(toRgb(a)), luminance(toRgb(b))].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * `hex` unchanged when it already reaches `min` against `against`; otherwise mixed towards white (dark ground) or
 * black (light ground) in 1% steps, stopping at the first mix that reaches it, so the hue changes as little as possible.
 */
export function ensureContrast(hex: string, against: string, min = 3): string {
  if (contrast(hex, against) >= min) return hex;
  const from = toRgb(hex);
  const target = luminance(toRgb(against)) < 0.18 ? 255 : 0;
  for (let step = 1; step <= 100; step++) {
    const t = step / 100;
    const mixed = toHex(from.map((v) => v + (target - v) * t) as Rgb);
    if (contrast(mixed, against) >= min) return mixed;
  }
  return target === 255 ? '#FFFFFF' : '#000000';
}
