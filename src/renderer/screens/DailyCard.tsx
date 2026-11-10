import { useCallback, useEffect, useRef, useState } from 'react';
import type { DailyToday } from '../../core/daily/daily';
import { Icon } from '../app/icons';
import { api } from '../lib/api';
import { dailyCardView } from '../lib/daily-card';
import { watchDay } from '../lib/day-watch';
import { Button, Skeleton } from '../design-system';

type CardState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; today: DailyToday | null };

/**
 * True once `ms` have passed. The card is absent for most people (the daily challenge is off by default), so a placeholder that
 * is on screen for a frame would make the page jump twice for nothing: it shows only when the answer is slow.
 */
function useAfter(ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return late;
}

/**
 * Today's challenge on Home: the theme, the streak and Start; once there has been practice today, a quiet "Done for today"
 * in the place of Start. It exists only while the daily challenge is on (the main process answers null otherwise) and loads
 * on its own, so a failure here never takes the rest of Home with it. It does not go stale: "today" moves while the window
 * stays open (overnight, a computer that slept), so the card is read again when the window gets the focus or is shown again,
 * and a moment after every local midnight.
 */
export function DailyCard() {
  const [state, setState] = useState<CardState>({ status: 'loading' });
  const slow = useAfter(250);
  /** Counts the reads: only the answer to the latest one is used, so a slow old answer never replaces a newer card. */
  const latest = useRef(0);
  /**
   * Reads the card. A quiet read (a refresh) keeps what is on screen while it runs and when it fails: a good card does not
   * turn into a placeholder or an error line because the window got the focus.
   */
  const read = useCallback((quiet: boolean) => {
    const mine = ++latest.current;
    if (!quiet) setState((s) => (s.status === 'loading' ? s : { status: 'loading' }));
    const fail = () => setState((s) => (quiet && s.status === 'ready' ? s : { status: 'error' }));
    api().daily.today().then(
      (r) => {
        if (mine !== latest.current) return;
        if (r.ok) setState({ status: 'ready', today: r.data });
        else fail();
      },
      () => {
        if (mine === latest.current) fail();
      },
    );
  }, []);
  useEffect(() => {
    read(false);
  }, [read]);
  useEffect(
    () => watchDay({
      refresh: () => read(true),
      now: () => new Date(),
      win: window,
      doc: document,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    }),
    [read],
  );

  if (state.status === 'loading') {
    return slow ? <div className="daily-card" aria-busy="true"><div className="daily-card-body"><Skeleton width="160px" /><Skeleton width="240px" /></div></div> : null;
  }
  if (state.status === 'error') {
    return (
      <div className="daily-card">
        <p className="small field-error" role="status">Could not load today's challenge.</p>
        <Button variant="quiet" onClick={() => read(false)}>Try again</Button>
      </div>
    );
  }
  if (!state.today) return null;

  const view = dailyCardView(state.today);
  return (
    <section className="daily-card" aria-labelledby="daily-title">
      <div className="daily-card-body">
        <h2 id="daily-title">Today's challenge</h2>
        <p className="daily-meta">
          <span className="daily-theme">{view.theme}</span>
          <span className="muted" aria-hidden="true">·</span>
          <span>{view.streak}</span>
        </p>
      </div>
      {view.done === null
        ? <a className="btn btn-secondary" href="#/practice/daily">Start</a>
        : <p className="daily-done"><Icon name="check" size={14} />{view.done}</p>}
    </section>
  );
}
