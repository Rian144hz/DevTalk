import { useEffect, useState } from 'react';
import type { ProgressStage } from '../../core/llm/structured';
import { Button } from './Button';
import { isInDialog } from '../lib/keys';

const STEPS = ['Sending', 'Reading', 'Checking'] as const;
const STEP_OF: Record<ProgressStage, number> = { sending: 0, waiting: 1, retrying: 1, validating: 2 };

/** What the coach is doing right now, how long it has taken, and a way out (Esc). */
export function CoachProgress({ stage, startedAt, onCancel, label }: {
  stage: ProgressStage | null;
  startedAt: number;
  onCancel(): void;
  label: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    const onKey = (e: KeyboardEvent) => {
      // Esc inside the command palette closes the palette, not the coach's request.
      if (e.key === 'Escape' && !e.defaultPrevented && !isInDialog(e.target)) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);
  const current = stage ? STEP_OF[stage] : 0;
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  return (
    <div className="coach">
      <div className="coach-progress" role="status" aria-live="polite">
        <span className="coach-label">{stage === 'retrying' ? 'The coach is trying again' : label}</span>
        <ol className="coach-steps">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={i === current ? 'step' : undefined} data-done={i < current ? '' : undefined}>{s}</li>
          ))}
        </ol>
        <span className="num muted small" aria-label={`${seconds} seconds`}>{seconds} s</span>
        <Button variant="quiet" shortcut="Esc" onClick={onCancel}>Cancel</Button>
      </div>
      <div className="coach-bar" aria-hidden="true"><i /></div>
    </div>
  );
}
