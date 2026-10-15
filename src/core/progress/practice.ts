// Practice activity per day: what the graph and the streak are computed from. Pure.

export interface DayActivity {
  /** YYYY-MM-DD in the person's time zone. */
  day: string;
  answers: number;
  reviews: number;
  /** Corrections given in chat (community graph only). */
  corrections?: number;
}

export type GraphLevel = 0 | 1 | 2 | 3 | 4;

/** What the profile graph shows: daily activity plus the current and longest streaks. */
export interface PracticeGraphData {
  days: DayActivity[];
  current: number;
  longest: number;
}

const toDay = (d: Date) => d.toISOString().slice(0, 10);
const parse = (day: string) => new Date(`${day}T00:00:00Z`);
export const addDays = (day: string, n: number): string => toDay(new Date(parse(day).getTime() + n * 86_400_000));

const dayFormat = (timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });

/** YYYY-MM-DD of `date` in `timeZone`. */
export const localDay = (date: Date, timeZone: string): string => dayFormat(timeZone).format(date);

/** Groups ISO timestamps into local days of `timeZone`, sorted by day. */
export function bucketByDay(answers: string[], reviews: string[], timeZone: string): DayActivity[] {
  const fmt = dayFormat(timeZone);
  const days = new Map<string, DayActivity>();
  const add = (iso: string, key: 'answers' | 'reviews') => {
    const day = fmt.format(new Date(iso));
    const entry = days.get(day) ?? { day, answers: 0, reviews: 0 };
    entry[key] += 1;
    days.set(day, entry);
  };
  answers.forEach((t) => add(t, 'answers'));
  reviews.forEach((t) => add(t, 'reviews'));
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** points = answers × 5 + reviews + corrections × 5; levels 0 | 1–9 | 10–24 | 25–49 | 50+. */
export function graphLevel(a: DayActivity): GraphLevel {
  const points = a.answers * 5 + a.reviews + (a.corrections ?? 0) * 5;
  return points === 0 ? 0 : points < 10 ? 1 : points < 25 ? 2 : points < 50 ? 3 : 4;
}

/** Current streak (ending today or yesterday) and the longest run of active days. */
export function streaks(days: DayActivity[], today: string): { current: number; longest: number } {
  const active = new Set(days.filter((d) => d.answers + d.reviews + (d.corrections ?? 0) > 0).map((d) => d.day));
  let longest = 0;
  for (const day of active) {
    if (active.has(addDays(day, -1))) continue;
    let run = 1;
    while (active.has(addDays(day, run))) run++;
    longest = Math.max(longest, run);
  }
  let start = active.has(today) ? today : active.has(addDays(today, -1)) ? addDays(today, -1) : null;
  let current = 0;
  while (start && active.has(start)) {
    current++;
    start = addDays(start, -1);
  }
  return { current, longest };
}

/** 53 Monday-first weeks ending with the week of `today`; days without activity are zero. */
export function graphWeeks(days: DayActivity[], today: string): (DayActivity & { level: GraphLevel })[][] {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const mondayOffset = (parse(today).getUTCDay() + 6) % 7;
  const first = addDays(today, -mondayOffset - 52 * 7);
  const weeks: (DayActivity & { level: GraphLevel })[][] = [];
  for (let w = 0; w < 53; w++) {
    const week: (DayActivity & { level: GraphLevel })[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(first, w * 7 + i);
      const a = byDay.get(day) ?? { day, answers: 0, reviews: 0 };
      week.push({ day, answers: a.answers, reviews: a.reviews, corrections: a.corrections ?? 0, level: graphLevel(a) });
    }
    weeks.push(week);
  }
  return weeks;
}
