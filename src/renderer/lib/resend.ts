export const RESEND_AFTER_MS = 60_000;

/** Whole seconds until "Send a new code" is allowed again (0 when it is). */
export function secondsUntilResend(sentAt: number, now: number, wait = RESEND_AFTER_MS): number {
  const elapsed = Math.max(0, now - sentAt);
  return Math.max(0, Math.ceil((wait - elapsed) / 1000));
}
