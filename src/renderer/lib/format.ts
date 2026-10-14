const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "in 10 min", "tomorrow", "in 4 days" — when a review comes due. */
export function formatDueIn(from: Date, to: Date): string {
  const ms = to.getTime() - from.getTime();
  if (ms < MIN) return 'now';
  if (ms < HOUR) return `in ${Math.round(ms / MIN)} min`;
  if (ms < DAY) return `in ${Math.round(ms / HOUR)} h`;
  const days = Math.round(ms / DAY);
  if (days === 1) return 'tomorrow';
  if (days < 30) return `in ${days} days`;
  const months = Math.round(days / 30);
  return `in ${months} ${months === 1 ? 'month' : 'months'}`;
}

/** "today", "yesterday" or "2 Oct", in local time. */
export function formatRelativeDay(iso: string, now: Date): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / DAY);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
