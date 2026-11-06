import { useCallback, useEffect, useState } from 'react';
import { countSentences } from '../../core/domain/text';
import type { Challenge } from '../../core/domain/types';
import type { FeedbackView } from '../../shared/ipc-contract';
import { useAppData } from '../app/AppData';
import { api, unwrap } from '../lib/api';
import { useCoachRequest } from '../lib/useCoachRequest';
import { clearAnswer, loadAnswer, saveAnswer, takeRetryDraft } from '../lib/draft';
import { Button, EmptyState, Notice, Skeleton, TextArea } from '../design-system';
import { ChallengeBrief } from './ChallengeBrief';
import { DailyStart } from './DailyStart';
import { FeedbackScreen } from './FeedbackScreen';
import { NextChallenge } from './NextChallenge';

export const MAX_ANSWER = 4000;

export function sentenceHint(text: string): string {
  const n = countSentences(text);
  if (n === 0) return 'Aim for 3 to 5 sentences.';
  return `${n} ${n === 1 ? 'sentence' : 'sentences'}. Aim for 3 to 5.`;
}

/**
 * `daily`: the route is #/practice/daily, the Start of today's challenge. The daily start brings its own challenge, so the
 * pending one is not read while it runs; once it has written the challenge, the route goes back to #/practice and this
 * mounted screen keeps the challenge it was given.
 */
export function PracticeScreen({ daily = false }: { daily?: boolean }) {
  const { refresh } = useAppData();
  // "Write it again" hands over an answered challenge and its text.
  const [retry] = useState(takeRetryDraft);
  const [challenge, setChallenge] = useState<Challenge | null | undefined>(retry?.challenge);
  const [failed, setFailed] = useState(false);
  const [text, setTextState] = useState(retry?.text ?? '');
  const setText = useCallback((t: string) => {
    setTextState(t);
    if (challenge) saveAnswer(challenge.id, t);
  }, [challenge]);
  const req = useCoachRequest<FeedbackView>((id) => api().feedback.cancel(id));

  const load = useCallback(() => {
    if (retry) return;
    setFailed(false);
    api().challenges.pending().then((r) => {
      const pending = unwrap(r);
      setChallenge(pending);
      if (pending) setTextState(loadAnswer(pending.id));
    }, () => setFailed(true));
  }, [retry]);
  // Read the pending challenge when the screen has none, and not while the daily start is about to give it one. Without a
  // challenge (Start was cancelled, then the person went to Practice) it is read as soon as the route is plain Practice.
  useEffect(() => {
    if (!daily && challenge === undefined) load();
    // `challenge` is read only to know whether the screen has one; a change of it must not read the pending challenge again.
  }, [daily, load]);
  const onDailyReady = useCallback((c: Challenge) => {
    setChallenge(c);
    setTextState(loadAnswer(c.id));
    window.location.hash = '#/practice';
  }, []);

  useEffect(() => {
    if (req.state.status !== 'done') return;
    if (challenge) clearAnswer(challenge.id);
    window.location.hash = `#/feedback/${req.state.data.feedbackId}`;
    void refresh();
  }, [req.state, refresh, challenge]);

  const tooLong = text.length > MAX_ANSWER;
  const canSubmit = !!challenge && text.trim().length > 0 && !tooLong && req.state.status !== 'running';
  const submit = () => {
    if (!canSubmit || !challenge) return;
    req.run((requestId) => api().feedback.submit({ requestId, challengeId: challenge.id, text }));
  };

  if (daily) return <DailyStart onReady={onDailyReady} />;
  if (failed) return <main className="page"><Notice tone="error" title="Could not load your challenge." action={<Button variant="secondary" onClick={load}>Try again</Button>} /></main>;
  if (challenge === undefined) return <main className="page" aria-busy="true"><Skeleton width="30%" /><Skeleton /><Skeleton width="60%" /></main>;
  if (challenge === null) {
    return (
      <main className="page">
        <header className="page-head"><h1>Practice</h1></header>
        <EmptyState title="No challenge yet" body="Ask the coach for a short work situation, then answer it in 3 to 5 sentences." />
        <NextChallenge pending={null} onReady={setChallenge} onWrite={() => {}} />
      </main>
    );
  }

  if (req.state.status === 'running') {
    return <FeedbackScreen onNext={() => {}} mode={{ kind: 'waiting', text, challenge, stage: req.state.stage, startedAt: req.state.startedAt, onCancel: req.cancel }} />;
  }
  if (req.state.status === 'error') {
    const error = req.state.error;
    return (
      <FeedbackScreen onNext={() => {}}
        mode={{ kind: 'error', text, challenge, error, onRetry: submit, onEdit: () => req.reset() }} />
    );
  }

  return (
    <main className="page practice">
      <header className="page-head"><ChallengeBrief challenge={challenge} /></header>
      <form className="answer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <TextArea label="Your answer" value={text} onChange={(e) => setText(e.target.value)} spellCheck
          placeholder="Write 3 to 5 sentences, the way you would say it at work."
          hint={tooLong ? undefined : sentenceHint(text)}
          error={tooLong ? `Keep it under ${MAX_ANSWER} characters (now ${text.length}).` : undefined}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
              e.preventDefault();
              submit();
            }
          }} />
        <div className="answer-actions">
          <Button type="submit" variant="primary" shortcut="Ctrl Enter" disabled={!canSubmit}>Get feedback</Button>
        </div>
      </form>
    </main>
  );
}
