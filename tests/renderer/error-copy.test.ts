import { errorAction } from '../../src/renderer/screens/errorCopy';

test('key and model problems send you to Settings; transient ones offer Try again', () => {
  for (const k of ['no_key', 'auth', 'config', 'keyring_unavailable'] as const) expect(errorAction(k)).toBe('settings');
  for (const k of ['unavailable', 'rate_limited', 'invalid_output', 'truncated', 'refusal', 'internal'] as const) expect(errorAction(k)).toBe('retry');
  expect(errorAction('cancelled')).toBe('none');
});
