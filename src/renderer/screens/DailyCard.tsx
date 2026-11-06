import { useCallback, useEffect, useState } from 'react';
import type { DailyToday } from '../../core/daily/daily';
import { api } from '../lib/api';
import { streakText } from '../lib/format';
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
 * Today's challenge on Home: the theme, the streak and Start. It exists only while the daily challenge is on (the main process
 * answers null otherwise) and loads on its own, so a failure here never takes the rest of Home with it.
 */
export function DailyCard() {
  const [state, setState] = useState<CardState>({ status: 'loading' });
  const slow = useAfter(250);
  const load = useCallback(() => {
    setState((s) => (s.status === 'loading' ? s : { status: 'loading' }));
    api().daily.today().then(
      (r) => setState(r.ok ? { status: 'ready', today: r.data } : { status: 'error' }),
      () => setState({ status: 'error' }),
    );
  }, []);
  useEffect(load, [load]);

  if (state.status === 'loading') {
    return slow ? <div className="daily-card" aria-busy="true"><div className="daily-card-body"><Skeleton width="160px" /><Skeleton width="240px" /></div></div> : null;
  }
  if (state.status === 'error') {
    return (
      <div className="daily-card">
        <p className="small field-error" role="status">Could not load today's challenge.</p>
        <Button variant="quiet" onClick={load}>Try again</Button>
      </div>
    );
  }
  if (!state.today) return null;

  const { theme, streak } = state.today;
  return (
    <section className="daily-card" aria-labelledby="daily-title">
      <div className="daily-card-body">
        <h2 id="daily-title">Today's challenge</h2>
        <p className="daily-meta">
          <span className="daily-theme">{theme}</span>
          <span className="muted" aria-hidden="true">·</span>
          <span>{streakText(streak)}</span>
        </p>
      </div>
      <a className="btn btn-secondary" href="#/practice/daily">Start</a>
    </section>
  );
}
