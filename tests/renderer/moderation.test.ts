import { describeAction, isSuspended } from '../../src/renderer/lib/moderation';

const entry = (action: string, o: { until?: string | null; badge?: string | null } = {}) => ({
  action, reason: 'r', until: o.until ?? null, badge: o.badge ?? null, createdAt: '2026-10-14T10:00:00Z',
});

test('each moderation action reads plainly, badges by name', () => {
  expect(describeAction(entry('warn'))).toBe('Warned');
  expect(describeAction(entry('unsuspend'))).toBe('Suspension lifted');
  expect(describeAction(entry('suspend', { until: 'infinity' }))).toBe('Suspended permanently');
  expect(describeAction(entry('suspend', { until: '2026-10-21T10:00:00Z' }))).toMatch(/^Suspended until /);
  expect(describeAction(entry('grant_badge', { badge: 'mentor' }))).toBe('Gave Mentor');
  expect(describeAction(entry('revoke_badge', { badge: 'open_source' }))).toBe('Removed Open source contributor');
  expect(describeAction(entry('grant_badge'))).toBe('Gave a badge');
});

test('a badge given after a suspension does not hide that the person is suspended', () => {
  const later = '2999-01-01T00:00:00Z';
  expect(isSuspended([entry('grant_badge', { badge: 'mentor' }), entry('suspend', { until: later })])).toBe(true);
  expect(isSuspended([entry('unsuspend'), entry('suspend', { until: later })])).toBe(false);
  expect(isSuspended([entry('suspend', { until: 'infinity' })])).toBe(true);
  expect(isSuspended([entry('suspend', { until: '2020-01-01T00:00:00Z' })])).toBe(false);
  expect(isSuspended([])).toBe(false);
});
