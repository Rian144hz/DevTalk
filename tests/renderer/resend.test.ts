import { secondsUntilResend } from '../../src/renderer/lib/resend';

test('counts down from 60 seconds after a code is sent', () => {
  expect(secondsUntilResend(10_000, 10_000)).toBe(60);
  expect(secondsUntilResend(10_000, 10_500)).toBe(60);
  expect(secondsUntilResend(10_000, 41_000)).toBe(29);
  expect(secondsUntilResend(10_000, 70_000)).toBe(0);
  expect(secondsUntilResend(10_000, 99_000)).toBe(0);
});

test('a clock reading older than the send never shows more than 60', () => {
  expect(secondsUntilResend(10_000, 2_000)).toBe(60);
});
