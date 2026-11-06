import { CHALLENGE_CATEGORIES, CHALLENGE_CATEGORY_LABELS } from '../../src/core/domain/categories';
import { DEFAULT_REMINDER_TIME, REMINDER_TIME, dailyTheme, practisedOn } from '../../src/core/daily/daily';
import { streaks, type DayActivity } from '../../src/core/progress/practice';

describe('practisedOn', () => {
  const days: DayActivity[] = [
    { day: '2026-11-03', answers: 1, reviews: 0 },
    { day: '2026-11-04', answers: 0, reviews: 3 },
    { day: '2026-11-05', answers: 0, reviews: 0 },
  ];

  test('practisedOn is true for a day with an answer or a review and false otherwise', () => {
    expect(practisedOn(days, '2026-11-03')).toBe(true);
    expect(practisedOn(days, '2026-11-04')).toBe(true);
    // A day that is listed but empty, a day that is not listed, and no days at all.
    expect(practisedOn(days, '2026-11-05')).toBe(false);
    expect(practisedOn(days, '2026-11-06')).toBe(false);
    expect(practisedOn([], '2026-11-03')).toBe(false);
  });

  test('it is the streak\'s own rule: a day counts for one exactly when it counts for the other', () => {
    const samples: Omit<DayActivity, 'day'>[] = [
      { answers: 1, reviews: 0 },
      { answers: 0, reviews: 2 },
      { answers: 4, reviews: 9 },
      { answers: 0, reviews: 0 },
      { answers: 0, reviews: 0, corrections: 3 },
      { answers: 0, reviews: 0, corrections: 0 },
    ];
    for (const sample of samples) {
      const day = { day: '2026-11-04', ...sample };
      expect(practisedOn([day], '2026-11-04'), JSON.stringify(sample)).toBe(streaks([day], '2026-11-04').current === 1);
    }
  });
});

describe('dailyTheme', () => {
  test("dailyTheme('code_review') is \"Code review\"", () => {
    expect(dailyTheme('code_review')).toBe('Code review');
  });

  test('every category has its label as its theme, and the themes differ', () => {
    for (const category of CHALLENGE_CATEGORIES) expect(dailyTheme(category)).toBe(CHALLENGE_CATEGORY_LABELS[category]);
    expect(new Set(CHALLENGE_CATEGORIES.map(dailyTheme)).size).toBe(CHALLENGE_CATEGORIES.length);
  });
});

describe('the reminder time', () => {
  test('is HH:MM on a 24-hour clock, 00:00 to 23:59, and the default is 19:00', () => {
    expect(DEFAULT_REMINDER_TIME).toBe('19:00');
    for (const ok of ['00:00', '07:05', '12:30', '19:00', '23:59']) expect(REMINDER_TIME.test(ok), ok).toBe(true);
    for (const bad of ['24:00', '25:99', '19:60', '7:05', '19:0', '19:00:00', ' 19:00', '19:00 ', '19.00', '1900', '', 'ab:cd']) {
      expect(REMINDER_TIME.test(bad), bad).toBe(false);
    }
  });
});
