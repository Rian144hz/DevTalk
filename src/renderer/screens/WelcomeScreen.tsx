import { useEffect, useRef } from 'react';
import type { SocialStatus } from '../../shared/ipc-contract';
import { Brand, Button, Notice } from '../design-system';
import { signInFailure } from '../lib/first-run';
import { useGitHubSignIn } from '../lib/useGitHubSignIn';
import { GitHubButton, GitHubWaiting } from './GitHubSignIn';

/**
 * The first screen of a first run: three ways in, one column like the coach setup. Without a community in this build
 * only "Practise without an account" shows. GitHub is handled here (the browser wait, Cancel, the error); e-mail and
 * practising without an account are the next screens, chosen by the caller.
 */
export function WelcomeScreen({ configured, onSignedIn, onEmail, onLocal }: {
  configured: boolean;
  onSignedIn(status: SocialStatus): void;
  onEmail(): void;
  onLocal(): void;
}) {
  const github = useGitHubSignIn(onSignedIn);
  const actions = useRef<HTMLDivElement>(null);
  const wasWaiting = useRef(false);

  // Cancel (or a failure) takes the buttons back; keep the keyboard where it was.
  useEffect(() => {
    if (wasWaiting.current && !github.waiting) actions.current?.querySelector('button')?.focus();
    wasWaiting.current = github.waiting;
  }, [github.waiting]);

  return (
    <main className="onboarding welcome">
      <div className="onboarding-col">
        <Brand />
        <h1>Practise the English you use at work.</h1>
        <p className="lede">A coach marks your writing, and other developers talk with you.</p>

        <div className="welcome-actions" ref={actions}>
          {github.error && <Notice tone="error" {...signInFailure(github.error)} />}
          {github.waiting ? (
            <GitHubWaiting onCancel={github.cancel} />
          ) : (
            <>
              {configured && <GitHubButton onClick={github.start} />}
              {configured && <Button variant="secondary" onClick={onEmail}>Continue with e-mail</Button>}
              <Button variant={configured ? 'quiet' : 'primary'} onClick={onLocal}>Practise without an account</Button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
