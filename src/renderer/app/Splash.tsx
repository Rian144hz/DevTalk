import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { isSkipKey, splashTiming } from '../lib/splash';
import { Icon } from './icons';

const REDUCE = '(prefers-reduced-motion: reduce)';

// SVG units: the word is set at 100 (Public Sans 700, -0.01em) on the baseline y = 0. Measured in the app:
// "devTalk" is 364.5 wide and its "d" spans 0–59.9 (ink 3–55, centre 29); "DevTalk" is 375.7 wide.
const WORD = 364.5;
const WORD_PLAIN = 375.7;
const FIX_X = 29;
// Both views centre the finished lockup (name + pencil) across, and the name's cap height down
// (the correction sits in the space above it).
const VIEW = '-3 -152 458 230';
const VIEW_PLAIN = '7.5 -152 458 230';

// The pencil ends this far past the last letter, so its tip clears the "k".
const PEN_GAP = 12;

/**
 * The rail's pencil mark at 7.5× (120 units) with its tip on the baseline at x = 0: while it travels the tip sits on
 * the edge being written, and it ends at `run`.
 */
function Pencil({ run }: { run: number }) {
  return (
    <g className="splash-pen" style={{ '--run': `${run}px` } as CSSProperties}>
      <g className="splash-pen-in" transform="translate(-22.5 -105)">
        <Icon name="pencil" size={120} />
      </g>
    </g>
  );
}

/**
 * The launch splash, over everything on the theme ground: the pencil writes "devTalk", then marks it the way the
 * coach marks a proof (the "d" struck in rose, "D" written above in sage), holds, and fades. Reduced motion shows the
 * still name. A click, Enter, Space or Escape ends it at once; `onDone` runs when it is over either way.
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
          <text className="splash-word">DevTalk</text>
          <Pencil run={WORD_PLAIN + PEN_GAP} />
        </svg>
      ) : (
        <svg className="splash-art" viewBox={VIEW} aria-hidden="true">
          <rect className="splash-del-wash" x={FIX_X - 31} y={-84} width={62} height={94} rx={4} />
          <text className="splash-word"><tspan className="splash-del">d</tspan>evTalk</text>
          <rect className="splash-strike" x={FIX_X - 31} y={-29} width={62} height={6} rx={3} />
          <g className="splash-ins">
            <rect className="splash-ins-wash" x={FIX_X - 23} y={-146} width={46} height={54} rx={4} />
            <text className="splash-ins-text" x={FIX_X} y={-98} textAnchor="middle">D</text>
          </g>
          <Pencil run={WORD + PEN_GAP} />
        </svg>
      )}
    </div>
  );
}
