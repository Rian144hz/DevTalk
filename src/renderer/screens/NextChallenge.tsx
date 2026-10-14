import { useEffect } from 'react';
import type { Challenge } from '../../core/domain/types';
import { CHALLENGE_CATEGORY_LABELS } from '../../core/domain/categories';
import { api } from '../lib/api';
import { useCoachRequest } from '../lib/useCoachRequest';
import { Button, Chip, CoachProgress, Notice } from '../design-system';

/** The pending challenge with "Write it", or a way to ask the coach for one. */
export function NextChallenge({ pending, onReady, onWrite }: { pending: Challenge | null; onReady(c: Challenge): void; onWrite(): void }) {
  const req = useCoachRequest<Challenge>((id) => api().challenges.cancel(id));
  useEffect(() => {
    if (req.state.status === 'done') onReady(req.state.data);
  }, [req.state, onReady]);

  if (pending) {
    return (
      <div className="next">
        <div>
          <h2>Next: {CHALLENGE_CATEGORY_LABELS[pending.category].toLowerCase()}</h2>
          <p>{pending.situation}</p>
          {pending.required.length > 0 && (
            <div className="need">Use in your answer {pending.required.map((r) => <Chip key={r.expression.id}>{r.expression.text}</Chip>)}</div>
          )}
        </div>
        <Button variant="primary" shortcut="Enter" onClick={onWrite}>Write it</Button>
      </div>
    );
  }
  if (req.state.status === 'running') {
    return (
      <div className="next">
        <CoachProgress stage={req.state.stage} startedAt={req.state.startedAt} onCancel={req.cancel} label="The coach is writing a challenge" />
      </div>
    );
  }
  return (
    <div className="next">
      {req.state.status === 'error' ? (
        <Notice tone="error" title={req.state.error.message}
          action={<Button variant="secondary" onClick={() => req.run((id) => api().challenges.next(id))}>Try again</Button>} />
      ) : (
        <>
          <div><h2>Ready for a challenge?</h2><p>The coach writes a short work situation for you to answer in 3 to 5 sentences.</p></div>
          <Button variant="primary" onClick={() => req.run((id) => api().challenges.next(id))}>Get a challenge</Button>
        </>
      )}
    </div>
  );
}
