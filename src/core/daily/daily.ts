import { CHALLENGE_CATEGORY_LABELS, type ChallengeCategory } from '../domain/categories';
import type { DayActivity } from '../progress/practice';

/** The reminder time the person sets: HH:MM on a 24-hour clock, 00:00 to 23:59, in local time. */
export const REMINDER_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DEFAULT_REMINDER_TIME = '19:00';

/**
 * The challenge of one local day. The category is chosen when the day's challenge is first asked for (without the coach, so
 * a notice can name the theme) and stays for the whole day; the coach writes the challenge itself on Start and `challengeId`
 * then points at it.
 */
export interface DailyPick {
  /** YYYY-MM-DD in the person's time zone. */
  day: string;
  category: ChallengeCategory;
  challengeId: number | null;
}

/** What the Home card shows. */
export interface DailyToday {
  day: string;
  category: ChallengeCategory;
  theme: string;
  /** The current streak: the run of practice days that ends today or yesterday. */
  streak: number;
  practisedToday: boolean;
  challengeId: number | null;
}

/** How a category reads on the card and in the notice. */
export const dailyTheme = (category: ChallengeCategory): string => CHALLENGE_CATEGORY_LABELS[category];

/**
 * Whether `day` has any practice. It is the streak's own rule (see `streaks`): the same days count for both, so a day that
 * keeps the streak alive is also a day the reminder has nothing to say about.
 */
export function practisedOn(days: DayActivity[], day: string): boolean {
  return days.some((d) => d.day === day && d.answers + d.reviews + (d.corrections ?? 0) > 0);
}
