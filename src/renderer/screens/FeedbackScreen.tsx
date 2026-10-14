import { useEffect, useState } from 'react';
import { setRetryDraft } from '../lib/draft';
import { copyText } from '../lib/clipboard';
import { isTypingTarget } from '../lib/keys';
import { errorAction } from './errorCopy';
import { buildGalley } from '../../core/feedback/galley';
import type { Challenge } from '../../core/domain/types';
import type { ProgressStage } from '../../core/llm/structured';
import type { AppError, FeedbackView } from '../../shared/ipc-contract';
import { api } from '../lib/api';
import { Button, CoachProgress, EmptyState, ExpressionCard, Galley, Notice, Skeleton } from '../design-system';
import { Icon } from '../app/icons';
import { ChallengeBrief } from './ChallengeBrief';

export type FeedbackMode =
  | { kind: 'waiting'; text: string; challenge: Challenge | null; stage: ProgressStage | null; startedAt: number; onCancel(): void }
  | { kind: 'error'; text: string; challenge: Challenge | null; error: AppError; onRetry(): void; onEdit(): void }
  | { kind: 'ready'; view: FeedbackView };

const editsLabel = (n: number) => (n === 0 ? 'No edits' : n === 1 ? '1 edit' : `${n} edits`);

/** Underlines each new expression inside the rewrite (case-insensitive, first occurrence). */
function markExpressions(text: string, phrases: string[]) {
  const lower = text.toLowerCase();
  const hits = phrases
    .map((p) => ({ p, i: lower.indexOf(p.toLowerCase()) }))
    .filter((h) => h.i >= 0)
    .sort((a, b) => a.i - b.i);
  const out: (string | { mark: string })[] = [];
  let at = 0;
  for (const h of hits) {
    if (h.i < at) continue;
    out.push(text.slice(at, h.i), { mark: text.slice(h.i, h.i + h.p.length) });
    at = h.i + h.p.length;
  }
  out.push(text.slice(at));
  return out.map((part, i) => (typeof part === 'string' ? part : <mark key={i}>{part.mark}</mark>));
}

export function FeedbackScreen({ mode, onNext }: { mode: FeedbackMode; onNext(): void }) {
  const challenge = mode.kind === 'ready' ? mode.view.challenge : mode.challenge;
  const text = mode.kind === 'ready' ? mode.view.text : mode.text;
  const galley = mode.kind === 'ready' ? buildGalley(text, mode.view.corrections) : buildGalley(text, []);

  return (
    <main className="page feedback">
      <header className="page-head fb-head">
        {challenge ? <ChallengeBrief challenge={challenge} compact /> : <h1>Feedback</h1>}
        {mode.kind === 'ready' && <ReadyActions view={mode.view} onNext={onNext} />}
      </header>
      <div className="fb">
        <div className="fb-main">
          {mode.kind === 'waiting' && (
            <Galley galley={galley} title="Your answer" marked={false}
              head={<div className="galley-head"><CoachProgress stage={mode.stage} startedAt={mode.startedAt} onCancel={mode.onCancel} label="The coach is reading your answer" /></div>} />
          )}
          {mode.kind === 'error' && (
            <>
              <Notice tone="error" title={mode.error.message} detail="Your answer is kept."
                action={errorAction(mode.error.kind) === 'settings'
                  ? <Button variant="secondary" onClick={() => { window.location.hash = '#/settings'; }}>Open Settings</Button>
                  : <Button variant="secondary" onClick={mode.onRetry}>Try again</Button>} />
              <Galley galley={galley} title="Your answer" marked={false} meta={<Button variant="quiet" onClick={mode.onEdit}>Edit answer</Button>} />
            </>
          )}
          {mode.kind === 'ready' && (
            <>
              <Galley galley={galley} title="Your answer" meta={editsLabel(mode.view.corrections.length)} />
              <section aria-labelledby="rw" className="fb-section">
                <div className="sec-head"><h2 id="rw">How a fluent developer might say it</h2><CopyButton text={mode.view.naturalRewrite} /></div>
                <p className="rewrite">{markExpressions(mode.view.naturalRewrite, mode.view.expressions.map((e) => e.text))}</p>
              </section>
              <section aria-labelledby="ne" className="fb-section">
                <div className="sec-head"><h2 id="ne">New expressions</h2><span className="muted small">Added to your review queue</span></div>
                <div className="exprs">{mode.view.expressions.map((e) => <ExpressionCard key={e.id} expression={e} />)}</div>
              </section>
            </>
          )}
          {mode.kind === 'waiting' && <section className="fb-section" aria-hidden="true"><Skeleton width="40%" /><Skeleton /><Skeleton width="80%" /></section>}
        </div>

        <aside className="fb-side" aria-labelledby="req">
          {challenge && challenge.required.length > 0 && (
            <>
              <h2 id="req">Required expressions</h2>
              <ul className="req ruled">
                {challenge.required.map((r) => {
                  const check = mode.kind === 'ready' ? mode.view.requiredChecks.find((c) => c.expression.id === r.expression.id) : undefined;
                  return (
                    <li key={r.expression.id}>
                      <div className="req-top">
                        <span className="chip req-chip">{r.expression.text}</span>
                        {check && (check.usedCorrectly
                          ? <span className="status ok"><Icon name="check" size={14} />Used well</span>
                          : check.used
                            ? <span className="status open"><Icon name="half" size={14} />Used, needs work</span>
                            : <span className="status open"><Icon name="circle" size={14} />Not used yet</span>)}
                      </div>
                      {check?.note && <p>{check.note}</p>}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <Button variant="quiet" onClick={() => void copyText(text).then(() => setCopied(true))}>
      <Icon name="copy" size={14} />{copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

function ReadyActions({ view, onNext }: { view: FeedbackView; onNext(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.ctrlKey && !isTypingTarget(e.target)) onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNext]);
  return (
    <div className="fb-actions">
      <Button variant="primary" shortcut="Enter" onClick={onNext}>Next challenge</Button>
      {view.challenge && (
        <Button variant="secondary" onClick={() => {
          setRetryDraft({ challenge: view.challenge!, text: view.text });
          window.location.hash = '#/practice';
        }}>Write it again</Button>
      )}
    </div>
  );
}

/** #/feedback/:id — a saved feedback, read-only. */
export function FeedbackRoute({ id, onNext }: { id: number; onNext(): void }) {
  const [view, setView] = useState<FeedbackView | null | 'missing'>(null);
  useEffect(() => {
    let live = true;
    api().feedback.get(id).then((r) => live && setView(r.ok ? r.data : 'missing'), () => live && setView('missing'));
    return () => {
      live = false;
    };
  }, [id]);
  if (view === null) return <main className="page" aria-busy="true"><Skeleton width="30%" /><Skeleton /><Skeleton /></main>;
  if (view === 'missing') {
    return <main className="page"><EmptyState title="This feedback is not available" body="It may have been removed. Your other answers are in Progress." /></main>;
  }
  return <FeedbackScreen mode={{ kind: 'ready', view }} onNext={onNext} />;
}
