import { useCallback, useEffect, useState } from 'react';
import { REVIEW_RATINGS, type ReviewRating } from '../../core/srs/srs';
import type { ReviewQueue } from '../../shared/ipc-contract';
import { useAppData } from '../app/AppData';
import { api, unwrap } from '../lib/api';
import { formatDueIn } from '../lib/format';
import { Button, EmptyState, ExpressionCard, Kbd, Notice, Skeleton } from '../design-system';

const LABELS: Record<ReviewRating, string> = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };

export function ReviewScreen() {
  const { refresh } = useAppData();
  const [queue, setQueue] = useState<ReviewQueue | null>(null);
  const [failed, setFailed] = useState(false);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const [nextDueAt, setNextDueAt] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    api().review.queue().then((r) => { setQueue(unwrap(r)); setIndex(0); setRevealed(false); }, () => setFailed(true));
  }, []);
  useEffect(load, [load]);

  const item = queue?.items[index];
  const rate = useCallback(async (rating: ReviewRating) => {
    if (!item || busy) return;
    setBusy(true);
    setRateError(null);
    try {
      unwrap(await api().review.rate({ expressionId: item.expression.id, rating }));
      if (queue && index + 1 >= queue.items.length) setNextDueAt(unwrap(await api().review.queue()).nextDueAt);
      setIndex((i) => i + 1);
      setRevealed(false);
      void refresh();
    } catch {
      setRateError('That rating was not saved. Try again.');
    } finally {
      setBusy(false);
    }
  }, [item, busy, refresh, queue, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || !item || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === ' ' && !revealed) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
        void rate(REVIEW_RATINGS[Number(e.key) - 1]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, revealed, rate]);

  if (failed) return <main className="page"><h1>Review</h1><Notice tone="error" title="Could not load your review queue." action={<Button variant="secondary" onClick={load}>Try again</Button>} /></main>;
  if (!queue) return <main className="page" aria-busy="true"><h1>Review</h1><Skeleton width="30%" /><Skeleton /></main>;

  const now = new Date();
  if (queue.items.length === 0) {
    return (
      <main className="page review">
        <h1>Review</h1>
        <EmptyState title="Nothing to review now"
          body={queue.nextDueAt ? `Next review ${formatDueIn(now, new Date(queue.nextDueAt))}.` : 'Expressions from your feedback will appear here.'} />
      </main>
    );
  }
  if (!item) {
    return (
      <main className="page review">
        <h1>Review</h1>
        <EmptyState title="Done for now"
          body={`You reviewed ${queue.items.length} ${queue.items.length === 1 ? 'expression' : 'expressions'}.${nextDueAt ? ` Next review ${formatDueIn(now, new Date(nextDueAt))}.` : ''}`}
          action={<Button variant="primary" onClick={() => { window.location.hash = '#/home'; }}>Back to Today</Button>} />
      </main>
    );
  }

  return (
    <main className="page review">
      <header className="page-head">
        <div><h1>Review</h1><p className="lede">Say the expression in a sentence of your own before you reveal it.</p></div>
        <span className="muted num" aria-live="polite">{index + 1} of {queue.items.length}</span>
      </header>
      <div className="review-card">
        <ExpressionCard expression={item.expression} concealed={!revealed} />
      </div>
      {rateError && <Notice tone="error" title={rateError} />}
      <div className="review-actions">
        {revealed ? (
          REVIEW_RATINGS.map((r, i) => (
            <Button key={r} variant="secondary" disabled={busy} onClick={() => void rate(r)} className="rate">
              <span>{LABELS[r]}<span className="rate-when">{formatDueIn(now, new Date(item.preview[r]))}</span></span>
              <Kbd>{i + 1}</Kbd>
            </Button>
          ))
        ) : (
          <Button variant="primary" shortcut="Space" onClick={() => setRevealed(true)}>Show meaning</Button>
        )}
      </div>
    </main>
  );
}
