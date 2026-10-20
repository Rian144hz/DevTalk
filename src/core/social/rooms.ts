// Voice rooms: shapes shared by main and the window, the limits both apply, the idea cards and the timer.
import type { Level } from '../domain/types';
import type { MascotId } from './types';

/** Most people live in one room at the same time. */
export const ROOM_MAX = 6;
export const ROOM_TITLE_MIN = 3;
export const ROOM_TITLE_MAX = 60;
/** A live person says "I am still here" this often; 90 s without it and the seat is free. */
export const ROOM_HEARTBEAT_MS = 30_000;
/** A peer that has not connected by then shows "Could not connect". */
export const ROOM_CONNECT_TIMEOUT_MS = 20_000;
/** Largest signal payload (an offer, an answer or a candidate). */
export const ROOM_SIGNAL_MAX_BYTES = 16_384;

export const ROOM_THEMES = ['standup', 'code_review', 'interview', 'free'] as const;
export type RoomTheme = (typeof ROOM_THEMES)[number];

export const ROOM_THEME_LABELS: Record<RoomTheme, string> = {
  standup: 'Stand-up',
  code_review: 'Code review',
  interview: 'Interview',
  free: 'Free talk',
};

/** Seconds a speaking timer can run. */
export const ROOM_TIMERS = [60, 90] as const;
export type RoomTimer = (typeof ROOM_TIMERS)[number];

/** Idea cards: short prompts to speak about, in simple English, for developer situations. */
export const ROOM_CARDS: Record<RoomTheme, readonly string[]> = {
  standup: [
    'What did you finish yesterday?',
    'What will you work on today?',
    'Is anything blocking you right now?',
    'Tell the team about a bug you fixed this week.',
    'Which task is taking longer than you planned? Why?',
    'Who do you need help from today, and with what?',
    'What did you learn yesterday that the team should know?',
    'Say your update in three short sentences: done, next, blocked.',
    'Tell us about a pull request you are waiting for.',
  ],
  code_review: [
    'Explain a change you made to a teammate who has not seen the code.',
    'How do you say "I do not agree" kindly in a code review?',
    'What do you check first when you open a pull request?',
    'Give feedback on a function with a name that is hard to understand.',
    'A test is failing on your branch. Explain what you think happened.',
    'How big should a pull request be? Say why.',
    'Someone asks you to rename a variable. How do you answer?',
    'Tell us about the best comment you ever got in a review.',
    'What makes code easy to read for you?',
  ],
  interview: [
    'Tell me about yourself and your work as a developer.',
    'Why do you want to work on this team?',
    'Describe a project you are proud of.',
    'Tell me about a time you made a mistake at work. What did you do?',
    'How do you learn a new tool or language?',
    'How do you explain a hard idea to someone who is not technical?',
    'What do you do when you are stuck on a problem?',
    'Where do you want to be in two years?',
    'Do you have any questions for us?',
  ],
  free: [
    'What is your favourite tool or editor, and why?',
    'Tell us about a bug that took you a very long time to find.',
    'What are you learning right now?',
    'Do you prefer working from home or in an office? Why?',
    'What was your first line of code?',
    'Which programming language would you like to learn next?',
    'Tell us about a small side project you like.',
    'What is one thing you wish you knew when you started?',
    'How do you relax after a long day of coding?',
  ],
};

export type RoomRole = 'host' | 'moderator' | 'member';
export const ROOM_SIGNAL_KINDS = ['offer', 'answer', 'candidate', 'bye'] as const;
export type RoomSignalKind = (typeof ROOM_SIGNAL_KINDS)[number];

/** What the person fills in to open a room. */
export interface RoomDraft {
  title: string;
  theme: RoomTheme;
  /** Null means any level. */
  level: Level | null;
}

export interface RoomPerson {
  id: string;
  displayName: string;
  hasAvatar: boolean;
  mascot: MascotId | null;
  level: Level;
  role: RoomRole;
}

/** A row of the room list. */
export interface LiveRoom {
  id: string;
  title: string;
  theme: RoomTheme;
  level: Level | null;
  hostName: string;
  people: Omit<RoomPerson, 'level' | 'role'>[];
}

/** Everything the window needs to draw the room the person is in. */
export interface RoomState {
  id: string;
  title: string;
  theme: RoomTheme;
  level: Level | null;
  /** Null only for an ended room whose host deleted their account before anyone could take over. */
  hostId: string | null;
  /** Set when the room has ended. */
  endedAt: string | null;
  /** The running speaking timer; null when none is running. */
  timer: { startedAt: string; seconds: RoomTimer } | null;
  /** Number of the idea card being shown. */
  card: number;
  me: { live: boolean; removed: boolean; role: RoomRole; muteRequestedAt: string | null };
  people: RoomPerson[];
}

/** What the window hears from the live room: a change, a signal from a peer, or the connection going down or coming back. */
export type RoomLiveEvent =
  | { kind: 'changed' }
  | { kind: 'signal'; from: string; signal: RoomSignalKind; payload: string }
  | { kind: 'online' | 'offline' };

/** A room copied into a report, as moderators see it. */
export interface RoomReportContext {
  title: string;
  theme: RoomTheme;
  hostName: string | null;
  createdAt: string;
  people: { name: string | null; joinedAt: string; leftAt: string | null }[];
}

/** The title to use: trimmed; null when shorter than 3 or longer than 60 characters. Counted in characters, as the database does. */
export function roomTitle(raw: string): string | null {
  const title = raw.trim();
  const length = Array.from(title).length;
  return length < ROOM_TITLE_MIN || length > ROOM_TITLE_MAX ? null : title;
}

/** The idea card for a number: they go round in a circle. `n` is 0 or more. */
export function cardFor(theme: RoomTheme, n: number): string {
  const cards = ROOM_CARDS[theme];
  return cards[Math.floor(n) % cards.length]!;
}

/** Whole seconds left on the timer, rounded up (0.8 s left shows 1); 0 when over; null when there is no timer. */
export function timerLeft(timer: RoomState['timer'], now: Date): number | null {
  if (!timer) return null;
  const endsAt = new Date(timer.startedAt).getTime() + timer.seconds * 1000;
  const left = Math.ceil((endsAt - now.getTime()) / 1000);
  if (Number.isNaN(left)) return 0;
  // Never negative, and never more than the whole timer if this clock is a little behind the server's.
  return Math.min(timer.seconds, Math.max(0, left));
}
