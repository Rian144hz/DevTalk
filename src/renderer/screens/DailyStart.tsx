import { useEffect, useState } from 'react';
import type { Challenge } from '../../core/domain/types';
import { api } from '../lib/api';
import { useCoachRequest } from '../lib/useCoachRequest';
import { Button, CoachProgress, Notice } from '../design-system';
import { errorAction } from './errorCopy';

/**
 * Today's challenge being written. Opening this screen is the Start: the coach is asked at once (once a day: if the challenge
 * was written already, the main process hands it back), and `onReady` gets the challenge for Practice to show. Esc cancels, and
 * Start asks again. Leaving the screen cancels a call that is still running.
 */
export function DailyStart({ onReady }: { onReady(c: Challenge): void }) {
  const req = useCoachRequest<Challenge>((id) => api().challenges.cancel(id));
  /** The person stopped it: the screen then offers Start instead of asking again by itself. */
  const [cancelled, setCancelled] = useState(false);
  const start = () => {
    setCancelled(false);
    req.run((id) => api().daily.start(id));
  };
  useEffect(start, []);
  useEffect(() => {
    if (req.state.status === 'done') onReady(req.state.data);
  }, [req.state, onReady]);

  const { state } = req;
  return (
    <main className="page">
      <header className="page-head">
        <div><h1>Today's challenge</h1><p className="lede">The coach writes it once, and it stays the same all day.</p></div>
      </header>
      <div className="daily-start">
        {state.status === 'running' && (
          <CoachProgress stage={state.stage} startedAt={state.startedAt} label="The coach is writing today's challenge"
            onCancel={() => { req.cancel(); setCancelled(true); }} />
        )}
        {state.status === 'error' && (
          <Notice tone="error" title={state.error.message}
            action={errorAction(state.error.kind) === 'settings'
              ? <Button variant="secondary" onClick={() => { window.location.hash = '#/settings'; }}>Open Settings</Button>
              : <Button variant="secondary" onClick={start}>Try again</Button>} />
        )}
        {state.status === 'idle' && cancelled && <div><Button variant="primary" onClick={start}>Start</Button></div>}
      </div>
    </main>
  );
}
