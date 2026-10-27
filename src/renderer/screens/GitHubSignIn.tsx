import { Button } from '../design-system';
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

/** While the browser is open: a quiet spinner (still under reduced motion), the instruction, and Cancel. */
export function GitHubWaiting({ onCancel }: { onCancel(): void }) {
  return (
    <div className="signin-wait">
      <p role="status">
        <span className="spinner" aria-hidden="true" />
        Finish signing in in your browser.
      </p>
      <Button variant="quiet" onClick={onCancel} autoFocus>Cancel</Button>
    </div>
  );
}
