// Pure helpers for the Messages screen.
import type { ChatMessage, ConversationSummary } from '../../core/social/chat';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

/** One copy of each message (the incoming version wins), in id order. Live events and pages can overlap. */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** Whole local days between `iso` and `now` (0 = today). */
const daysAgo = (iso: string, now: Date) => Math.round((startOfDay(now) - startOfDay(new Date(iso))) / DAY_MS);
const shortDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

/** Messages by local day, labelled Today, Yesterday or "2 Oct". */
export function groupByDay(messages: ChatMessage[], now: Date): { key: string; label: string; messages: ChatMessage[] }[] {
  const groups: { key: string; label: string; messages: ChatMessage[] }[] = [];
  for (const m of messages) {
    const d = new Date(m.createdAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const last = groups.at(-1);
    if (last?.key === key) {
      last.messages.push(m);
      continue;
    }
    const ago = daysAgo(m.createdAt, now);
    groups.push({ key, label: ago === 0 ? 'Today' : ago === 1 ? 'Yesterday' : shortDate(m.createdAt), messages: [m] });
  }
  return groups;
}

/** The time beside a conversation: "09:05" today, "Yesterday", then "30 Sep". */
export function conversationTime(iso: string | null, now: Date): string {
  if (!iso) return '';
  const ago = daysAgo(iso, now);
  if (ago === 0) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return ago === 1 ? 'Yesterday' : shortDate(iso);
}

/** "09:05" for a message. */
export function messageTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The number on the Messages item: unread messages, requests included. */
export function unreadTotal(conversations: ConversationSummary[]): number {
  return conversations.reduce((n, c) => n + c.unread, 0);
}
