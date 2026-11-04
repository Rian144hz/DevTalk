import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { DuckMark } from '../design-system';
import { DUCK_SIZE, DUCK_X, DUCK_Y, TIP_X, VIEW, VIEW_PLAIN } from '../lib/lockup';
import { isSkipKey, splashTiming } from '../lib/splash';

const REDUCE = '(prefers-reduced-motion: reduce)';

// SVG units, as in lib/lockup.ts: the name is set at 100 (Public Sans 700) with the origin of its first letter at x = 0
// and its baseline at y = 0. The correction's marks stand over the first letter, a "d" whose ink is centred at 29
// ("d" is 60.85 wide, its ink spans 3.8 to 54.6).
const FIX_X = 29;

/** The duck at the left of the name, where it is in the official lockup. */
function Duck() {
  return (
    <g className="splash-duck">
      <DuckMark variant="full" size={DUCK_SIZE} x={DUCK_X} y={DUCK_Y} />
    </g>
  );
}

/**
 * The launch splash, over everything on the theme ground: the duck slides in, writes "devTalk" from its pencil bill,
 * then the name is marked the way the coach marks a proof (the "d" struck in rose, "D" written above in sage); it holds
 * and fades. Reduced motion shows the still lockup, the duck and "DevTalk". A click, Enter, Space or Escape ends it at
 * once; `onDone` runs when it is over either way.
 */
export function Splash({ onDone }: { onDone(): void }) {
  const [reduced] = useState(() => window.matchMedia(REDUCE).matches);
  const { showMs, fadeMs } = splashTiming(reduced);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const finish = () => done.current();
    const timer = window.setTimeout(finish, showMs + fadeMs);
    const onKey = (e: KeyboardEvent) => {
      if (!isSkipKey(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      finish();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [showMs, fadeMs]);

  const timing = { '--splash-show': `${showMs}ms`, '--splash-fade': `${fadeMs}ms` } as CSSProperties;
  return (
    <div className={reduced ? 'splash' : 'splash splash-move'} role="img" aria-label="DevTalk" style={timing}
      onClick={() => done.current()}>
      {reduced ? (
        <svg className="splash-art" viewBox={VIEW_PLAIN} aria-hidden="true">
          <Duck />
          <text className="splash-word">DevTalk</text>
        </svg>
      ) : (
        <svg className="splash-art" viewBox={VIEW} aria-hidden="true">
          <Duck />
          <rect className="splash-del-wash" x={FIX_X - 31} y={-84} width={62} height={94} rx={4} />
          <g className="splash-name">
            {/* Empty, but part of the group: the name is uncovered from the bill tip, not from the first letter. */}
            <rect x={TIP_X} y={-1} width={-TIP_X} height={2} fill="none" />
            <text className="splash-word"><tspan className="splash-del">d</tspan>evTalk</text>
          </g>
          <rect className="splash-strike" x={FIX_X - 31} y={-29} width={62} height={6} rx={3} />
          <g className="splash-ins">
            <rect className="splash-ins-wash" x={FIX_X - 23} y={-146} width={46} height={54} rx={4} />
            <text className="splash-ins-text" x={FIX_X} y={-98} textAnchor="middle">D</text>
          </g>
        </svg>
      )}
    </div>
  );
}
