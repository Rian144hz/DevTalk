import type { DailyToday } from '../../src/core/daily/daily';
import { DAILY_DONE_LINE, dailyCardView } from '../../src/renderer/lib/daily-card';

const today = (over: Partial<DailyToday> = {}): DailyToday => ({
  day: '2026-11-05', category: 'code_review', theme: 'Code review', streak: 0, practisedToday: false, challengeId: null, ...over,
});

describe('the Today\'s challenge card', () => {
  test('not practised yet: the theme and the streak, and Start (no done line)', () => {
    expect(dailyCardView(today())).toEqual({ theme: 'Code review', streak: 'No streak yet', done: null });
    // A streak that ends yesterday is still the streak; the day is not done until there is practice today.
    expect(dailyCardView(today({ streak: 2 }))).toEqual({ theme: 'Code review', streak: '2-day streak', done: null });
  });

  test('done today: the theme, the streak and the done line, and no Start', () => {
    expect(dailyCardView(today({ streak: 1, practisedToday: true }))).toEqual({
      theme: 'Code review', streak: '1-day streak', done: 'Done for today. Come back tomorrow.',
    });
    expect(dailyCardView(today({ theme: 'Interview', streak: 12, practisedToday: true }))).toEqual({
      theme: 'Interview', streak: '12-day streak', done: DAILY_DONE_LINE,
    });
  });

  test('only practice makes it done: a written challenge, with or without an answer, does not', () => {
    expect(dailyCardView(today({ challengeId: 7 })).done).toBeNull();
    expect(dailyCardView(today({ challengeId: 7, practisedToday: true })).done).toBe(DAILY_DONE_LINE);
    // The challenge is not what the card looks at: any practice that day counts, as it does for the streak.
    expect(dailyCardView(today({ challengeId: null, practisedToday: true })).done).toBe(DAILY_DONE_LINE);
  });

  test('the done line is plain English and the same everywhere it is shown', () => {
    expect(DAILY_DONE_LINE).toBe('Done for today. Come back tomorrow.');
  });
});
