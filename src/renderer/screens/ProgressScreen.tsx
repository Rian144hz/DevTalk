import { useCallback, useEffect, useState } from 'react';
import { CHALLENGE_CATEGORY_LABELS, MISTAKE_LABELS } from '../../core/domain/categories';
import type { HistoryItem } from '../../core/ports';
import { localDay, type PracticeGraphData } from '../../core/progress/practice';
import type { ProgressSummary } from '../../core/progress/summary';
import { api, unwrap } from '../lib/api';
import { formatRelativeDay } from '../lib/format';
import { Button, EmptyState, Notice, PracticeGraph, Skeleton, Tally } from '../design-system';

const PAGE = 20;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const snippet = (text: string) => (text.length > 90 ? `${text.slice(0, 90).trimEnd()}…` : text);

export function ProgressScreen() {
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [graph, setGraph] = useState<PracticeGraphData | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);

  const loadPage = useCallback(async (before: string | null) => {
    const items = unwrap(await api().progress.history({ before, limit: PAGE }));
    setHistory((h) => (before ? [...h, ...items] : items));
    setMore(items.length === PAGE);
  }, []);

  const load = useCallback(() => {
    setFailed(false);
    Promise.all([
      api().progress.summary().then((r) => setSummary(unwrap(r))),
      api().progress.graph().then((r) => setGraph(unwrap(r))),
      loadPage(null),
    ]).catch(() => setFailed(true));
  }, [loadPage]);
  useEffect(load, [load]);

  if (failed) return <main className="page"><h1>Progress</h1><Notice tone="error" title="Could not load your progress." action={<Button variant="secondary" onClick={load}>Try again</Button>} /></main>;
  if (!summary || !graph) return <main className="page" aria-busy="true"><h1>Progress</h1><Skeleton width="40%" /><Skeleton /></main>;

  const now = new Date();
  return (
    <main className="page progress">
      <header className="page-head"><h1>Progress</h1></header>

      <section aria-labelledby="pg-practice" className="progress-section">
        <h2 id="pg-practice">Practice</h2>
        {graph.days.length ? (
          <PracticeGraph days={graph.days} current={graph.current} longest={graph.longest} today={localDay(now, Intl.DateTimeFormat().resolvedOptions().timeZone)} />
        ) : (
          <p className="muted">No practice yet. Each day you answer a challenge or do a review fills a square here.</p>
        )}
      </section>

      <section aria-labelledby="pg-expr" className="progress-section">
        <h2 id="pg-expr">Expressions</h2>
        <ul className="progress-facts">
          <li>{plural(summary.totalExpressions, 'expression', 'expressions')} learned.</li>
          <li>{plural(summary.reusedExpressions, 'expression', 'expressions')} used correctly in a challenge.</li>
          <li>{plural(summary.dueToday, 'review', 'reviews')} due today.</li>
        </ul>
      </section>

      <section aria-labelledby="pg-edits" className="progress-section">
        <h2 id="pg-edits">Edits by category</h2>
        {summary.mistakes.length ? (
          <ul className="ruled edits">
            {summary.mistakes.map((m) => (
              <li key={m.category}>
                <span className="edits-label">{MISTAKE_LABELS[m.category]}</span>
                <Tally count={m.last30Days} label={`${m.last30Days} in the last 30 days`} />
                <span className="muted small num">{m.total} in total</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No edits yet. They are counted as the coach marks your answers.</p>
        )}
      </section>

      <section aria-labelledby="pg-history" className="progress-section">
        <h2 id="pg-history">History</h2>
        {history.length ? (
          <>
            <ul className="ruled history">
              {history.map((h) => (
                <li key={h.feedbackId}>
                  <a href={`#/feedback/${h.feedbackId}`}>
                    <span className="history-when">{formatRelativeDay(h.createdAt, now)}</span>
                    <span className="track">{h.category ? CHALLENGE_CATEGORY_LABELS[h.category] : 'Free text'}</span>
                    <span className="history-text">{snippet(h.text)}</span>
                    <span className="muted small">{plural(h.correctionCount, 'edit', 'edits')}</span>
                  </a>
                </li>
              ))}
            </ul>
            {more && <Button variant="secondary" onClick={() => void loadPage(history[history.length - 1]!.createdAt)}>Load more</Button>}
          </>
        ) : (
          <EmptyState title="No answers yet" body="Your answers will be listed here." />
        )}
      </section>
    </main>
  );
}
