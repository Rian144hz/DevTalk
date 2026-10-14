import { formatDueIn, formatRelativeDay } from '../../src/renderer/lib/format';

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
