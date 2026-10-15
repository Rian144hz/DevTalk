import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { graphWeeks, type DayActivity } from '../../core/progress/practice';
import { cellLabel, factsLine, monthLabels, moveCell, type Cell } from '../lib/graph';

const ROW_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''];
const ROW_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
const IDLE = 'Point at a day, or focus the graph and use the arrow keys, to see what was done.';

/**
 * Practice per day over the last 53 weeks (Monday first), GitHub style: one square per day, darker green for more
 * answers and reviews. The grid is one tab stop; arrow keys move between days and the day's text is announced.
 */
export function PracticeGraph({ days, current, longest, today }: { days: DayActivity[]; current: number; longest: number; today: string }) {
  const weeks = useMemo(() => graphWeeks(days, today), [days, today]);
  const last: Cell = useMemo(() => ({ week: weeks.length - 1, day: weeks[weeks.length - 1]!.findIndex((d) => d.day === today) }), [weeks, today]);
  const [active, setActive] = useState<Cell>(last);
  const [shown, setShown] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const id = useId();
  const cellId = (c: Cell) => `${id}-${c.week}-${c.day}`;
  const labelOf = (c: Cell) => cellLabel(weeks[c.week]![c.day]!);

  useEffect(() => setActive(last), [last]);
  // On narrow windows the graph scrolls sideways; start at the most recent weeks.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!KEYS.has(e.key)) return;
    e.preventDefault();
    const next = moveCell(active, e.key, last);
    setActive(next);
    setShown(labelOf(next));
    document.getElementById(cellId(next))?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  return (
    <div className="graph">
      <p className="graph-facts">{factsLine(days, current, longest)}</p>
      <div className="graph-scroll" ref={scroller}>
        <div className="graph-body">
          <div className="graph-months" aria-hidden="true">
            {monthLabels(weeks).map((m) => (
              <span key={m.week} style={{ gridColumn: `${m.week + 1} / span 3` }}>{m.label}</span>
            ))}
          </div>
          <div className="graph-days" aria-hidden="true">
            {ROW_LABELS.map((l, i) => <span key={i}>{l}</span>)}
          </div>
          <div
            className="graph-grid"
            role="grid"
            aria-label="Practice per day, last 53 weeks"
            tabIndex={0}
            aria-activedescendant={cellId(active)}
            onKeyDown={onKeyDown}
            onFocus={() => setShown(labelOf(active))}
            onBlur={() => setShown(null)}
            onMouseOver={(e) => {
              const label = (e.target as HTMLElement).getAttribute('aria-label');
              if (label) setShown(label);
            }}
            onMouseLeave={() => setShown(null)}
          >
            {ROW_NAMES.map((name, r) => (
              <div role="row" aria-label={name} key={name}>
                {weeks.map((week, w) => {
                  const d = week[r]!;
                  if (d.day > today) return null;
                  const isActive = active.week === w && active.day === r;
                  return (
                    <span
                      key={d.day}
                      id={cellId({ week: w, day: r })}
                      role="gridcell"
                      aria-label={cellLabel(d)}
                      aria-selected={isActive}
                      className={`graph-cell graph-l${d.level}`}
                      style={{ gridColumn: w + 1, gridRow: r + 1 }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="graph-foot">
        <p className="graph-tip" aria-live="polite">{shown ?? IDLE}</p>
        <p className="graph-legend" aria-hidden="true">
          Less {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`graph-l${l}`} />)} More
        </p>
      </div>
    </div>
  );
}
