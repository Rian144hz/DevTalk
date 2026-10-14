import { useCallback, useEffect, useState } from 'react';
import { MISTAKE_LABELS } from '../../core/domain/categories';
import type { Challenge } from '../../core/domain/types';
import { buildGalley } from '../../core/feedback/galley';
import type { ProgressSummary } from '../../core/progress/summary';
import type { FeedbackView, ReviewItem } from '../../shared/ipc-contract';
import { api, unwrap } from '../lib/api';
import { formatRelativeDay } from '../lib/format';
import { CHALLENGE_CATEGORY_LABELS } from '../../core/domain/categories';
import { Button, EmptyState, Galley, Notice, Skeleton, Tally, TypeBadge } from '../design-system';
import { NextChallenge } from './NextChallenge';

interface HomeData {
  last: FeedbackView | null;
  pending: Challenge | null;
  due: ReviewItem[];
  summary: ProgressSummary;
}

export function todayLede(due: number, hasChallenge: boolean): string {
  const parts = [due > 0 ? `${due} ${due === 1 ? 'expression' : 'expressions'} to review` : null, hasChallenge ? 'one challenge ready' : null].filter(Boolean);
  if (!parts.length) return 'Nothing waiting. Get a challenge when you are ready.';
  const minutes = Math.max(5, Math.round(due * 0.5 + (hasChallenge ? 8 : 0)));
  const sentence = parts.join(' and ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}. About ${minutes} minutes.`;
}

async function load(): Promise<HomeData> {
  const [history, pending, queue, summary] = await Promise.all([
    api().progress.history({ before: null, limit: 1 }),
    api().challenges.pending(),
    api().review.queue(),
    api().progress.summary(),
  ]);
  const lastItem = unwrap(history)[0];
  const last = lastItem ? unwrap(await api().feedback.get(lastItem.feedbackId)) : null;
  return { last, pending: unwrap(pending), due: unwrap(queue).items, summary: unwrap(summary) };
}

export function HomeScreen() {
  const [data, setData] = useState<HomeData | null>(null);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(() => {
    setFailed(false);
    load().then(setData, () => setFailed(true));
  }, []);
  useEffect(reload, [reload]);

  const write = useCallback(() => {
    window.location.hash = '#/practice';
  }, []);
  const onReady = useCallback((c: Challenge) => setData((d) => (d ? { ...d, pending: c } : d)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, button, a, [role="radio"]');
      if (e.key === 'Enter' && !e.ctrlKey && !typing && data?.pending) write();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data?.pending, write]);

  if (failed) {
    return <main className="page"><h1>Today</h1><Notice tone="error" title="Could not load your day." action={<Button variant="secondary" onClick={reload}>Try again</Button>} /></main>;
  }
  if (!data) {
    return <main className="page" aria-busy="true"><h1>Today</h1><Skeleton width="40%" /><Skeleton /><Skeleton width="70%" /></main>;
  }

  const recurring = data.summary.mistakes.filter((m) => m.last30Days > 0).slice(0, 3);
  return (
    <main className="page">
      <header className="page-head">
        <div><h1>Today</h1><p className="lede">{todayLede(data.due.length, data.pending !== null)}</p></div>
      </header>
      <div className="home">
        <section aria-label="Your last answer and what is next">
          {data.last ? (
            <Galley galley={buildGalley(data.last.text, data.last.corrections)} title="Your last answer, marked by the coach"
              meta={`${data.last.challenge ? CHALLENGE_CATEGORY_LABELS[data.last.challenge.category] : 'Free text'}, ${formatRelativeDay(data.last.createdAt, new Date())}`} />
          ) : (
            <EmptyState title="Your first answer will appear here" body="Write an answer to a challenge and the coach marks it up like an editor, with notes in the margin." />
          )}
          <NextChallenge pending={data.pending} onReady={onReady} onWrite={write} />
        </section>

        <aside className="side" aria-label="Review and patterns">
          <section aria-labelledby="due">
            <h2 id="due" className="side-head">Due for review <span className="muted small num">{data.due.length}</span></h2>
            {data.due.length ? (
              <>
                <ul className="due ruled">
                  {data.due.slice(0, 6).map((d) => (
                    <li key={d.expression.id}><span className="chip chip-plain">{d.expression.text}</span><TypeBadge type={d.expression.type} /></li>
                  ))}
                </ul>
                <Button variant="secondary" className="wide" onClick={() => { window.location.hash = '#/review'; }}>Review now</Button>
              </>
            ) : (
              <p className="muted small">Nothing due right now.</p>
            )}
          </section>
          {recurring.length > 0 && (
            <section className="watch" aria-labelledby="watch">
              <h2 id="watch">Keeps coming back</h2>
              <ul className="ruled">
                {recurring.map((m) => (
                  <li key={m.category}>{MISTAKE_LABELS[m.category]}<Tally count={m.last30Days} label={`${m.last30Days} times in the last 30 days`} /></li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
