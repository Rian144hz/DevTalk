import { formatDueIn, formatRelativeDay, formatLongDate, formatSlot } from '../../src/renderer/lib/format';

const t0 = new Date('2026-10-14T12:00:00');
const plus = (ms: number) => new Date(t0.getTime() + ms);
const MIN = 60_000, H = 60 * MIN, D = 24 * H;

test('formatDueIn', () => {
  expect(formatDueIn(t0, plus(-5 * MIN))).toBe('now');
  expect(formatDueIn(t0, plus(59_000))).toBe('in 1 min');
  expect(formatDueIn(t0, plus(10 * MIN))).toBe('in 10 min');
  expect(formatDueIn(t0, plus(23 * H))).toBe('in 23 h');
  expect(formatDueIn(t0, plus(D))).toBe('tomorrow');
  expect(formatDueIn(t0, plus(4 * D))).toBe('in 4 days');
  expect(formatDueIn(t0, plus(45 * D))).toBe('in 2 months');
});

test('formatRelativeDay', () => {
  expect(formatRelativeDay('2026-10-14T08:00:00', t0)).toBe('today');
  expect(formatRelativeDay('2026-10-13T23:00:00', t0)).toBe('yesterday');
  expect(formatRelativeDay('2026-10-02T10:00:00', t0)).toBe('2 Oct');
});

test('formatLongDate writes the day, month and year', () => {
  expect(formatLongDate('2099-01-31T12:00:00.000Z')).toBe('31 January 2099');
});

test('formatSlot names the day and the times', () => {
  expect(formatSlot({ day: 1, from: '19:00', to: '21:00' })).toBe('Monday, 19:00 to 21:00');
  expect(formatSlot({ day: 0, from: '08:30', to: '09:00' })).toBe('Sunday, 08:30 to 09:00');
});
