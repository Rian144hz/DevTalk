import { useCallback, useEffect, useRef, useState } from 'react';
import type { SocialStatus } from '../../shared/ipc-contract';
import { api } from './api';
import { signInNotice } from './first-run';
import { AppErrorException, unwrap } from './result';

export interface GitHubSignIn {
  /** The browser is open and the main process waits for GitHub to send the person back. */
  waiting: boolean;
  /** What went wrong, in the main process' words; null after the person's own Cancel. */
  error: string | null;
  start(): void;
  cancel(): void;
}

/**
 * One GitHub sign-in at a time for a screen: opens the browser through the main process and waits.
 * `onSignedIn` gets the community status once there is a session (a Cancel that lands while the code is being
 * exchanged still signs in, so it ends here too). Leaving the screen while waiting cancels the wait.
 */
export function useGitHubSignIn(onSignedIn: (status: SocialStatus) => void): GitHubSignIn {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef(0);
  const cancelled = useRef(false);
  const pending = useRef(false);
  const live = useRef(true);
  const signedIn = useRef(onSignedIn);
  signedIn.current = onSignedIn;

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (pending.current) void api().social.cancelSignIn();
    };
  }, []);

  const start = useCallback(() => {
    const mine = ++attempt.current;
    cancelled.current = false;
    pending.current = true;
    setError(null);
    setWaiting(true);
    void (async () => {
      let next: SocialStatus | null = null;
      let failure: string | null = null;
      try {
        next = unwrap(await api().social.signInWithGitHub());
      } catch (e) {
        failure = e instanceof AppErrorException
          ? signInNotice(e, cancelled.current)
          : 'Something went wrong. Try again.';
      }
      if (mine !== attempt.current || !live.current) return;
      pending.current = false;
      setWaiting(false);
      if (next) signedIn.current(next);
      else setError(failure);
    })();
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    void api().social.cancelSignIn();
  }, []);

  return { waiting, error, start, cancel };
}
