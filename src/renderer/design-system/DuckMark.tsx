import type { SVGProps } from 'react';
import { DUCK_PARTS, type DuckVariant } from './duck';

export interface DuckMarkProps extends Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'width' | 'height' | 'children'> {
  /** `full` for 48 px and up; `small` (a solid bill, a bigger eye, no separate lead) for 16 to 40 px. */
  variant?: DuckVariant;
  /** Width and height in px: the mark sits in a square 256-unit box, and the drawing fills about 88 % of it. */
  size?: number;
}

/**
 * The pencil duck, DevTalk's mark (docs/design/logo/guidelines.md). It is decoration beside the name "DevTalk", so it
 * is hidden from assistive technology. The fills come from the `--logo-*` tokens through classes (`var()` does not
 * work in an SVG fill attribute), so the duck follows the theme. Never mirror, rotate or recolour it. Inside another
 * `<svg>`, pass `x` and `y` to place it.
 */
export function DuckMark({ variant = 'full', size = 24, className, ...rest }: DuckMarkProps) {
  return (
    <svg {...rest} className={className ? `duck-mark ${className}` : 'duck-mark'} viewBox="0 0 256 256" width={size} height={size} aria-hidden="true" focusable="false">
      {DUCK_PARTS[variant].map(({ part, d, evenodd }) => (
        <path key={part} className={`duck-${part}`} d={d} fillRule={evenodd ? 'evenodd' : undefined} />
      ))}
    </svg>
  );
}
