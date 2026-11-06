import type { DailyToday } from '../../core/daily/daily';
import { streakText } from './format';

/** What the card says, in the place of Start, once there has been practice today. */
export const DAILY_DONE_LINE = 'Done for today. Come back tomorrow.';

export interface DailyCardView {
  theme: string;
  streak: string;
  /** The done line once there has been practice today; null while the card offers Start. */
  done: string | null;
}

/**
 * What Today's challenge on Home shows for an answer of `daily:today`. The day is done when there has been any practice
 * (an answer or a review: the streak's own rule), not when this particular challenge was answered; a day with no practice
 * offers Start, and a day with practice offers nothing to press.
 */
export function dailyCardView(today: Pick<DailyToday, 'theme' | 'streak' | 'practisedToday'>): DailyCardView {
  return { theme: today.theme, streak: streakText(today.streak), done: today.practisedToday ? DAILY_DONE_LINE : null };
}
