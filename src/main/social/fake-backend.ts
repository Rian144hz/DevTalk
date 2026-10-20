// In-memory community server for e2e tests and offline UI work (DEVTALK_FAKE_SOCIAL, never in packaged builds).
// It mirrors the database rules in supabase/migrations closely enough for the app to behave the same way.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { addDays, streaks, type DayActivity } from '../../core/progress/practice';
import { BADGE_LABELS, type ManualBadge } from '../../core/social/badges';
import { LEGAL_DOCUMENTS, LEGAL_VERSION } from '../../core/social/types';
import { MEMBER_PAGE_SIZE } from '../../core/social/people';
import { CHAT_PAGE, chatText } from '../../core/social/chat';
import type { ChatEvent, ChatMessage, ConversationSummary, ReportedMessage } from '../../core/social/chat';
import { ROOM_MAX, ROOM_SIGNAL_MAX_BYTES, ROOM_THEMES, roomTitle } from '../../core/social/rooms';
import type { LiveRoom, RoomLiveEvent, RoomPerson, RoomReportContext, RoomState, RoomTheme, RoomTimer } from '../../core/social/rooms';
import type { Level } from '../../core/domain/types';
import type { Badge, MemberRow, ModerationReport, NoticeKind, ProfileDraft, ReportInput, SocialProfile } from '../../core/social/types';
import type { MemberSummary, ModerationHistoryItem, Notice, PracticeGraphData, SocialBackend, SocialSession } from './backend';
import { SocialError } from './errors';
import type { SocialErrorKind } from './errors';

export const FAKE_CODE = '123456';
const DAY_MS = 86_400_000;
const REQUIRED = [...LEGAL_DOCUMENTS, 'age_18'];

interface StoredReport {
  id: number;
  reporter: string | null;
  reported: string | null;
  contextType: ReportInput['contextType'];
  contextId: string | null;
  reason: ReportInput['reason'];
  details: string;
  status: 'open' | 'dismissed' | 'actioned';
  createdAt: string;
}

interface StoredAction {
  target: string;
  action: 'warn' | 'suspend' | 'unsuspend' | 'grant_badge' | 'revoke_badge';
  reason: string;
  until: string | null;
  badge?: string;
  createdAt: string;
}

interface State {
  users: { id: string; email: string }[];
  session: SocialSession | null;
  consents: { userId: string; document: string; version: string; acceptedAt: string }[];
  profiles: Record<string, Omit<SocialProfile, 'hasAvatar' | 'hasBanner'>>;
  avatars: Record<string, string>; // base64 WebP
  blocks: { blocker: string; blocked: string }[];
  reports: StoredReport[];
  moderators: string[];
  actions: StoredAction[];
  notices: { id: number; userId: string; message: string; createdAt: string; readAt: string | null; kind?: NoticeKind; actor?: string | null }[];
  nextId: number;
  seeded: string[];
  createdAt: Record<string, string>;
  usesLinux: Record<string, boolean>;
  banners: Record<string, { ext: 'gif' | 'webp'; data: string }>;
  practiceDays: Record<string, DayActivity[]>;
  milestones: { userId: string; kind: 'level_up' | 'vocabulary'; value: string; at: string }[];
  badgeGrants: { userId: string; badge: string }[];
  follows: { follower: string; followee: string; at: string }[];
  likes: { liker: string; profile: string; at: string }[];
  conversations: StoredConversation[];
  messages: StoredMessage[];
  corrections: { id: number; messageId: number; author: string; corrected: string; createdAt: string; thankedAt: string | null }[];
  reads: { conversationId: string; userId: string; lastReadId: number }[];
  reportMessages: { reportId: number; messageId: number; sender: string | null; body: string; createdAt: string }[];
  rooms: StoredRoom[];
  roomSessions: StoredRoomSession[];
  /** When each session was last heard from (room_presence in the database). */
  roomSeen: Record<number, string>;
  /** Only who sent what, when: a signal is delivered live and not kept (the limit counts these). */
  roomSignals: { id: number; roomId: string; sender: string; recipient: string; createdAt: string }[];
}

interface StoredRoom {
  id: string;
  createdBy: string;
  host: string | null;
  title: string;
  theme: RoomTheme;
  level: Level | null;
  createdAt: string;
  endedAt: string | null;
  timerStartedAt: string | null;
  timerSeconds: RoomTimer | null;
  card: number;
}

interface StoredRoomSession {
  id: number;
  roomId: string;
  userId: string;
  role: 'member' | 'moderator';
  joinedAt: string;
  leftAt: string | null;
  removed: boolean;
  muteRequestedAt: string | null;
  /** The person's own microphone is off (set_room_muted). */
  muted: boolean;
  /** Seeded room people count as live whatever the time, so e2e can rely on them. */
  pinned?: true;
}

interface StoredConversation {
  id: string;
  a: string;
  b: string;
  requestedBy: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
  respondedAt: string | null;
  lastMessageAt: string;
}

interface StoredMessage {
  id: number;
  conversationId: string;
  sender: string;
  body: string;
  createdAt: string;
  deletedAt: string | null;
}

export interface FakeSocialOptions {
  /**
   * 'moderation': signed in as a moderator with open reports; 'people': signed in as member Rian among varied members,
   * with a live room, "Stand-up practice", hosted by Bia with Caio inside.
   */
  seed?: 'moderation' | 'people';
  /** Persist the state here so a relaunch keeps it (e2e restarts). */
  filePath?: string;
  /** Make one call fail with the given kind (e2e error paths). */
  fail?: Partial<Record<keyof SocialBackend, SocialErrorKind>>;
  now?: () => number;
}

export interface FakeSocialBackend extends SocialBackend {
  seededUserIds(): string[];
  noticesFor(userId: string): Notice[];
  suspendForTest(userId: string, until: string): void;
  addNoticeForTest(userId: string, message: string, extra?: { kind: NoticeKind; actor: string }): void;
  /** Every profile with its id (seeded and signed-up). */
  peopleForTest(): Promise<{ id: string; displayName: string }[]>;
  /** Adds `n` follows by `follower` made now, to reach the daily limit. */
  addFollowsForTest(follower: string, n: number): void;
  /** The other person writes in an accepted conversation (live events follow). */
  sendAsForTest(userId: string, conversationId: string, body: string): void;
  addModeratorForTest(userId: string): void;
  /** The sender of the corrected message thanks it (live events follow). */
  thankAsForTest(userId: string, correctionId: number): void;
  /**
   * Runs `act` as another member (a room host muting or removing the signed-in person, say) and switches back, even
   * when `act` throws. Live events flow as usual; the listeners stay. Keep `act` to calls of this backend: while it
   * waits, the other member is the one signed in.
   */
  actAsForTest(userId: string, act: (b: SocialBackend) => Promise<unknown>): Promise<unknown>;
}

const emptyState = (): State => ({
  users: [],
  session: null,
  consents: [],
  profiles: {},
  avatars: {},
  blocks: [],
  reports: [],
  moderators: [],
  actions: [],
  notices: [],
  nextId: 1,
  seeded: [],
  createdAt: {},
  usesLinux: {},
  banners: {},
  practiceDays: {},
  milestones: [],
  badgeGrants: [],
  follows: [],
  likes: [],
  conversations: [],
  messages: [],
  corrections: [],
  reads: [],
  reportMessages: [],
  rooms: [],
  roomSessions: [],
  roomSeen: {},
  roomSignals: [],
});

const LEVEL_ORDER = ['A2', 'B1', 'B2', 'C1', 'C2'];
/** A seat in a room is live while its person was heard from in the last 90 seconds. */
const SEAT_MS = 90_000;
const ROOM_SIGNAL_KINDS: readonly string[] = ['offer', 'answer', 'candidate', 'bye'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOUNDING_CUTOFF = Date.parse('2027-01-01T03:00:00Z'); // 2027-01-01 00:00 in São Paulo
const AREA_LABEL: Record<string, string> = { backend: 'Back end', frontend: 'Front end', mobile: 'Mobile', data: 'Data', devops: 'DevOps' };
const validMilestone = (kind: string, value: string) =>
  kind === 'vocabulary'
    ? value === '50' || value === '100'
    : /^(A2|B1|B2|C1|C2)>(A2|B1|B2|C1|C2)$/.test(value) &&
      LEVEL_ORDER.indexOf(value.split('>')[0]!) < LEVEL_ORDER.indexOf(value.split('>')[1]!);

const SEED_PROFILE: Omit<SocialProfile, 'id' | 'displayName' | 'hasAvatar' | 'suspendedUntil' | 'hasBanner'> = {
  nativeLanguage: 'Portuguese (Brazil)',
  level: 'B1',
  timezone: 'America/Sao_Paulo',
  area: 'backend',
  stack: ['python', 'java'],
  availability: [{ day: 2, from: '19:00', to: '21:00' }],
  bio: '',
  mainStack: ['python'],
  showProgress: true,
  mascot: null,
  listed: true,
};

export function createFakeSocialBackend(opts: FakeSocialOptions = {}): FakeSocialBackend {
  const now = opts.now ?? Date.now;
  const iso = (ms = now()) => new Date(ms).toISOString();
  let state: State = emptyState();
  if (opts.filePath && existsSync(opts.filePath)) {
    state = { ...emptyState(), ...(JSON.parse(readFileSync(opts.filePath, 'utf8')) as Partial<State>) };
  }
  const save = () => {
    if (opts.filePath) writeFileSync(opts.filePath, JSON.stringify(state));
  };
  const nextId = () => state.nextId++;
  const newUuid = () => `00000000-0000-4000-8000-${String(nextId()).padStart(12, '0')}`;

  const userByEmail = (email: string) => state.users.find((u) => u.email === email.toLowerCase());
  const createUser = (email: string) => {
    const user = { id: newUuid(), email: email.toLowerCase() };
    state.users.push(user);
    return user;
  };
  const acceptFor = (userId: string) => {
    for (const document of REQUIRED) {
      if (!state.consents.some((c) => c.userId === userId && c.document === document && c.version === LEGAL_VERSION)) {
        state.consents.push({ userId, document, version: LEGAL_VERSION, acceptedAt: iso() });
      }
    }
  };
  const putProfile = (id: string, displayName: string) => {
    state.profiles[id] = { id, displayName, ...SEED_PROFILE, suspendedUntil: null };
    state.createdAt[id] = iso();
  };
  const localToday = (timeZone: string) => {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(now()));
    } catch {
      return new Date(now()).toISOString().slice(0, 10);
    }
  };

  if (opts.seed === 'moderation' && state.users.length === 0) {
    const mod = createUser('mod@example.com');
    acceptFor(mod.id);
    putProfile(mod.id, 'Mod');
    state.moderators.push(mod.id);
    const sam = createUser('sam@example.com');
    acceptFor(sam.id);
    putProfile(sam.id, 'Sam');
    state.avatars[sam.id] = Buffer.from('RIFF-fake-webp').toString('base64');
    const alex = createUser('alex@example.com');
    acceptFor(alex.id);
    putProfile(alex.id, 'Alex');
    const kim = createUser('kim@example.com');
    acceptFor(kim.id);
    putProfile(kim.id, 'Kim');
    const base = { reporter: kim.id, contextType: 'profile' as const, contextId: null, status: 'open' as const };
    state.reports.push(
      { ...base, id: nextId(), reported: sam.id, reason: 'spam', details: 'Sends the same link to everyone.', createdAt: iso(now() - 2 * 3_600_000) },
      { ...base, id: nextId(), reported: alex.id, reason: 'harassment', details: 'Rude messages after I said no.', createdAt: iso(now() - 3_600_000) },
    );
    state.seeded = [sam.id, alex.id];
    state.badgeGrants.push({ userId: sam.id, badge: 'mentor' });
    const today = localToday(SEED_PROFILE.timezone);
    state.practiceDays[mod.id] = Array.from({ length: 10 }, (_, i) => ({ day: addDays(today, i - 9), answers: 1 + (i % 3), reviews: 4 * i }));
    state.session = { userId: mod.id, email: mod.email };
    save();
  }

  if (opts.seed === 'people' && state.users.length === 0) {
    const add = (name: string, over: Partial<SocialProfile> = {}) => {
      const user = createUser(`${name.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}@example.com`);
      acceptFor(user.id);
      putProfile(user.id, name);
      state.profiles[user.id] = { ...state.profiles[user.id]!, stack: [], mainStack: [], ...over };
      return user.id;
    };
    const rian = add('Rian', { level: 'B1', area: 'backend', stack: ['python'] });
    const p = {
      Ana: add('Ana', { level: 'A2', area: 'backend', stack: ['python'] }),
      Bia: add('Bia', { level: 'B1', area: 'frontend', stack: ['react'], mainStack: ['react'] }),
      Caio: add('Caio', { level: 'B2', area: 'data', stack: ['python'] }),
      Dani: add('Dani', { level: 'C1', area: 'devops', stack: ['docker'] }),
      Edu: add('Edu', { level: 'B1', area: 'mobile', stack: ['kotlin'], listed: false }),
      Fabi: add('Fabi', { level: 'B2', area: 'backend', suspendedUntil: '2999-01-01T00:00:00.000Z' }),
      Gil: add('Gil', { level: 'B1', area: 'backend' }),
      Hugo: add('Hugo', { level: 'C2', area: 'other', mascot: 'axolotl-2' }),
      Iris: add('Iris', { level: 'A2', area: 'frontend' }),
      João: add('João', { level: 'B1', area: 'data' }),
      Lia: add('Lia', { level: 'B2', area: 'mobile' }),
      Max: add('Max', { level: 'B1', area: 'backend' }),
    };
    const at = iso(now() - 3 * DAY_MS);
    const ties: [keyof typeof p, string][] = [['Ana', p.Bia], ['Caio', p.Bia], ['Fabi', p.Bia], ['Gil', p.Bia], ['Edu', p.Max], ['Hugo', rian]];
    for (const [follower, followee] of ties) state.follows.push({ follower: p[follower], followee, at });
    state.blocks.push({ blocker: p.Gil, blocked: rian });
    state.notices.push({ id: nextId(), userId: rian, message: 'Hugo followed you.', createdAt: at, readAt: null, kind: 'follow', actor: p.Hugo });
    // Chat: an open conversation with Bia (Rian has not read her last message) and a request from Ana.
    const talk = (x: string, y: string, requestedBy: string, status: StoredConversation['status'], ms: number) => {
      const c: StoredConversation = {
        id: newUuid(), a: x < y ? x : y, b: x < y ? y : x, requestedBy, status,
        createdAt: iso(ms), respondedAt: status === 'pending' ? null : iso(ms), lastMessageAt: iso(ms),
      };
      state.conversations.push(c);
      return c;
    };
    const say = (c: StoredConversation, sender: string, body: string, ms: number) => {
      const id = nextId();
      state.messages.push({ id, conversationId: c.id, sender, body, createdAt: iso(ms), deletedAt: null });
      c.lastMessageAt = iso(ms);
      return id;
    };
    const t0 = now() - 2 * DAY_MS - 3 * 3_600_000;
    const withBia = talk(rian, p.Bia, rian, 'accepted', t0);
    say(withBia, rian, 'Hi Bia! Do you want to practise English this week?', t0);
    say(withBia, p.Bia, 'Yes! I am free on Thursday evening.', t0 + 10 * 60_000);
    const meeting = say(withBia, rian, 'Yesterday I have a long meeting about our API.', t0 + 20 * 60_000);
    state.corrections.push({
      id: nextId(), messageId: meeting, author: p.Bia, corrected: 'Yesterday I had a long meeting about our API.',
      createdAt: iso(t0 + 25 * 60_000), thankedAt: null,
    });
    const last = say(withBia, p.Bia, 'How was the meeting? Did you show the new endpoints?', t0 + 30 * 60_000);
    state.reads.push({ conversationId: withBia.id, userId: rian, lastReadId: meeting }, { conversationId: withBia.id, userId: p.Bia, lastReadId: last });
    const fromAna = talk(p.Ana, rian, p.Ana, 'pending', now() - 3_600_000);
    say(fromAna, p.Ana, 'Hi Rian! Can we practise Python interview questions in English?', now() - 3_600_000);
    // Rooms: Bia hosts "Stand-up practice" with Caio inside. Seeded room people stay live whatever the time.
    const standup: StoredRoom = {
      id: newUuid(), createdBy: p.Bia, host: p.Bia, title: 'Stand-up practice', theme: 'standup', level: 'B1',
      createdAt: iso(now() - 10 * 60_000), endedAt: null, timerStartedAt: null, timerSeconds: null, card: 0,
    };
    state.rooms.push(standup);
    for (const [userId, ago] of [[p.Bia, 10], [p.Caio, 8]] as const) {
      const entry: StoredRoomSession = {
        id: nextId(), roomId: standup.id, userId, role: 'member', joinedAt: iso(now() - ago * 60_000), leftAt: null, removed: false,
        muteRequestedAt: null, muted: false, pinned: true,
      };
      state.roomSessions.push(entry);
      state.roomSeen[entry.id] = entry.joinedAt;
    }
    state.seeded = Object.values(p);
    state.session = { userId: rian, email: 'rian@example.com' };
    save();
  }

  const failIf = (name: keyof SocialBackend) => {
    const kind = opts.fail?.[name];
    if (kind) throw new SocialError(kind, `Injected failure: ${kind}`);
  };
  const me = (): SocialSession => {
    if (!state.session) throw new SocialError('not_signed_in', 'Sign in first.');
    return state.session;
  };
  const suspendedUntil = (userId: string): string | null => {
    const until = state.profiles[userId]?.suspendedUntil ?? null;
    if (!until) return null;
    return until === 'infinity' || Date.parse(until) > now() ? until : null;
  };
  const isActive = (userId: string) => suspendedUntil(userId) === null;
  const isModerator = (userId: string) => state.moderators.includes(userId);
  const blockedBetween = (a: string, b: string) =>
    state.blocks.some((k) => (k.blocker === a && k.blocked === b) || (k.blocker === b && k.blocked === a));
  const assertActive = (userId: string) => {
    const until = suspendedUntil(userId);
    if (until) throw new SocialError('suspended', `Suspended until ${until}`, until);
  };
  /** Mirrors viewer_is_member(): active and the documents accepted. */
  const assertMember = (userId: string) => {
    if (!hasAccepted(userId)) throw new SocialError('forbidden', 'Accept the community rules first.');
    assertActive(userId);
  };
  const assertModerator = () => {
    if (!isModerator(me().userId)) throw new SocialError('forbidden', 'Only moderators can do this.');
  };
  const hasAccepted = (userId: string) =>
    REQUIRED.every((d) => state.consents.some((c) => c.userId === userId && c.document === d && c.version === LEGAL_VERSION));
  const toProfile = (p: Omit<SocialProfile, 'hasAvatar' | 'hasBanner'>): SocialProfile => ({
    ...p,
    hasAvatar: p.id in state.avatars,
    hasBanner: p.id in state.banners,
  });
  /** Mirrors can_see_profile (moderators see everyone). */
  const canSee = (viewer: string, target: string) =>
    viewer === target ||
    isModerator(viewer) ||
    (isActive(viewer) && hasAccepted(viewer) && isActive(target) && !blockedBetween(viewer, target) && target in state.profiles);
  /** Mirrors can_see_progress. */
  const canSeeProgress = (viewer: string, target: string) =>
    viewer === target ||
    (isActive(viewer) && hasAccepted(viewer) && isActive(target) && !blockedBetween(viewer, target) && !!state.profiles[target]?.showProgress);
  const streakOf = (target: string) => {
    const tz = state.profiles[target]?.timezone ?? 'UTC';
    return streaks(state.practiceDays[target] ?? [], localToday(tz));
  };
  const noticesFor = (userId: string): Notice[] =>
    state.notices
      .filter((n) => n.userId === userId)
      .map((n) => ({
        id: n.id,
        message: n.message,
        createdAt: n.createdAt,
        read: n.readAt !== null,
        kind: n.kind ?? 'moderation',
        actor: n.actor && state.profiles[n.actor]
          ? { id: n.actor, displayName: state.profiles[n.actor]!.displayName, hasAvatar: n.actor in state.avatars, mascot: state.profiles[n.actor]!.mascot }
          : null,
      }));
  /** Mirrors counts_for_viewer(): not suspended and no block with the caller. */
  const countsFor = (viewer: string, other: string) => isActive(other) && !blockedBetween(viewer, other);
  /** Mirrors can_see_profile() (no moderator exception) plus "has a profile". */
  const canReach = (viewer: string, target: string) =>
    isActive(viewer) && hasAccepted(viewer) && isActive(target) && !blockedBetween(viewer, target) && target in state.profiles;
  const isViewerMember = (viewer: string) => isActive(viewer) && hasAccepted(viewer);
  const rowOf = (id: string): MemberRow => {
    const p = state.profiles[id]!;
    return { id, displayName: p.displayName, level: p.level, area: p.area, mainStack: [...p.mainStack], mascot: p.mascot, hasAvatar: id in state.avatars };
  };
  const byName = (a: MemberRow, b: MemberRow) => a.displayName.localeCompare(b.displayName, 'en') || a.id.localeCompare(b.id);
  const pageOf = <T,>(rows: T[], page: number) => {
    const start = Math.max(0, Math.trunc(page)) * MEMBER_PAGE_SIZE;
    return rows.slice(start, start + MEMBER_PAGE_SIZE);
  };
  const assertCanTie = (viewer: string, target: string, what: string) => {
    if (viewer === target) throw new SocialError('forbidden', `You cannot ${what} yourself.`);
    if (!(viewer in state.profiles) || !canReach(viewer, target)) throw new SocialError('forbidden', 'new row violates row-level security policy');
  };
  const recentCount = (rows: { at: string }[]) => rows.filter((r) => Date.parse(r.at) > now() - DAY_MS).length;

  // Chat (mirrors 0008_chat.sql).
  const convOf = (id: string) => state.conversations.find((c) => c.id === id);
  const otherIn = (c: StoredConversation, viewer: string) => (c.a === viewer ? c.b : c.a);
  /** Mirrors can_read_conversation(). */
  const canRead = (viewer: string, c: StoredConversation | undefined): c is StoredConversation =>
    !!c && isViewerMember(viewer) && (c.a === viewer || c.b === viewer) && !blockedBetween(c.a, c.b);
  const canWrite = (viewer: string, c: StoredConversation | undefined): c is StoredConversation =>
    canRead(viewer, c) && c.status === 'accepted';
  /** Mirrors the conversations policy: a declined request is hidden from the person who asked. */
  const seesRow = (viewer: string, c: StoredConversation) => canRead(viewer, c) && (c.status !== 'declined' || c.requestedBy !== viewer);
  const listeners: { viewer: string; onEvent: (e: ChatEvent) => void }[] = [];
  const emit = (kind: ChatEvent['kind'], c: StoredConversation) => {
    for (const l of [...listeners]) {
      if (kind === 'conversation' ? seesRow(l.viewer, c) : canRead(l.viewer, c)) l.onEvent({ kind, conversationId: c.id });
    }
  };
  const textOrFail = (raw: string) => {
    const text = chatText(raw);
    if (text === null) throw new SocialError('unknown', 'Write 1 to 2000 characters.');
    return text;
  };
  const rlsDenied = () => new SocialError('forbidden', 'new row violates row-level security policy');
  const notAllowed = () => new SocialError('forbidden', 'not allowed');
  const assertMessageRoom = (sender: string) => {
    if (state.messages.filter((m) => m.sender === sender && Date.parse(m.createdAt) > now() - DAY_MS).length >= 500) {
      throw new SocialError('rate_limited', 'message limit reached');
    }
  };
  const addMessage = (c: StoredConversation, sender: string, body: string) => {
    assertMessageRoom(sender);
    const m: StoredMessage = { id: nextId(), conversationId: c.id, sender, body, createdAt: iso(), deletedAt: null };
    state.messages.push(m);
    c.lastMessageAt = m.createdAt;
  };
  const toChatMessage = (m: StoredMessage): ChatMessage => ({
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.sender,
    body: m.body,
    createdAt: m.createdAt,
    deleted: m.deletedAt !== null,
    corrections: state.corrections
      .filter((k) => k.messageId === m.id)
      .map((k) => ({ id: k.id, messageId: k.messageId, authorId: k.author, corrected: k.corrected, createdAt: k.createdAt, thanked: k.thankedAt !== null })),
  });
  /** Mirrors count_correction(): +1 on the author's day in their profile's time zone. */
  const countCorrection = (author: string) => {
    const day = localToday(state.profiles[author]?.timezone ?? 'UTC');
    const days = state.practiceDays[author] ?? [];
    const d = days.find((x) => x.day === day);
    if (d) d.corrections = Math.min((d.corrections ?? 0) + 1, 2000);
    else days.push({ day, answers: 0, reviews: 0, corrections: 1 });
    state.practiceDays[author] = days.sort((x, y) => x.day.localeCompare(y.day));
  };

  // Rooms (mirrors 0009_rooms.sql).
  const roomListeners: { viewer: string; roomId: string; onEvent: (e: RoomLiveEvent) => void }[] = [];
  const roomById = (id: string) => state.rooms.find((r) => r.id === id);
  const sessionsIn = (roomId: string) => state.roomSessions.filter((s) => s.roomId === roomId);
  const byJoin = (a: StoredRoomSession, b: StoredRoomSession) => a.joinedAt.localeCompare(b.joinedAt) || a.id - b.id;
  const seenAt = (s: StoredRoomSession) => state.roomSeen[s.id] ?? s.joinedAt;
  /** Mirrors room_session_live(): open, and heard from in the last 90 seconds. */
  const sessionLive = (s: StoredRoomSession) => s.leftAt === null && (s.pinned === true || Date.parse(seenAt(s)) > now() - SEAT_MS);
  /** Mirrors room_left_at(): a session closes now while it is live, else at its last sign of life. */
  const leftAtOf = (s: StoredRoomSession) => (sessionLive(s) ? iso() : seenAt(s));
  const liveIn = (roomId: string) => sessionsIn(roomId).filter(sessionLive).sort(byJoin);
  const isLiveIn = (roomId: string, userId: string) => sessionsIn(roomId).some((s) => s.userId === userId && sessionLive(s));
  /** Mirrors viewer_in_room(): a member who is live in the room. */
  const viewerIn = (roomId: string, viewer: string) => isViewerMember(viewer) && isLiveIn(roomId, viewer);
  const addSession = (roomId: string, userId: string) => {
    const entry: StoredRoomSession = {
      id: nextId(), roomId, userId, role: 'member', joinedAt: iso(), leftAt: null, removed: false, muteRequestedAt: null, muted: false,
    };
    state.roomSessions.push(entry);
    state.roomSeen[entry.id] = entry.joinedAt;
  };
  const dropSignals = (roomId: string) => {
    state.roomSignals = state.roomSignals.filter((g) => g.roomId !== roomId);
  };
  /**
   * Mirrors room_settle(): silent seats close at their last sign of life; a host who is gone hands the room to the
   * oldest live room moderator, else the earliest live member; a room with nobody live ends and its signals go.
   */
  const settle = (roomId: string) => {
    const r = roomById(roomId);
    if (!r || r.endedAt !== null) return;
    for (const s of sessionsIn(roomId)) if (s.leftAt === null && !sessionLive(s)) s.leftAt = seenAt(s);
    if (r.host && isLiveIn(roomId, r.host)) return;
    const heir = liveIn(roomId).sort((a, b) => Number(b.role === 'moderator') - Number(a.role === 'moderator') || byJoin(a, b))[0];
    if (heir) {
      r.host = heir.userId;
      return;
    }
    r.endedAt = iso();
    r.timerStartedAt = null;
    r.timerSeconds = null;
    dropSignals(roomId);
  };
  /** Mirrors room_close_session(). */
  const closeSession = (roomId: string, userId: string) => {
    for (const s of sessionsIn(roomId)) if (s.userId === userId && s.leftAt === null) s.leftAt = leftAtOf(s);
    settle(roomId);
  };
  /** What a room looks like to Realtime: the room row and its sessions. */
  const roomSnapshot = (roomId: string) => ({
    room: JSON.stringify(roomById(roomId) ?? null),
    sessions: new Map(sessionsIn(roomId).map((s) => [s.id, JSON.stringify(s)] as const)),
  });
  /**
   * Runs a change to one room and tells the room. Realtime sends a change only when a row changes: people live in the
   * room hear it, and so does anyone whose own session changed (a person just removed, muted or sent out). A change
   * that alters nothing, such as a heartbeat, tells nobody.
   */
  const touch = <T,>(roomId: string, change: () => T): T => {
    const before = roomSnapshot(roomId);
    const result = change();
    const after = roomSnapshot(roomId);
    const heard = new Set(liveIn(roomId).map((s) => s.userId));
    let changed = after.room !== before.room;
    // A session that changed or disappeared is a change; the person it belongs to hears of it, live or not.
    for (const [id, json] of before.sessions) {
      if (after.sessions.get(id) !== json) changed = true;
    }
    for (const s of sessionsIn(roomId)) {
      if (before.sessions.get(s.id) !== JSON.stringify(s)) {
        changed = true;
        heard.add(s.userId);
      }
    }
    if (changed) {
      for (const l of [...roomListeners]) {
        if (l.roomId === roomId && heard.has(l.viewer) && isViewerMember(l.viewer)) l.onEvent({ kind: 'changed' });
      }
    }
    return result;
  };
  /** Mirrors room_close_others(): closes the person's open seats in every room but `keep`. */
  const closeOthers = (userId: string, keep: string | null) => {
    for (const roomId of new Set(state.roomSessions.filter((s) => s.userId === userId && s.leftAt === null && s.roomId !== keep).map((s) => s.roomId))) {
      touch(roomId, () => closeSession(roomId, userId));
    }
  };
  const personBase = (id: string) => ({ id, displayName: state.profiles[id]!.displayName, hasAvatar: id in state.avatars, mascot: state.profiles[id]!.mascot });
  /** The host of a room that has not ended; the room moderators' and host's powers are checked against it. */
  const openHost = (roomId: string) => {
    const r = roomById(roomId);
    return r && r.endedAt === null ? r.host : null;
  };
  const liveRole = (roomId: string, userId: string) =>
    sessionsIn(roomId).find((s) => s.userId === userId && s.leftAt === null && sessionLive(s))?.role ?? null;
  /** Mirrors the checks of make_room_moderator(), remove_room_moderator() and pass_host(): only the host, live, towards someone else live. */
  const hostActsOn = (roomId: string, viewer: string, userId: string) => {
    const r = roomById(roomId);
    if (!r || r.endedAt !== null || r.host !== viewer || !viewerIn(roomId, viewer) || userId === viewer || !isLiveIn(roomId, userId)) throw notAllowed();
    return r;
  };
  const setRole = (roomId: string, userId: string, role: StoredRoomSession['role']) => {
    for (const s of sessionsIn(roomId)) if (s.userId === userId && s.leftAt === null && s.role !== role) s.role = role;
  };
  const endOf = (s: StoredRoomSession) => Date.parse(s.leftAt ?? seenAt(s));

  const backend: FakeSocialBackend = {
    configured: true,

    async sendCode(email) {
      failIf('sendCode');
    },

    async verifyCode(email, code) {
      failIf('verifyCode');
      if (code !== FAKE_CODE) throw new SocialError('invalid_code', 'Token has expired or is invalid');
      const user = userByEmail(email) ?? createUser(email);
      state.session = { userId: user.id, email: user.email };
      save();
      return state.session;
    },

    async session() {
      return state.session;
    },

    async signOut() {
      failIf('signOut');
      state.session = null;
      listeners.length = 0;
      roomListeners.length = 0;
      save();
    },

    async hasAcceptedCurrentDocuments() {
      return hasAccepted(me().userId);
    },

    async acceptDocuments() {
      failIf('acceptDocuments');
      acceptFor(me().userId);
      save();
    },

    async getOwnProfile() {
      failIf('getOwnProfile');
      const p = state.profiles[me().userId];
      return p ? toProfile(p) : null;
    },

    async saveProfile(draft: ProfileDraft) {
      failIf('saveProfile');
      const { userId } = me();
      if (!hasAccepted(userId)) throw new SocialError('forbidden', 'Accept the documents first.');
      assertActive(userId);
      state.profiles[userId] = { ...draft, id: userId, suspendedUntil: state.profiles[userId]?.suspendedUntil ?? null };
      state.createdAt[userId] ??= iso();
      save();
      return toProfile(state.profiles[userId]);
    },

    async uploadAvatar(webp) {
      failIf('uploadAvatar');
      const { userId } = me();
      assertActive(userId);
      state.avatars[userId] = Buffer.from(webp).toString('base64');
      save();
    },

    async removeAvatar() {
      delete state.avatars[me().userId];
      save();
    },

    async avatarDataUrl(userId) {
      const viewer = me().userId;
      const data = state.avatars[userId];
      if (!data) return null;
      const member = isActive(viewer) && hasAccepted(viewer);
      const visible =
        userId === viewer || (member && (isModerator(viewer) || (isActive(userId) && !blockedBetween(viewer, userId))));
      return visible ? `data:image/webp;base64,${data}` : null;
    },

    async block(userId) {
      const { userId: blocker } = me();
      if (userId === blocker) throw new SocialError('forbidden', 'You cannot block yourself.');
      assertMember(blocker);
      if (!state.blocks.some((k) => k.blocker === blocker && k.blocked === userId)) {
        state.blocks.push({ blocker, blocked: userId });
        // Mirrors leave_rooms_on_block(): the blocker leaves a room where the blocked person is live. Never the other way round.
        const shared = state.roomSessions.filter((s) => s.userId === blocker && s.leftAt === null && isLiveIn(s.roomId, userId));
        for (const s of shared) touch(s.roomId, () => closeSession(s.roomId, blocker));
      }
      // Mirrors clear_ties_on_block(): follows and likes between the two end, both ways.
      const pair = (a: string, b: string) => (a === blocker && b === userId) || (a === userId && b === blocker);
      state.follows = state.follows.filter((f) => !pair(f.follower, f.followee));
      state.likes = state.likes.filter((l) => !pair(l.liker, l.profile));
      save();
    },

    async unblock(userId) {
      const { userId: blocker } = me();
      state.blocks = state.blocks.filter((k) => !(k.blocker === blocker && k.blocked === userId));
      save();
    },

    async listBlocks() {
      const { userId } = me();
      return state.blocks.filter((k) => k.blocker === userId).map((k) => k.blocked);
    },

    async report(input) {
      failIf('report');
      const { userId } = me();
      if (input.reported === userId) throw new SocialError('forbidden', 'You cannot report yourself.');
      if (!hasAccepted(userId)) throw new SocialError('forbidden', 'Accept the community rules first.');
      assertActive(userId);
      const recent = state.reports.filter((r) => r.reporter === userId && Date.parse(r.createdAt) > now() - DAY_MS);
      if (recent.length >= 20) throw new SocialError('rate_limited', 'report limit reached');
      const id = nextId();
      state.reports.push({ ...input, id, reporter: userId, status: 'open', createdAt: iso() });
      // Mirrors snapshot_reported_message(): the message and the 10 before it, when the reporter and the reported
      // member are the two people in the conversation.
      const target = input.contextType === 'message' && /^[0-9]{1,18}$/.test(input.contextId ?? '')
        ? state.messages.find((m) => m.id === Number(input.contextId))
        : undefined;
      const c = target && convOf(target.conversationId);
      if (target && c && (c.a === userId || c.b === userId) && (c.a === input.reported || c.b === input.reported)) {
        for (const m of state.messages.filter((x) => x.conversationId === c.id && x.id <= target.id).slice(-11)) {
          state.reportMessages.push({ reportId: id, messageId: m.id, sender: m.sender, body: m.body, createdAt: m.createdAt });
        }
      }
      save();
    },

    async listNotices() {
      return noticesFor(me().userId);
    },

    async markNoticeRead(id) {
      const { userId } = me();
      const n = state.notices.find((x) => x.id === id && x.userId === userId);
      if (n && !n.readAt) n.readAt = iso();
      save();
    },

    async isModerator() {
      return state.session ? isModerator(state.session.userId) : false;
    },

    async listOpenReports(): Promise<ModerationReport[]> {
      assertModerator();
      return state.reports
        .filter((r) => r.status === 'open')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((r) => {
          const p = r.reported ? state.profiles[r.reported] : undefined;
          return {
            id: r.id,
            reporter: r.reporter ?? '',
            reported: r.reported
              ? { id: r.reported, displayName: p?.displayName ?? 'Deleted account', mascot: p?.mascot ?? null, hasAvatar: r.reported in state.avatars }
              : null,
            contextType: r.contextType,
            contextId: r.contextId,
            reason: r.reason,
            details: r.details,
            createdAt: r.createdAt,
          };
        });
    },

    async actionsAbout(userId): Promise<ModerationHistoryItem[]> {
      assertModerator();
      return state.actions
        .filter((a) => a.target === userId)
        .reverse()
        .map((a) => ({ action: a.action, reason: a.reason, until: a.until, badge: a.badge ?? null, createdAt: a.createdAt }));
    },

    async decide(decision) {
      failIf('decide');
      assertModerator();
      const close = (reportId: number | null, status: 'dismissed' | 'actioned') => {
        const r = state.reports.find((x) => x.id === reportId);
        if (r && r.status === 'open') r.status = status;
      };
      if (decision.kind === 'dismiss') {
        close(decision.reportId, 'dismissed');
      } else if (decision.kind === 'warn') {
        state.actions.push({ target: decision.target, action: 'warn', reason: decision.message, until: null, createdAt: iso() });
        state.notices.push({ id: nextId(), userId: decision.target, message: decision.message, createdAt: iso(), readAt: null });
        close(decision.reportId, 'actioned');
      } else if (decision.kind === 'suspend') {
        const until = decision.days === null ? 'infinity' : iso(now() + decision.days * DAY_MS);
        state.actions.push({ target: decision.target, action: 'suspend', reason: decision.reason, until, createdAt: iso() });
        const p = state.profiles[decision.target];
        if (p) p.suspendedUntil = until;
        close(decision.reportId, 'actioned');
      } else {
        state.actions.push({ target: decision.target, action: 'unsuspend', reason: '', until: null, createdAt: iso() });
        const p = state.profiles[decision.target];
        if (p) p.suspendedUntil = null;
      }
      save();
    },

    async exportOwnData() {
      failIf('exportOwnData');
      const { userId, email } = me();
      const p = state.profiles[userId];
      return {
        exportedAt: iso(),
        account: { email },
        profile: p ? toProfile(p) : null,
        consents: state.consents.filter((c) => c.userId === userId).map(({ userId: _u, ...c }) => c),
        blocks: state.blocks.filter((k) => k.blocker === userId).map((k) => ({ blocked: k.blocked })),
        reportsMade: state.reports.filter((r) => r.reporter === userId).map(({ reporter: _r, ...r }) => r),
        notices: noticesFor(userId),
        moderationActions: state.actions
          .filter((a) => a.target === userId)
          .reverse()
          .map((a) => ({ action: a.action, reason: a.reason, until: a.until, badge: a.badge ?? null, created_at: a.createdAt })),
        avatarUrl: userId in state.avatars ? 'fake://avatars/avatar.webp' : null,
        bannerUrl: state.banners[userId] ? `fake://banners/banner.${state.banners[userId]!.ext}` : null,
        usesLinux: state.usesLinux[userId] ?? false,
        badges: await this.badges(userId),
        social: {
          following: state.follows.filter((f) => f.follower === userId).map((f) => ({ id: f.followee, at: f.at })),
          followers: state.follows.filter((f) => f.followee === userId).map((f) => ({ id: f.follower, at: f.at })),
          likesGiven: state.likes.filter((l) => l.liker === userId).map((l) => ({ id: l.profile, at: l.at })),
        },
        chat: {
          conversations: state.conversations
            .filter((c) => c.a === userId || c.b === userId)
            .map((c) => ({
              id: c.id,
              with: otherIn(c, userId),
              status: c.status === 'declined' && c.requestedBy === userId ? 'pending' : c.status,
              requestedByMe: c.requestedBy === userId,
              startedAt: c.createdAt,
            })),
          messagesSent: state.messages
            .filter((m) => m.sender === userId)
            .map((m) => ({ id: m.id, conversationId: m.conversationId, body: m.body, createdAt: m.createdAt, deleted: m.deletedAt !== null })),
          correctionsGiven: state.corrections
            .filter((k) => k.author === userId)
            .map((k) => ({ messageId: k.messageId, corrected: k.corrected, createdAt: k.createdAt, thanked: k.thankedAt !== null })),
        },
        progress: {
          practiceDays: (state.practiceDays[userId] ?? []).map((d) => ({ ...d })),
          milestones: state.milestones.filter((m) => m.userId === userId).map((m) => ({ kind: m.kind, value: m.value, achievedAt: m.at })),
        },
        // Mirrors my_rooms_export(): the rooms you opened and your own sessions; other people's sessions are theirs.
        rooms: {
          roomsCreated: state.rooms
            .filter((r) => r.createdBy === userId)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
            .map((r) => ({ id: r.id, title: r.title, theme: r.theme, createdAt: r.createdAt, endedAt: r.endedAt })),
          sessions: state.roomSessions
            .filter((s) => s.userId === userId)
            .sort((a, b) => a.id - b.id)
            .map((s) => ({ roomId: s.roomId, joinedAt: s.joinedAt, leftAt: s.leftAt, role: s.role, removed: s.removed })),
        },
      };
    },

    async deleteAccount() {
      failIf('deleteAccount');
      const { userId } = me();
      state.users = state.users.filter((u) => u.id !== userId);
      state.consents = state.consents.filter((c) => c.userId !== userId);
      delete state.profiles[userId];
      delete state.avatars[userId];
      delete state.banners[userId];
      delete state.practiceDays[userId];
      state.milestones = state.milestones.filter((m) => m.userId !== userId);
      state.badgeGrants = state.badgeGrants.filter((g) => g.userId !== userId);
      state.blocks = state.blocks.filter((k) => k.blocker !== userId && k.blocked !== userId);
      state.moderators = state.moderators.filter((m) => m !== userId);
      state.notices = state.notices.filter((n) => n.userId !== userId && n.actor !== userId);
      state.follows = state.follows.filter((f) => f.follower !== userId && f.followee !== userId);
      state.likes = state.likes.filter((l) => l.liker !== userId && l.profile !== userId);
      const goneConversations = new Set(
        state.conversations.filter((c) => c.a === userId || c.b === userId || c.requestedBy === userId).map((c) => c.id),
      );
      state.conversations = state.conversations.filter((c) => !goneConversations.has(c.id));
      const goneMessages = new Set(state.messages.filter((m) => goneConversations.has(m.conversationId) || m.sender === userId).map((m) => m.id));
      state.messages = state.messages.filter((m) => !goneMessages.has(m.id));
      state.corrections = state.corrections.filter((k) => !goneMessages.has(k.messageId) && k.author !== userId);
      state.reads = state.reads.filter((r) => !goneConversations.has(r.conversationId) && r.userId !== userId);
      for (const x of state.reportMessages) if (x.sender === userId) x.sender = null;
      // Mirrors the cascades of 0009: the rooms you opened go with their sessions and signals. In any other room you
      // leave; a host role you held goes to the next in line, and a room nobody is live in ends.
      const goneRooms = new Set(state.rooms.filter((r) => r.createdBy === userId).map((r) => r.id));
      state.rooms = state.rooms.filter((r) => !goneRooms.has(r.id));
      state.roomSessions = state.roomSessions.filter((s) => !goneRooms.has(s.roomId));
      state.roomSignals = state.roomSignals.filter((g) => !goneRooms.has(g.roomId) && g.sender !== userId && g.recipient !== userId);
      for (const r of state.rooms) if (r.host === userId) r.host = null;
      for (const roomId of new Set(state.roomSessions.filter((s) => s.userId === userId).map((s) => s.roomId))) {
        touch(roomId, () => {
          state.roomSessions = state.roomSessions.filter((s) => !(s.roomId === roomId && s.userId === userId));
          settle(roomId);
        });
      }
      const keptSessions = new Set(state.roomSessions.map((s) => String(s.id)));
      state.roomSeen = Object.fromEntries(Object.entries(state.roomSeen).filter(([id]) => keptSessions.has(id)));
      listeners.length = 0;
      roomListeners.length = 0;
      for (const r of state.reports) {
        if (r.reporter === userId) r.reporter = null;
        if (r.reported === userId) r.reported = null;
      }
      state.session = null;
      save();
    },

    async badges(userId): Promise<Badge[]> {
      failIf('badges');
      const viewer = me().userId;
      const p = state.profiles[userId];
      if (!p || !canSee(viewer, userId)) return [];
      const out: Badge[] = [];
      const add = (id: string, group: Badge['group'], label = BADGE_LABELS[id] ?? id, detail: string | null = null) =>
        out.push({ id, group, label, detail });
      if (state.badgeGrants.some((g) => g.userId === userId && g.badge === 'creator')) add('creator', 'community');
      if (isModerator(userId)) add('moderator', 'community');
      if (Date.parse(state.createdAt[userId] ?? iso()) < FOUNDING_CUTOFF) add('founding_member', 'community');
      for (const b of ['beta_tester', 'mentor', 'open_source']) {
        if (state.badgeGrants.some((g) => g.userId === userId && g.badge === b)) add(b, 'community');
      }
      // Room host: 5 rooms opened where someone else had a session. Active speaker: 10 sessions of 5+ minutes that
      // overlapped another person's session by 5+ minutes. A session still open ends at its last sign of life.
      const FIVE_MINUTES = 5 * 60_000;
      const hosted = state.rooms.filter((r) => r.createdBy === userId && state.roomSessions.some((s) => s.roomId === r.id && s.userId !== userId));
      if (hosted.length >= 5) add('room_host', 'community');
      const speaking = state.roomSessions.filter(
        (s) =>
          s.userId === userId &&
          endOf(s) - Date.parse(s.joinedAt) >= FIVE_MINUTES &&
          state.roomSessions.some(
            (o) => o.roomId === s.roomId && o.userId !== userId && Math.min(endOf(s), endOf(o)) - Math.max(Date.parse(s.joinedAt), Date.parse(o.joinedAt)) >= FIVE_MINUTES,
          ),
      );
      if (speaking.length >= 10) add('active_speaker', 'community');
      if (p.area !== 'other') add(`area:${p.area}`, 'technical', AREA_LABEL[p.area]!);
      if (state.usesLinux[userId]) add('linux', 'technical');
      for (const t of p.mainStack) add(`lang:${t}`, 'language', t);
      if (viewer === userId || p.showProgress) {
        const { current } = streakOf(userId);
        if (current >= 30) add('streak_30', 'evolution', BADGE_LABELS['streak_30'], String(current));
        else if (current >= 7) add('streak_7', 'evolution', BADGE_LABELS['streak_7'], String(current));
        const levels = state.milestones.filter((m) => m.userId === userId && m.kind === 'level_up');
        const last = levels[levels.length - 1];
        if (last) add('level_up', 'evolution', last.value.replace('>', ' → '), last.value);
        const tiers = state.milestones.filter((m) => m.userId === userId && m.kind === 'vocabulary').map((m) => Number(m.value));
        if (tiers.length) add('vocabulary', 'evolution', BADGE_LABELS['vocabulary'], `${Math.max(...tiers)}+`);
      }
      return out;
    },

    async practiceGraph(userId): Promise<PracticeGraphData> {
      failIf('practiceGraph');
      if (!canSeeProgress(me().userId, userId)) return { days: [], current: 0, longest: 0 };
      return { days: [...(state.practiceDays[userId] ?? [])], ...streakOf(userId) };
    },

    async publishPracticeDays(days) {
      failIf('publishPracticeDays');
      const { userId } = me();
      assertMember(userId);
      const byDay = new Map((state.practiceDays[userId] ?? []).map((d) => [d.day, d]));
      // Corrections are counted by the server, never published by the app.
      for (const d of days) {
        const kept = byDay.get(d.day)?.corrections;
        byDay.set(d.day, { day: d.day, answers: d.answers, reviews: d.reviews, ...(kept ? { corrections: kept } : {}) });
      }
      state.practiceDays[userId] = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
      save();
    },

    async publishMilestone(kind, value) {
      failIf('publishMilestone');
      const { userId } = me();
      assertMember(userId);
      if (!validMilestone(kind, value)) throw new SocialError('unknown', 'This milestone value is not allowed.');
      if (!state.milestones.some((m) => m.userId === userId && m.kind === kind && m.value === value)) {
        state.milestones.push({ userId, kind, value, at: iso() });
      }
      save();
    },

    async setUsesLinux(on) {
      const { userId } = me();
      state.usesLinux[userId] = on;
      save();
    },

    async uploadBanner(bytes, ext) {
      failIf('uploadBanner');
      const { userId } = me();
      assertMember(userId);
      state.banners[userId] = { ext, data: Buffer.from(bytes).toString('base64') };
      save();
    },

    async removeBanner() {
      delete state.banners[me().userId];
      save();
    },

    async bannerDataUrl(userId) {
      const viewer = me().userId;
      const banner = state.banners[userId];
      if (!banner || !canSee(viewer, userId)) return null;
      return `data:image/${banner.ext};base64,${banner.data}`;
    },

    async searchMembers(query): Promise<MemberSummary[]> {
      assertModerator();
      const q = query.trim().toLowerCase();
      return Object.values(state.profiles)
        .filter((p) => p.displayName.toLowerCase().includes(q))
        .slice(0, 20)
        .map((p) => ({ id: p.id, displayName: p.displayName, hasAvatar: p.id in state.avatars, mascot: p.mascot }));
    },

    async grantBadge(userId, badge: ManualBadge, reason) {
      failIf('grantBadge');
      assertModerator();
      const mod = me().userId;
      if (userId === mod || !isActive(mod)) throw new SocialError('forbidden', 'Moderators cannot change their own badges.');
      state.actions.push({ target: userId, action: 'grant_badge', reason, until: null, badge, createdAt: iso() });
      if (!state.badgeGrants.some((g) => g.userId === userId && g.badge === badge)) state.badgeGrants.push({ userId, badge });
      state.notices.push({ id: nextId(), userId, message: `You received the ${BADGE_LABELS[badge]} badge.`, createdAt: iso(), readAt: null });
      save();
    },

    async revokeBadge(userId, badge: ManualBadge, reason) {
      failIf('revokeBadge');
      assertModerator();
      const mod = me().userId;
      if (userId === mod || !isActive(mod)) throw new SocialError('forbidden', 'Moderators cannot change their own badges.');
      state.actions.push({ target: userId, action: 'revoke_badge', reason, until: null, badge, createdAt: iso() });
      state.badgeGrants = state.badgeGrants.filter((g) => !(g.userId === userId && g.badge === badge));
      save();
    },

    async members(filters, page) {
      failIf('members');
      const viewer = me().userId;
      if (!isViewerMember(viewer)) return [];
      const order = (lvl: string) => LEVEL_ORDER.indexOf(lvl);
      const mine = order(state.profiles[viewer]?.level ?? 'B1');
      const q = filters.query?.trim().toLowerCase();
      const rows = Object.values(state.profiles)
        .filter((p) => p.id !== viewer && p.listed !== false && countsFor(viewer, p.id))
        .filter((p) => !q || p.displayName.toLowerCase().includes(q))
        .filter((p) => !filters.level || p.level === filters.level)
        .filter((p) => !filters.area || p.area === filters.area)
        .filter((p) => !filters.stack || p.stack.some((t) => t.toLowerCase() === filters.stack!.toLowerCase()))
        .map((p) => rowOf(p.id))
        .sort((a, b) => Math.abs(order(a.level) - mine) - Math.abs(order(b.level) - mine) || byName(a, b));
      return pageOf(rows, page);
    },

    async profileOf(userId) {
      failIf('profileOf');
      const viewer = me().userId;
      const p = state.profiles[userId];
      return p && canSee(viewer, userId) ? toProfile(p) : null;
    },

    async socialStats(userId) {
      failIf('socialStats');
      const viewer = me().userId;
      if (!(userId === viewer || canReach(viewer, userId))) return { followers: 0, following: 0, likes: 0, iFollow: false, iLike: false };
      return {
        followers: state.follows.filter((f) => f.followee === userId && countsFor(viewer, f.follower)).length,
        following: state.follows.filter((f) => f.follower === userId && countsFor(viewer, f.followee)).length,
        likes: state.likes.filter((l) => l.profile === userId && countsFor(viewer, l.liker)).length,
        iFollow: state.follows.some((f) => f.follower === viewer && f.followee === userId),
        iLike: state.likes.some((l) => l.liker === viewer && l.profile === userId),
      };
    },

    async follow(userId) {
      failIf('follow');
      const viewer = me().userId;
      assertCanTie(viewer, userId, 'follow');
      if (state.follows.some((f) => f.follower === viewer && f.followee === userId)) return;
      const sentToday = state.notices.filter((n) => n.kind === 'follow' && n.actor === viewer && Date.parse(n.createdAt) > now() - DAY_MS);
      if (recentCount(state.follows.filter((f) => f.follower === viewer)) >= 200 || sentToday.length >= 200) {
        throw new SocialError('rate_limited', 'follow limit reached');
      }
      state.follows.push({ follower: viewer, followee: userId, at: iso() });
      const recent = state.notices.some(
        (n) => n.userId === userId && n.kind === 'follow' && n.actor === viewer && Date.parse(n.createdAt) > now() - 7 * DAY_MS,
      );
      if (!recent) {
        const name = state.profiles[viewer]?.displayName ?? 'A member';
        state.notices.push({ id: nextId(), userId, message: `${name} followed you.`, createdAt: iso(), readAt: null, kind: 'follow', actor: viewer });
      }
      save();
    },

    async unfollow(userId) {
      failIf('unfollow');
      const viewer = me().userId;
      state.follows = state.follows.filter((f) => !(f.follower === viewer && f.followee === userId));
      save();
    },

    async like(userId) {
      failIf('like');
      const viewer = me().userId;
      if (viewer === userId) throw new SocialError('forbidden', 'You cannot like your own profile.');
      assertCanTie(viewer, userId, 'like');
      if (state.likes.some((l) => l.liker === viewer && l.profile === userId)) return;
      if (recentCount(state.likes.filter((l) => l.liker === viewer)) >= 200) throw new SocialError('rate_limited', 'like limit reached');
      state.likes.push({ liker: viewer, profile: userId, at: iso() });
      save();
    },

    async unlike(userId) {
      failIf('unlike');
      const viewer = me().userId;
      state.likes = state.likes.filter((l) => !(l.liker === viewer && l.profile === userId));
      save();
    },

    async followers(userId, page) {
      failIf('followers');
      const viewer = me().userId;
      if (!(userId === viewer || canReach(viewer, userId))) return [];
      const rows = state.follows
        .filter((f) => f.followee === userId && f.follower in state.profiles && countsFor(viewer, f.follower))
        .map((f) => rowOf(f.follower))
        .sort(byName);
      return pageOf(rows, page);
    },

    async following(userId, page) {
      failIf('following');
      const viewer = me().userId;
      if (!(userId === viewer || canReach(viewer, userId))) return [];
      const rows = state.follows
        .filter((f) => f.follower === userId && f.followee in state.profiles && countsFor(viewer, f.followee))
        .map((f) => rowOf(f.followee))
        .sort(byName);
      return pageOf(rows, page);
    },

    async conversations(): Promise<ConversationSummary[]> {
      failIf('conversations');
      const viewer = me().userId;
      return state.conversations
        .filter((c) => canRead(viewer, c) && (c.status !== 'declined' || c.requestedBy === viewer) && otherIn(c, viewer) in state.profiles)
        .sort((x, y) => y.lastMessageAt.localeCompare(x.lastMessageAt) || x.id.localeCompare(y.id))
        .map((c) => {
          const otherId = otherIn(c, viewer);
          const p = state.profiles[otherId]!;
          const msgs = state.messages.filter((m) => m.conversationId === c.id);
          const last = msgs.at(-1);
          const read = state.reads.find((r) => r.conversationId === c.id && r.userId === viewer)?.lastReadId ?? 0;
          return {
            id: c.id,
            other: { id: otherId, displayName: p.displayName, hasAvatar: otherId in state.avatars, mascot: p.mascot },
            status: c.status === 'declined' ? 'pending' : c.status,
            requestedByMe: c.requestedBy === viewer,
            preview: last && last.deletedAt === null ? last.body.slice(0, 140) : null,
            lastMessageAt: c.lastMessageAt,
            unread: msgs.filter((m) => m.sender !== viewer && m.deletedAt === null && m.id > read).length,
          };
        });
    },

    async messages(conversationId, before) {
      failIf('messages');
      const viewer = me().userId;
      const c = convOf(conversationId);
      if (!canRead(viewer, c)) return [];
      return state.messages
        .filter((m) => m.conversationId === c.id && (before === null || m.id < before))
        .slice(-CHAT_PAGE)
        .map(toChatMessage);
    },

    async requestConversation(userId, body) {
      failIf('requestConversation');
      const text = textOrFail(body);
      const viewer = me().userId;
      if (userId === viewer || !(viewer in state.profiles) || !canReach(viewer, userId)) {
        throw new SocialError('forbidden', 'not allowed');
      }
      const [a, b] = viewer < userId ? [viewer, userId] : [userId, viewer];
      let c = state.conversations.find((x) => x.a === a && x.b === b);
      if (c) {
        const declinedLately = c.status === 'declined' && c.requestedBy === viewer && Date.parse(c.respondedAt ?? '') > now() - 30 * DAY_MS;
        if (c.status === 'accepted' || (c.status === 'pending' && c.requestedBy === viewer) || declinedLately) return c.id;
        if (c.status === 'pending') {
          addMessage(c, viewer, text);
          c.status = 'accepted';
          c.respondedAt = iso();
          emit('conversation', c);
          save();
          return c.id;
        }
      }
      if (state.conversations.filter((x) => x.requestedBy === viewer && Date.parse(x.createdAt) > now() - DAY_MS).length >= 10) {
        throw new SocialError('rate_limited', 'request limit reached');
      }
      assertMessageRoom(viewer);
      if (c) Object.assign(c, { status: 'pending', requestedBy: viewer, createdAt: iso(), respondedAt: null });
      else {
        c = { id: newUuid(), a, b, requestedBy: viewer, status: 'pending', createdAt: iso(), respondedAt: null, lastMessageAt: iso() };
        state.conversations.push(c);
      }
      addMessage(c, viewer, text);
      emit('conversation', c);
      save();
      return c.id;
    },

    async respondConversation(conversationId, accept) {
      failIf('respondConversation');
      const viewer = me().userId;
      const c = convOf(conversationId);
      if (!canRead(viewer, c) || c.status !== 'pending' || c.requestedBy === viewer) throw notAllowed();
      c.status = accept ? 'accepted' : 'declined';
      c.respondedAt = iso();
      emit('conversation', c);
      save();
    },

    async sendMessage(conversationId, body) {
      failIf('sendMessage');
      const text = textOrFail(body);
      const viewer = me().userId;
      const c = convOf(conversationId);
      if (!canWrite(viewer, c)) throw rlsDenied();
      addMessage(c, viewer, text);
      emit('message', c);
      save();
    },

    async deleteMessage(messageId) {
      failIf('deleteMessage');
      const viewer = me().userId;
      const m = state.messages.find((x) => x.id === messageId);
      if (!m || m.sender !== viewer) throw notAllowed();
      state.corrections = state.corrections.filter((k) => k.messageId !== messageId);
      if (m.deletedAt === null) {
        m.body = '';
        m.deletedAt = iso();
      }
      const c = convOf(m.conversationId);
      if (c) emit('message', c);
      save();
    },

    async suggestCorrection(messageId, corrected) {
      failIf('suggestCorrection');
      const text = textOrFail(corrected);
      const viewer = me().userId;
      const m = state.messages.find((x) => x.id === messageId);
      const c = m && convOf(m.conversationId);
      if (!m || m.sender === viewer || m.deletedAt !== null || !canWrite(viewer, c)) throw rlsDenied();
      if (state.corrections.some((k) => k.messageId === messageId && k.author === viewer)) {
        throw new SocialError('unknown', 'duplicate key value violates unique constraint');
      }
      if (state.corrections.filter((k) => k.author === viewer && Date.parse(k.createdAt) > now() - DAY_MS).length >= 200) {
        throw new SocialError('rate_limited', 'correction limit reached');
      }
      state.corrections.push({ id: nextId(), messageId, author: viewer, corrected: text, createdAt: iso(), thankedAt: null });
      countCorrection(viewer);
      emit('correction', c);
      save();
    },

    async thankCorrection(correctionId) {
      failIf('thankCorrection');
      const viewer = me().userId;
      const k = state.corrections.find((x) => x.id === correctionId);
      const m = k && state.messages.find((x) => x.id === k.messageId);
      const c = m && convOf(m.conversationId);
      if (!k || !m || m.sender !== viewer || !canRead(viewer, c)) throw notAllowed();
      k.thankedAt ??= iso();
      emit('correction', c);
      save();
    },

    async markRead(conversationId) {
      failIf('markRead');
      const viewer = me().userId;
      const c = convOf(conversationId);
      if (!canRead(viewer, c)) return;
      const last = Math.max(0, ...state.messages.filter((m) => m.conversationId === c.id).map((m) => m.id));
      const r = state.reads.find((x) => x.conversationId === c.id && x.userId === viewer);
      if (r) r.lastReadId = Math.max(r.lastReadId, last);
      else state.reads.push({ conversationId: c.id, userId: viewer, lastReadId: last });
      save();
    },

    async reportContext(reportId): Promise<ReportedMessage[]> {
      failIf('reportContext');
      const viewer = me().userId;
      if (!isModerator(viewer) || !isActive(viewer)) return [];
      const report = state.reports.find((r) => r.id === reportId);
      return state.reportMessages
        .filter((x) => x.reportId === reportId)
        .sort((x, y) => x.messageId - y.messageId)
        .map((x) => ({
          messageId: x.messageId,
          senderName: x.sender ? (state.profiles[x.sender]?.displayName ?? null) : null,
          body: x.body,
          createdAt: x.createdAt,
          reported: report?.contextId === String(x.messageId),
        }));
    },

    async liveRooms(): Promise<LiveRoom[]> {
      failIf('liveRooms');
      const viewer = me().userId;
      if (!isViewerMember(viewer)) return [];
      return state.rooms
        .filter((r) => {
          const live = liveIn(r.id);
          // Mirrors live_rooms(): not ended, someone live, nobody live blocked with the viewer, not a room they were removed from.
          return r.endedAt === null && live.length > 0 && !live.some((s) => blockedBetween(viewer, s.userId))
            && !sessionsIn(r.id).some((s) => s.userId === viewer && s.removed);
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
        .map((r) => ({
          id: r.id,
          title: r.title,
          theme: r.theme,
          level: r.level,
          hostName: (r.host && state.profiles[r.host]?.displayName) || '',
          people: liveIn(r.id).filter((s) => s.userId in state.profiles).map((s) => personBase(s.userId)),
        }));
    },

    async createRoom(draft) {
      failIf('createRoom');
      const viewer = me().userId;
      if (!isViewerMember(viewer) || !(viewer in state.profiles)) throw notAllowed();
      const title = roomTitle(draft.title);
      if (title === null) throw new SocialError('unknown', 'room title is not valid');
      if (!(ROOM_THEMES as readonly string[]).includes(draft.theme)) throw new SocialError('unknown', 'room theme is not valid');
      const level = draft.level ?? null;
      if (level !== null && !LEVEL_ORDER.includes(level)) throw new SocialError('unknown', 'room level is not valid');
      if (state.rooms.filter((r) => r.createdBy === viewer && Date.parse(r.createdAt) > now() - DAY_MS).length >= 10) {
        throw new SocialError('rate_limited', 'room limit reached');
      }
      closeOthers(viewer, null);
      const room: StoredRoom = {
        id: newUuid(), createdBy: viewer, host: viewer, title, theme: draft.theme, level, createdAt: iso(), endedAt: null,
        timerStartedAt: null, timerSeconds: null, card: 0,
      };
      state.rooms.push(room);
      addSession(room.id, viewer);
      save();
      return room.id;
    },

    async joinRoom(roomId) {
      failIf('joinRoom');
      const viewer = me().userId;
      if (!isViewerMember(viewer) || !(viewer in state.profiles)) throw notAllowed();
      const r = roomById(roomId);
      if (!r || r.endedAt !== null) throw notAllowed();
      if (isLiveIn(roomId, viewer)) return;
      if (sessionsIn(roomId).some((s) => s.userId === viewer && s.removed)) throw notAllowed();
      const seats = liveIn(roomId);
      if (seats.length === 0 || seats.some((s) => blockedBetween(viewer, s.userId))) throw notAllowed();
      if (seats.length >= ROOM_MAX) throw new SocialError('unknown', 'room is full');
      closeOthers(viewer, roomId);
      touch(roomId, () => {
        // A silent seat of yours in this room closes at its last sign of life before the new one opens.
        for (const s of sessionsIn(roomId)) if (s.userId === viewer && s.leftAt === null) s.leftAt = leftAtOf(s);
        addSession(roomId, viewer);
        settle(roomId);
      });
      save();
    },

    async leaveRoom(roomId) {
      failIf('leaveRoom');
      const viewer = me().userId;
      touch(roomId, () => closeSession(roomId, viewer));
      save();
    },

    async roomHeartbeat(roomId) {
      failIf('roomHeartbeat');
      const viewer = me().userId;
      if (!sessionsIn(roomId).some((s) => s.userId === viewer)) return false;
      const still = touch(roomId, () => {
        const mine = isViewerMember(viewer) ? sessionsIn(roomId).filter((s) => s.userId === viewer && sessionLive(s)) : [];
        for (const s of mine) state.roomSeen[s.id] = iso();
        if (mine.length === 0) closeSession(roomId, viewer);
        settle(roomId);
        return mine.length > 0;
      });
      // Signals older than 5 minutes go, in every room.
      state.roomSignals = state.roomSignals.filter((g) => Date.parse(g.createdAt) >= now() - 5 * 60_000);
      save();
      return still;
    },

    async roomState(roomId): Promise<RoomState | null> {
      failIf('roomState');
      const viewer = me().userId;
      const r = roomById(roomId);
      const mine = sessionsIn(roomId).filter((s) => s.userId === viewer).sort((a, b) => b.id - a.id)[0];
      if (!r || !mine) return null;
      const live = isViewerMember(viewer) && r.endedAt === null && sessionLive(mine);
      const people: RoomPerson[] = live
        ? liveIn(roomId)
            .filter((s) => s.userId in state.profiles)
            .map((s) => ({
              ...personBase(s.userId),
              level: state.profiles[s.userId]!.level,
              role: r.host === s.userId ? 'host' : s.role,
              muted: s.muted === true,
            }))
        : [];
      return {
        id: r.id,
        title: r.title,
        theme: r.theme,
        level: r.level,
        hostId: r.host,
        endedAt: r.endedAt,
        timer: r.timerStartedAt !== null && r.timerSeconds !== null ? { startedAt: r.timerStartedAt, seconds: r.timerSeconds } : null,
        card: r.card,
        me: {
          live,
          removed: sessionsIn(roomId).some((s) => s.userId === viewer && s.removed),
          role: r.host === viewer ? 'host' : mine.role,
          muteRequestedAt: mine.muteRequestedAt,
        },
        people,
      };
    },

    async sendRoomSignal(roomId, to, signal, payload) {
      failIf('sendRoomSignal');
      const viewer = me().userId;
      if (state.roomSignals.filter((g) => g.sender === viewer && Date.parse(g.createdAt) > now() - 60_000).length >= 600) {
        throw new SocialError('rate_limited', 'signal limit reached');
      }
      // Mirrors can_signal(): both live in the room, not the same person, no block between them.
      if (viewer === to || !viewerIn(roomId, viewer) || !isLiveIn(roomId, to) || blockedBetween(viewer, to)) throw rlsDenied();
      if (!ROOM_SIGNAL_KINDS.includes(signal)) throw new SocialError('unknown', 'new row for relation "room_signals" violates check constraint "room_signals_kind_check"');
      if (Buffer.byteLength(payload, 'utf8') > ROOM_SIGNAL_MAX_BYTES) {
        throw new SocialError('unknown', 'new row for relation "room_signals" violates check constraint "room_signals_payload_check"');
      }
      state.roomSignals.push({ id: nextId(), roomId, sender: viewer, recipient: to, createdAt: iso() });
      // Only the recipient reads a signal.
      for (const l of [...roomListeners]) {
        if (l.roomId === roomId && l.viewer === to && isViewerMember(to)) l.onEvent({ kind: 'signal', from: viewer, signal, payload });
      }
      save();
    },

    async makeRoomModerator(roomId, userId) {
      failIf('makeRoomModerator');
      hostActsOn(roomId, me().userId, userId);
      touch(roomId, () => setRole(roomId, userId, 'moderator'));
      save();
    },

    async removeRoomModerator(roomId, userId) {
      failIf('removeRoomModerator');
      hostActsOn(roomId, me().userId, userId);
      touch(roomId, () => setRole(roomId, userId, 'member'));
      save();
    },

    async passHost(roomId, userId) {
      failIf('passHost');
      const r = hostActsOn(roomId, me().userId, userId);
      touch(roomId, () => {
        r.host = userId;
      });
      save();
    },

    async muteMember(roomId, userId) {
      failIf('muteMember');
      const viewer = me().userId;
      const host = openHost(roomId);
      const myRole = liveRole(roomId, viewer);
      if (!host || !isViewerMember(viewer) || !myRole || userId === viewer || userId === host || !(viewer === host || myRole === 'moderator') || !isLiveIn(roomId, userId)) {
        throw notAllowed();
      }
      touch(roomId, () => {
        for (const s of sessionsIn(roomId)) if (s.userId === userId && s.leftAt === null) s.muteRequestedAt = iso();
      });
      save();
    },

    async setRoomMuted(roomId, muted) {
      failIf('setRoomMuted');
      const viewer = me().userId;
      // Mirrors set_room_muted(): only your own live session; the same state again changes nothing and tells nobody.
      if (!viewerIn(roomId, viewer)) throw notAllowed();
      touch(roomId, () => {
        for (const s of sessionsIn(roomId)) if (s.userId === viewer && s.leftAt === null && s.muted !== muted) s.muted = muted;
      });
      save();
    },

    async removeFromRoom(roomId, userId) {
      failIf('removeFromRoom');
      const viewer = me().userId;
      const host = openHost(roomId);
      const myRole = liveRole(roomId, viewer);
      const theirRole = sessionsIn(roomId).find((s) => s.userId === userId && s.leftAt === null)?.role ?? null;
      if (!host || !isViewerMember(viewer) || !myRole || !theirRole || userId === viewer || userId === host || !(viewer === host || (myRole === 'moderator' && theirRole === 'member'))) {
        throw notAllowed();
      }
      touch(roomId, () => {
        for (const s of sessionsIn(roomId)) {
          if (s.userId === userId && s.leftAt === null) {
            s.removed = true;
            s.leftAt = leftAtOf(s);
          }
        }
      });
      save();
    },

    async endRoom(roomId) {
      failIf('endRoom');
      const viewer = me().userId;
      const r = roomById(roomId);
      if (!r || r.endedAt !== null || r.host !== viewer || !viewerIn(roomId, viewer)) throw notAllowed();
      touch(roomId, () => {
        for (const s of sessionsIn(roomId)) if (s.leftAt === null) s.leftAt = leftAtOf(s);
        r.endedAt = iso();
        r.timerStartedAt = null;
        r.timerSeconds = null;
        dropSignals(roomId);
      });
      save();
    },

    async setRoomTimer(roomId, seconds) {
      failIf('setRoomTimer');
      const viewer = me().userId;
      if (!viewerIn(roomId, viewer)) throw notAllowed();
      const r = roomById(roomId);
      if (seconds !== null && seconds !== 60 && seconds !== 90) throw new SocialError('unknown', 'timer is not valid');
      touch(roomId, () => {
        if (!r || r.endedAt !== null) return;
        if (seconds === null) {
          r.timerStartedAt = null;
          r.timerSeconds = null;
        } else {
          r.timerStartedAt = iso();
          r.timerSeconds = seconds;
        }
      });
      save();
    },

    async nextCard(roomId) {
      failIf('nextCard');
      const viewer = me().userId;
      if (!viewerIn(roomId, viewer)) throw notAllowed();
      const r = roomById(roomId);
      touch(roomId, () => {
        if (r && r.endedAt === null) r.card += 1;
      });
      save();
    },

    async roomReportContext(reportId): Promise<RoomReportContext | null> {
      failIf('roomReportContext');
      const viewer = me().userId;
      if (!isModerator(viewer) || !isActive(viewer)) return null;
      const report = state.reports.find((x) => x.id === reportId);
      if (!report || report.contextType !== 'room' || !report.contextId || !UUID.test(report.contextId)) return null;
      const roomId = report.contextId.toLowerCase();
      const inRoom = (userId: string) => sessionsIn(roomId).some((s) => s.userId === userId);
      // Only for a room the reported person (and the reporter, while their account exists) was in.
      if (!report.reported || !inRoom(report.reported) || (report.reporter && !inRoom(report.reporter))) return null;
      const r = roomById(roomId);
      if (!r) return null;
      return {
        title: r.title,
        theme: r.theme,
        hostName: (r.host && state.profiles[r.host]?.displayName) || null,
        createdAt: r.createdAt,
        people: sessionsIn(roomId)
          .sort(byJoin)
          .map((s) => ({
            name: state.profiles[s.userId]?.displayName ?? null,
            joinedAt: s.joinedAt,
            leftAt: s.leftAt ?? (sessionLive(s) ? null : seenAt(s)),
          })),
      };
    },

    subscribeRoom(roomId, onEvent) {
      if (!state.session) return () => {};
      const listener = { viewer: state.session.userId, roomId, onEvent };
      roomListeners.push(listener);
      onEvent({ kind: 'online' });
      return () => {
        const i = roomListeners.indexOf(listener);
        if (i >= 0) roomListeners.splice(i, 1);
      };
    },

    subscribe(onEvent, onStatus) {
      if (!state.session) return () => {};
      const listener = { viewer: state.session.userId, onEvent };
      listeners.push(listener);
      onStatus(true);
      return () => {
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
      };
    },

    async actAsForTest(userId, act) {
      const user = state.users.find((u) => u.id === userId);
      if (!user) throw new Error('actAsForTest: no such member');
      const signedIn = state.session;
      state.session = { userId: user.id, email: user.email };
      try {
        return await act(backend);
      } finally {
        state.session = signedIn;
        // The calls above saved the state with this member signed in; save it again with the real session.
        save();
      }
    },
    sendAsForTest(userId, conversationId, body) {
      const c = convOf(conversationId);
      if (!c || (c.a !== userId && c.b !== userId) || c.status !== 'accepted') throw new Error('sendAsForTest: not an open conversation of this person');
      addMessage(c, userId, body);
      emit('message', c);
      save();
    },
    thankAsForTest(userId, correctionId) {
      const k = state.corrections.find((x) => x.id === correctionId);
      const m = k && state.messages.find((x) => x.id === k.messageId);
      const c = m && convOf(m.conversationId);
      if (!k || !m || !c || m.sender !== userId) throw new Error('thankAsForTest: only the sender of the message can thank');
      k.thankedAt ??= iso();
      emit('correction', c);
      save();
    },
    addModeratorForTest(userId) {
      if (!state.moderators.includes(userId)) state.moderators.push(userId);
      save();
    },
    seededUserIds: () => [...state.seeded],
    async peopleForTest() {
      return Object.values(state.profiles).map((p) => ({ id: p.id, displayName: p.displayName }));
    },
    addFollowsForTest(follower, n) {
      for (let i = 0; i < n; i++) state.follows.push({ follower, followee: newUuid(), at: iso() });
      save();
    },
    noticesFor,
    suspendForTest(userId, until) {
      const p = state.profiles[userId];
      if (p) p.suspendedUntil = until;
      save();
    },
    addNoticeForTest(userId, message, extra) {
      state.notices.push({ id: nextId(), userId, message, createdAt: iso(), readAt: null, ...extra });
      save();
    },
  };
  return backend;
}
