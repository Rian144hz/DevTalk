// The first run (no coach profile on this computer yet): which screen comes next. Pure, so the flow is a table in a test.
import { PROFILE_LIMITS } from '../../core/social/types';

export type FirstRunChoice = 'none' | 'github' | 'email' | 'local';
export type FirstRunStep = 'welcome' | 'join' | 'coach' | 'done';

/** The part of the community status that decides the flow. */
export interface FirstRunState {
  configured: boolean;
  signedIn: boolean;
  needsDocuments: boolean;
  hasProfile: boolean;
}

/**
 * The screen of the first run, from the community status, what the person chose on the welcome screen and whether the
 * coach setup is finished.
 * - `github` means GitHub is the way in: while the browser is still open the person stays on the welcome screen.
 * - A signed-in account that accepted the current documents and has a profile has nothing left to join: coach setup.
 */
export function firstRunStep(s: FirstRunState, choice: FirstRunChoice, coachDone: boolean): FirstRunStep {
  if (coachDone) return 'done';
  if (choice === 'local') return 'coach';
  if (choice === 'none' || !s.configured) return 'welcome';
  if (!s.signedIn) return choice === 'email' ? 'join' : 'welcome';
  return s.needsDocuments || !s.hasProfile ? 'join' : 'coach';
}

/** What the main process says when a GitHub sign-in ends without a session (Cancel, five minutes, a closed tab). */
export const SIGN_IN_NOT_FINISHED = 'Sign-in was not finished. Try again.';

/**
 * The message to show after a failed GitHub sign-in, or null for none. After the person's own Cancel, the
 * "not finished" answer is the expected one: they simply return to the buttons. Anything else is shown as worded.
 */
export function signInNotice(error: { kind: string; message: string }, cancelledByMember: boolean): string | null {
  if (cancelledByMember && error.kind === 'internal' && error.message === SIGN_IN_NOT_FINISHED) return null;
  return error.message;
}

/** The GitHub name for the Display name field: trimmed, and no longer than a profile name may be. */
export function suggestedDisplayName(raw: string | null): string {
  return (raw ?? '').trim().slice(0, PROFILE_LIMITS.displayName.max).trim();
}
