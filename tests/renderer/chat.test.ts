import type { ChatMessage, ConversationSummary } from '../../src/core/social/chat';
import { conversationTime, groupByDay, mergeMessages, unreadTotal } from '../../src/renderer/lib/chat';

const msg = (id: number, createdAt = '2026-10-15T12:00:00', over: Partial<ChatMessage> = {}): ChatMessage => ({
  id, conversationId: 'c1', senderId: 'u1', body: `m${id}`, createdAt, deleted: false, corrections: [], ...over,
});

test('mergeMessages keeps one copy of each message, the newest version, in id order', () => {
  const current = [msg(1), msg(2), msg(4)];
  const incoming = [msg(4, undefined, { body: '', deleted: true }), msg(3), msg(5), msg(2)];
  const merged = mergeMessages(current, incoming);
  expect(merged.map((m) => m.id)).toEqual([1, 2, 3, 4, 5]);
  expect(merged.find((m) => m.id === 4)).toMatchObject({ deleted: true, body: '' });
  expect(mergeMessages([], [])).toEqual([]);
  expect(mergeMessages(current, [])).toEqual(current);
});

test('groupByDay labels Today, Yesterday and older dates in local time', () => {
  const now = new Date(2026, 9, 15, 18, 0);
  const at = (d: number, h: number) => new Date(2026, 9, d, h, 0).toISOString();
  const groups = groupByDay([msg(1, at(2, 9)), msg(2, at(14, 23)), msg(3, at(15, 0)), msg(4, at(15, 17))], now);
  expect(groups.map((g) => [g.label, g.messages.map((m) => m.id)])).toEqual([
    ['2 Oct', [1]],
    ['Yesterday', [2]],
    ['Today', [3, 4]],
  ]);
  expect(groupByDay([], now)).toEqual([]);
});

test('conversation times: hour today, Yesterday, then the date', () => {
  const now = new Date(2026, 9, 15, 18, 0);
  expect(conversationTime(new Date(2026, 9, 15, 9, 5).toISOString(), now)).toBe('09:05');
  expect(conversationTime(new Date(2026, 9, 14, 22, 0).toISOString(), now)).toBe('Yesterday');
  expect(conversationTime(new Date(2026, 8, 30, 8, 0).toISOString(), now)).toBe('30 Sep');
  expect(conversationTime(null, now)).toBe('');
});

test('unreadTotal adds every conversation, requests included', () => {
  const c = (unread: number) => ({ unread }) as ConversationSummary;
  expect(unreadTotal([c(1), c(0), c(3)])).toBe(4);
  expect(unreadTotal([])).toBe(0);
});
