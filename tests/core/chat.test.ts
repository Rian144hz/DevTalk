import { CHAT_PAGE, CHAT_TEXT_MAX, chatText } from '../../src/core/social/chat';

test('chat text is trimmed, never blank, at most 2 000 characters, newlines kept', () => {
  expect(chatText('  hi ')).toBe('hi');
  expect(chatText(' \n\t ')).toBeNull();
  expect(chatText('x'.repeat(2001))).toBeNull();
  expect(chatText('x'.repeat(2000))).toHaveLength(2000);
  expect(chatText('line one\nline two')).toBe('line one\nline two');
  expect(CHAT_TEXT_MAX).toBe(2000);
  expect(CHAT_PAGE).toBe(50);
});
