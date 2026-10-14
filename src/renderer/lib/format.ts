const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "in 10 min", "tomorrow", "in 4 days" — when a review comes due. */
export function formatDueIn(from: Date, to: Date): string {
  const ms = to.getTime() - from.getTime();
  if (ms <= 0) return 'now';
  if (ms < MIN) return 'in 1 min';
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

/** "31 January 2099" in the viewer's time zone. */
export function formatLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** "Monday, 19:00 to 21:00" (times stay in the profile's own time zone). */
export function formatSlot(slot: { day: number; from: string; to: string }): string {
  return `${DAY_NAMES[slot.day] ?? 'Day'}, ${slot.from} to ${slot.to}`;
}

/** "00:00" … "23:30" in 30-minute steps, plus `keep` (a saved value off the grid) in order. */
export function halfHourTimes(keep?: string): string[] {
  const times: string[] = [];
  for (let m = 0; m < 24 * 60; m += 30) times.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  if (keep && /^\d{2}:\d{2}$/.test(keep) && !times.includes(keep)) times.push(keep);
  return times.sort();
}
