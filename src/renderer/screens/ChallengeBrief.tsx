import { CHALLENGE_CATEGORY_LABELS } from '../../core/domain/categories';
import type { Challenge } from '../../core/domain/types';
import { Chip } from '../design-system';

export const challengeTitle = (c: Challenge) => c.summary.charAt(0).toUpperCase() + c.summary.slice(1);

/** The situation as Practice shows it: who, what happened, what to answer, which expressions to use. */
export function ChallengeBrief({ challenge, compact = false }: { challenge: Challenge; compact?: boolean }) {
  return (
    <div className="brief">
      <span className="track">{CHALLENGE_CATEGORY_LABELS[challenge.category]}</span>
      <h1>{challengeTitle(challenge)}</h1>
      <p className="brief-situation">{challenge.situation}</p>
      {!compact && <p className="brief-who"><span className="muted">With</span> {challenge.interlocutor}</p>}
      {!compact && <p className="brief-task">{challenge.task}</p>}
      {challenge.required.length > 0 && (
        compact ? (
          <div className="need">Use in your answer {challenge.required.map((r) => <Chip key={r.expression.id}>{r.expression.text}</Chip>)}</div>
        ) : (
          <ul className="brief-required">
            {challenge.required.map((r) => (
              <li key={r.expression.id}><Chip>{r.expression.text}</Chip><span className="muted small">{r.hint}</span></li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
