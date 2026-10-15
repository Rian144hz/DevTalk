// Text and navigation for the practice graph. Days are YYYY-MM-DD strings, read as text so a day never shifts
// with the viewer's time zone.
import type { DayActivity } from '../../core/progress/practice';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthOf = (day: string) => MONTHS[Number(day.slice(5, 7)) - 1]!;
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** "14 Oct: 2 answers, 15 reviews", or "14 Oct: no practice". */
export function cellLabel(d: DayActivity): string {
  const when = `${Number(d.day.slice(8, 10))} ${monthOf(d.day)}`;
  const corrections = d.corrections ?? 0;
  if (d.answers + d.reviews + corrections === 0) return `${when}: no practice`;
  const given = corrections > 0 ? `, ${count(corrections, 'correction')}` : '';
  return `${when}: ${count(d.answers, 'answer')}, ${count(d.reviews, 'review')}${given}`;
}

/** Leave this many weeks before the next label, or the first column's month is not shown. */
const MIN_GAP = 3;

/** A month's short name over the week it starts in; the first column also gets one when there is room. */
export function monthLabels(weeks: DayActivity[][]): { week: number; label: string }[] {
  const labels: { week: number; label: string }[] = [];
  weeks.forEach((week, w) => {
    const first = week.find((d) => d.day.endsWith('-01'));
    if (first) labels.push({ week: w, label: monthOf(first.day) });
  });
  const start = weeks[0]?.[0];
  if (start && !start.day.endsWith('-01') && (labels[0]?.week ?? Infinity) >= MIN_GAP) {
    labels.unshift({ week: 0, label: monthOf(start.day) });
  }
  return labels;
}

/** "N days practised in the last year. Current streak: X days. Longest: Y days." */
export function factsLine(days: DayActivity[], current: number, longest: number): string {
  const practised = days.filter((d) => d.answers + d.reviews + (d.corrections ?? 0) > 0).length;
  return `${count(practised, 'day')} practised in the last year. Current streak: ${count(current, 'day')}. Longest: ${count(longest, 'day')}.`;
}

export interface Cell {
  week: number;
  /** 0 = Monday … 6 = Sunday. */
  day: number;
}

/** Arrow keys move a day (up/down) or a week (left/right); Home and End jump to the first day and today. */
export function moveCell(from: Cell, key: string, last: Cell): Cell {
  const idx = from.week * 7 + from.day;
  const max = last.week * 7 + last.day;
  const to =
    key === 'ArrowLeft' ? (idx >= 7 ? idx - 7 : idx)
    : key === 'ArrowRight' ? (idx + 7 <= max ? idx + 7 : idx)
    : key === 'ArrowUp' ? Math.max(idx - 1, 0)
    : key === 'ArrowDown' ? Math.min(idx + 1, max)
    : key === 'Home' ? 0
    : key === 'End' ? max
    : idx;
  return { week: Math.floor(to / 7), day: to % 7 };
}
