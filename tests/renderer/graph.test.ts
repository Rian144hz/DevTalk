import { graphWeeks } from '../../src/core/progress/practice';
import { cellLabel, factsLine, monthLabels, moveCell } from '../../src/renderer/lib/graph';

test('a cell says what was done that day', () => {
  expect(cellLabel({ day: '2026-10-14', answers: 2, reviews: 15 })).toBe('14 Oct: 2 answers, 15 reviews');
  expect(cellLabel({ day: '2026-01-01', answers: 1, reviews: 1 })).toBe('1 Jan: 1 answer, 1 review');
  expect(cellLabel({ day: '2026-03-09', answers: 0, reviews: 3 })).toBe('9 Mar: 0 answers, 3 reviews');
  expect(cellLabel({ day: '2026-10-13', answers: 0, reviews: 0 })).toBe('13 Oct: no practice');
  expect(cellLabel({ day: '2026-10-14', answers: 0, reviews: 0, corrections: 1 })).toBe('14 Oct: 0 answers, 0 reviews, 1 correction');
  expect(cellLabel({ day: '2026-10-14', answers: 1, reviews: 2, corrections: 3 })).toBe('14 Oct: 1 answer, 2 reviews, 3 corrections');
});

test('month labels sit on the week each month starts, across January', () => {
  const weeks = graphWeeks([], '2026-10-14');
  expect(monthLabels(weeks)).toEqual([
    { week: 2, label: 'Nov' }, { week: 7, label: 'Dec' }, { week: 11, label: 'Jan' }, { week: 15, label: 'Feb' },
    { week: 19, label: 'Mar' }, { week: 24, label: 'Apr' }, { week: 28, label: 'May' }, { week: 33, label: 'Jun' },
    { week: 37, label: 'Jul' }, { week: 41, label: 'Aug' }, { week: 46, label: 'Sep' }, { week: 50, label: 'Oct' },
  ]);
});

test('the first column is labelled only when the next label is far enough', () => {
  // 53 weeks back from Wed 3 Jun 2026 starts on Mon 2 Jun 2025: June runs four weeks before July.
  expect(monthLabels(graphWeeks([], '2026-06-03'))[0]).toEqual({ week: 0, label: 'Jun' });
});

test('the facts line counts practised days and streaks, singular and plural', () => {
  const days = [
    { day: '2026-10-13', answers: 1, reviews: 0 },
    { day: '2026-10-14', answers: 0, reviews: 2 },
    { day: '2026-09-01', answers: 0, reviews: 0 },
  ];
  expect(factsLine(days, 2, 5)).toBe('2 days practised in the last year. Current streak: 2 days. Longest: 5 days.');
  expect(factsLine(days.slice(0, 1), 1, 1)).toBe('1 day practised in the last year. Current streak: 1 day. Longest: 1 day.');
});

test('arrow keys move by a day or a week and never past today or the first day', () => {
  // [week, weekday]; today is Wednesday (2) of the last week (52).
  const last = { week: 52, day: 2 };
  expect(moveCell(last, 'ArrowLeft', last)).toEqual({ week: 51, day: 2 });
  expect(moveCell(last, 'ArrowRight', last)).toEqual(last);
  expect(moveCell(last, 'ArrowDown', last)).toEqual(last);
  expect(moveCell(last, 'ArrowUp', last)).toEqual({ week: 52, day: 1 });
  expect(moveCell({ week: 51, day: 6 }, 'ArrowDown', last)).toEqual({ week: 52, day: 0 });
  expect(moveCell({ week: 0, day: 0 }, 'ArrowUp', last)).toEqual({ week: 0, day: 0 });
  expect(moveCell({ week: 10, day: 3 }, 'Home', last)).toEqual({ week: 0, day: 0 });
  expect(moveCell({ week: 10, day: 3 }, 'End', last)).toEqual(last);
});
