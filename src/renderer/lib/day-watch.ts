import { localDay } from '../../core/progress/practice';

const HOUR = 3_600_000;
/** Longer than any local day there is (a change of two hours makes a day in Antarctica/Troll 26 hours long). */
const SEARCH_SPAN_MS = 27 * HOUR;

/** How long after midnight the timer is set for, so a timer that wakes a moment early still finds the new day. */
export const MIDNIGHT_MARGIN_MS = 1000;

/**
 * Milliseconds from `now` to the first moment the local date is another one: the next local midnight, or, where a zone skips
 * its midnight, the change of the clock that skips it. It is found by search, not by sums, so a day of 23, 24.5, 25 or 26
 * hours is exact, to the millisecond. Never zero: at midnight itself the next one is a whole day away.
 */
export function msUntilLocalMidnight(now: Date, timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone): number {
  const start = now.getTime();
  const today = localDay(now, timeZone);
  let same = start; // the date here is today's
  let other = start + SEARCH_SPAN_MS; // and here it is another one
  while (other - same > 1) {
    const middle = Math.floor((same + other) / 2);
    if (localDay(new Date(middle), timeZone) === today) same = middle;
    else other = middle;
  }
  return other - start;
}

export interface DayWatchEnv {
  /** Read what is on screen again. */
  refresh(): void;
  now(): Date;
  /** The window: it gets `focus` when the person comes back to it. */
  win: EventTarget;
  /** The document: it gets `visibilitychange` when it is shown or hidden (a minimised window restored, a screen that woke up). */
  doc: EventTarget & { readonly visibilityState: string };
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
  /** Default: this machine's time zone. */
  timeZone?: string;
}

/**
 * Keeps something that shows "today" from going stale while it stays on screen (a window left open overnight, a computer
 * that slept): `refresh` is called when the window gets the focus, when the document becomes visible, and a moment after each
 * local midnight. One timer at a time: it is armed again after it fires, and from the time it is then whenever the window
 * is looked at (the clock or the zone may have moved). Returns the function that stops it.
 */
export function watchDay(env: DayWatchEnv): () => void {
  let timer: unknown = null;
  let stopped = false;
  const disarm = () => {
    if (timer !== null) env.clearTimer(timer);
    timer = null;
  };
  const arm = () => {
    disarm();
    timer = env.setTimer(() => {
      timer = null;
      if (stopped) return;
      env.refresh();
      arm();
    }, msUntilLocalMidnight(env.now(), env.timeZone) + MIDNIGHT_MARGIN_MS);
  };
  const lookAgain = () => {
    if (stopped) return;
    env.refresh();
    arm();
  };
  const onVisibility = () => {
    if (env.doc.visibilityState === 'visible') lookAgain();
  };
  env.win.addEventListener('focus', lookAgain);
  env.doc.addEventListener('visibilitychange', onVisibility);
  arm();
  return () => {
    if (stopped) return;
    stopped = true;
    disarm();
    env.win.removeEventListener('focus', lookAgain);
    env.doc.removeEventListener('visibilitychange', onVisibility);
  };
}
