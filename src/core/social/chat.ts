// Private chat: shapes shared by main and the window, and the text rule both apply.
import type { MascotId } from './types';

export const CHAT_TEXT_MAX = 2000;
/** Messages loaded at a time ("Load earlier"). */
export const CHAT_PAGE = 50;

export type ConversationStatus = 'pending' | 'accepted' | 'declined';

export interface ConversationSummary {
  id: string;
  other: { id: string; displayName: string; hasAvatar: boolean; mascot: MascotId | null };
  status: ConversationStatus;
  requestedByMe: boolean;
  /** Last message text; null when it was deleted or there is none. */
  preview: string | null;
  lastMessageAt: string | null;
  unread: number;
}

export interface ChatCorrection {
  id: number;
  messageId: number;
  authorId: string;
  corrected: string;
  createdAt: string;
  thanked: boolean;
}

export interface ChatMessage {
  id: number;
  conversationId: string;
  senderId: string;
  /** Empty when deleted. */
  body: string;
  createdAt: string;
  deleted: boolean;
  corrections: ChatCorrection[];
}

/** Something changed in a conversation the member can read. */
export interface ChatEvent {
  kind: 'message' | 'correction' | 'conversation';
  conversationId: string;
}

/** What the window hears from the live chat: a change, or the connection going down or coming back. */
export type ChatLiveEvent = ChatEvent | { kind: 'online' | 'offline' };

/** The coach's view of a draft before it is sent. */
export interface ChatCheck {
  rewrite: string;
  corrections: { original: string; corrected: string; explanation: string }[];
}

/** A message copied into a report, as moderators see it. */
export interface ReportedMessage {
  messageId: number;
  senderName: string | null;
  body: string;
  createdAt: string;
  reported: boolean;
}

/** The text to send: trimmed; null when blank or longer than 2 000 characters. Newlines stay. */
export function chatText(raw: string): string | null {
  const text = raw.trim();
  return text.length === 0 || text.length > CHAT_TEXT_MAX ? null : text;
}
