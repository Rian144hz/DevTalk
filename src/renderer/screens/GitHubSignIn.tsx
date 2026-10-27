import { useEffect, useRef } from 'react';
import { Button } from '../design-system';
import { isInDialog } from '../lib/keys';
import { stackIconFor } from '../lib/stack-icons';

/** The GitHub mark (Simple Icons, CC0) in the text colour of the button it sits in. */
export function GitHubMark({ size = 16 }: { size?: number }) {
  return (
    <svg className="github-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d={stackIconFor('github')?.path ?? ''} />
    </svg>
  );
}

/** The one primary action of a sign-in screen. */
export function GitHubButton({ onClick }: { onClick(): void }) {
  return (
    <Button variant="primary" onClick={onClick}>
      <GitHubMark />
      Continue with GitHub
    </Button>
  );
}

/**
 * While the browser is open: a quiet spinner (still under reduced motion), what to do and what comes after, and
 * Cancel right after the text. Escape cancels too.
 */
export function GitHubWaiting({ onCancel }: { onCancel(): void }) {
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isInDialog(e.target)) return;
      e.preventDefault();
      cancel.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="signin-wait">
      <p role="status">
        <span className="spinner" aria-hidden="true" />
        <span>
          Finish signing in with GitHub in your browser.
          <span className="signin-wait-hint">Then come back here.</span>
        </span>
      </p>
      <Button variant="secondary" onClick={onCancel} autoFocus>Cancel</Button>
    </div>
  );
}
