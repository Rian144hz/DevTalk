// Types and channel names shared by main, preload and renderer. No runtime dependencies:
// the sandboxed preload bundles this file and cannot load node_modules.
import type { Challenge, Expression } from '../core/domain/types';
import type { LLMErrorKind } from '../core/llm/errors';
import type { ProgressStage } from '../core/llm/structured';
import type { HistoryItem, ProfileInput, StoredFeedback, StoredProfile, Theme } from '../core/ports';
import type { PracticeGraphData } from '../core/progress/practice';
import type { ProgressSummary } from '../core/progress/summary';
import type { ManualBadge } from '../core/social/badges';
import type { ChatCheck, ChatLiveEvent, ChatMessage, ConversationSummary, ReportedMessage } from '../core/social/chat';
import type { LiveRoom, RoomDraft, RoomLiveEvent, RoomReportContext, RoomSignalKind, RoomState, RoomTimer } from '../core/social/rooms';
import type {
  Badge, MemberFilters, MemberRow, MemberSummary, ModerationDecision, ModerationReport, NoticeActor, NoticeKind, ProfileDraft, ReportInput, SocialProfile, SocialStats,
} from '../core/social/types';
import type { ReviewRating, SrsCard } from '../core/srs/srs';
import type { ProviderId } from './providers';

/** Community (Supabase) failures, shown with plain-English copy. */
export type SocialErrorKindForUi = 'not_configured' | 'offline' | 'invalid_code' | 'asleep' | 'suspended' | 'not_signed_in' | 'forbidden';
export type AppErrorKind = LLMErrorKind | SocialErrorKindForUi | 'validation' | 'busy' | 'not_found' | 'keyring_unavailable' | 'internal';
export interface AppError {
  kind: AppErrorKind;
  message: string;
}
export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

export interface Settings {
  provider: ProviderId;
  model: string;
  theme: Theme;
}
export interface KeyStatus {
  hasKey: boolean;
}
export interface ReviewItem {
  expression: Expression;
  card: SrsCard;
  /** ISO dates of the next due date for each rating. */
  preview: Record<ReviewRating, string>;
}
/** A feedback as the Feedback screen shows it (fresh or from history). */
export type FeedbackView = StoredFeedback;

export interface ReviewQueue {
  items: ReviewItem[];
  /** ISO date of the earliest card, due or not; null when there are no cards. */
  nextDueAt: string | null;
}

/** Where the person stands with the community account. */
export interface SocialStatus {
  configured: boolean;
  signedIn: boolean;
  email: string | null;
  /** Signed in but the current documents and the 18+ attestation are not accepted yet. */
  needsDocuments: boolean;
  hasProfile: boolean;
  /** ISO date (or 'infinity') while suspended, else null. */
  suspendedUntil: string | null;
}
export interface SocialNotice {
  id: number;
  message: string;
  createdAt: string;
  read: boolean;
  kind: NoticeKind;
  /** Who caused it (a follower); null for moderation notices. */
  actor: NoticeActor | null;
}
export interface ModerationHistoryEntry {
  action: string;
  reason: string;
  until: string | null;
  badge: string | null;
  createdAt: string;
}

export interface ProgressEvent {
  requestId: string;
  stage: ProgressStage;
}

/** Input and output of every invoke channel. */
export interface Channels {
  'profile:get': { in: Record<string, never>; out: StoredProfile | null };
  'profile:save': { in: ProfileInput; out: StoredProfile };
  'keys:status': { in: { provider?: ProviderId }; out: KeyStatus };
  'keys:set': { in: { key: string; provider?: ProviderId }; out: KeyStatus };
  'keys:clear': { in: { provider?: ProviderId }; out: KeyStatus };
  'challenges:next': { in: { requestId: string }; out: Challenge };
  'challenges:cancel': { in: { requestId: string }; out: null };
  'challenges:pending': { in: Record<string, never>; out: Challenge | null };
  'feedback:submit': { in: { requestId: string; challengeId: number | null; text: string }; out: FeedbackView };
  'feedback:cancel': { in: { requestId: string }; out: null };
  'feedback:get': { in: { feedbackId: number }; out: FeedbackView };
  'review:queue': { in: Record<string, never>; out: ReviewQueue };
  'review:rate': { in: { expressionId: number; rating: ReviewRating }; out: { card: SrsCard } };
  'progress:summary': { in: Record<string, never>; out: ProgressSummary };
  'progress:history': { in: { before: string | null; limit?: number }; out: HistoryItem[] };
  /** The local practice graph (this machine's time zone), shown even without a community account. */
  'progress:graph': { in: Record<string, never>; out: PracticeGraphData };
  'settings:get': { in: Record<string, never>; out: Settings | null };
  'settings:set': { in: Partial<Settings>; out: Settings };
  'llm:check': { in: Record<string, never>; out: { ok: boolean; detail: string } };
  'social:status': { in: Record<string, never>; out: SocialStatus };
  'social:sendCode': { in: { email: string }; out: null };
  'social:verifyCode': { in: { email: string; code: string }; out: SocialStatus };
  'social:acceptDocuments': { in: Record<string, never>; out: SocialStatus };
  'social:getProfile': { in: Record<string, never>; out: SocialProfile | null };
  'social:saveProfile': { in: ProfileDraft; out: SocialProfile };
  'social:setAvatar': { in: { bytes: Uint8Array }; out: string };
  'social:removeAvatar': { in: Record<string, never>; out: null };
  'social:avatar': { in: { userId: string }; out: string | null };
  'social:notices': { in: Record<string, never>; out: SocialNotice[] };
  'social:readNotice': { in: { id: number }; out: null };
  'social:signOut': { in: Record<string, never>; out: SocialStatus };
  'social:export': { in: { includeLocal: boolean }; out: { saved: boolean; path: string | null } };
  'social:deleteAccount': { in: { confirmEmail: string; deleteLocal: boolean }; out: null };
  'social:badges': { in: { userId: string }; out: Badge[] };
  'social:practiceGraph': { in: { userId: string }; out: PracticeGraphData };
  'social:setBanner': { in: { bytes: Uint8Array }; out: string };
  'social:removeBanner': { in: Record<string, never>; out: null };
  'social:banner': { in: { userId: string }; out: string | null };
  'social:members': { in: MemberFilters & { page: number }; out: MemberRow[] };
  'social:profileOf': { in: { userId: string }; out: SocialProfile | null };
  'social:socialStats': { in: { userId: string }; out: SocialStats };
  'social:follow': { in: { userId: string }; out: null };
  'social:unfollow': { in: { userId: string }; out: null };
  'social:like': { in: { userId: string }; out: null };
  'social:unlike': { in: { userId: string }; out: null };
  'social:followers': { in: { userId: string; page: number }; out: MemberRow[] };
  'social:following': { in: { userId: string; page: number }; out: MemberRow[] };
  'safety:block': { in: { userId: string }; out: null };
  'safety:unblock': { in: { userId: string }; out: null };
  'safety:report': { in: ReportInput; out: null };
  'moderation:isModerator': { in: Record<string, never>; out: boolean };
  'moderation:reports': { in: Record<string, never>; out: ModerationReport[] };
  'moderation:history': { in: { userId: string }; out: ModerationHistoryEntry[] };
  'moderation:decide': { in: ModerationDecision; out: null };
  'moderation:searchMembers': { in: { query: string }; out: MemberSummary[] };
  'moderation:grantBadge': { in: BadgeChange; out: null };
  'moderation:revokeBadge': { in: BadgeChange; out: null };
  'moderation:reportContext': { in: { reportId: number }; out: ReportedMessage[] };
  'chat:conversations': { in: Record<string, never>; out: ConversationSummary[] };
  'chat:messages': { in: { conversationId: string; before: number | null }; out: ChatMessage[] };
  'chat:request': { in: { userId: string; body: string }; out: string };
  'chat:respond': { in: { conversationId: string; accept: boolean }; out: null };
  'chat:send': { in: { conversationId: string; body: string }; out: null };
  'chat:delete': { in: { messageId: number }; out: null };
  'chat:correct': { in: { messageId: number; corrected: string }; out: null };
  'chat:thank': { in: { correctionId: number }; out: null };
  'chat:read': { in: { conversationId: string }; out: null };
  /** The coach checks a draft; only the draft goes to the chosen LLM and nothing is saved. */
  'chat:check': { in: { text: string }; out: ChatCheck };
  'moderation:roomContext': { in: { reportId: number }; out: RoomReportContext | null };
  /** Rooms with someone live in them that the person may join, newest first. */
  'rooms:list': { in: Record<string, never>; out: LiveRoom[] };
  /** Opens a room and enters it as its host; returns the room id. */
  'rooms:create': { in: RoomDraft; out: string };
  'rooms:join': { in: { roomId: string }; out: null };
  'rooms:leave': { in: { roomId: string }; out: null };
  'rooms:state': { in: { roomId: string }; out: RoomState | null };
  /** One connection message (an offer, an answer, a candidate or a goodbye) to a person live in the same room. */
  'rooms:signal': { in: { roomId: string; to: string; signal: RoomSignalKind; payload: string }; out: null };
  'rooms:makeModerator': { in: { roomId: string; userId: string }; out: null };
  'rooms:removeModerator': { in: { roomId: string; userId: string }; out: null };
  'rooms:passHost': { in: { roomId: string; userId: string }; out: null };
  /** Asks a person to mute; they can unmute whenever they are ready. */
  'rooms:mute': { in: { roomId: string; userId: string }; out: null };
  'rooms:remove': { in: { roomId: string; userId: string }; out: null };
  'rooms:end': { in: { roomId: string }; out: null };
  /** Starts the shared speaking timer (60 or 90 seconds); null stops it. */
  'rooms:timer': { in: { roomId: string; seconds: RoomTimer | null }; out: null };
  'rooms:nextCard': { in: { roomId: string }; out: null };
  /** Numbers the window needs from main (the connect timeout can be shortened in dev and e2e). */
  'rooms:settings': { in: Record<string, never>; out: RoomSettings };
}
export interface RoomSettings {
  /** How long a peer may take to connect before the window says "Could not connect". */
  connectTimeoutMs: number;
}
export interface BadgeChange {
  userId: string;
  badge: ManualBadge;
  reason: string;
}
export type InvokeChannel = keyof Channels;

export const INVOKE_CHANNELS = [
  'profile:get', 'profile:save', 'keys:status', 'keys:set', 'keys:clear', 'challenges:next', 'challenges:cancel',
  'challenges:pending', 'feedback:submit', 'feedback:cancel', 'feedback:get', 'review:queue', 'review:rate', 'progress:summary', 'progress:history',
  'progress:graph', 'settings:get', 'settings:set', 'llm:check',
  'social:status', 'social:sendCode', 'social:verifyCode', 'social:acceptDocuments', 'social:getProfile', 'social:saveProfile',
  'social:setAvatar', 'social:removeAvatar', 'social:avatar', 'social:notices', 'social:readNotice', 'social:signOut',
  'social:export', 'social:deleteAccount', 'social:badges', 'social:practiceGraph', 'social:setBanner', 'social:removeBanner',
  'social:banner', 'social:members', 'social:profileOf', 'social:socialStats', 'social:follow', 'social:unfollow', 'social:like',
  'social:unlike', 'social:followers', 'social:following', 'safety:block', 'safety:unblock', 'safety:report',
  'moderation:isModerator', 'moderation:reports', 'moderation:history', 'moderation:decide',
  'moderation:searchMembers', 'moderation:grantBadge', 'moderation:revokeBadge', 'moderation:reportContext',
  'chat:conversations', 'chat:messages', 'chat:request', 'chat:respond', 'chat:send', 'chat:delete', 'chat:correct',
  'chat:thank', 'chat:read', 'chat:check',
  'moderation:roomContext',
  'rooms:list', 'rooms:create', 'rooms:join', 'rooms:leave', 'rooms:state', 'rooms:signal', 'rooms:makeModerator', 'rooms:removeModerator',
  'rooms:passHost', 'rooms:mute', 'rooms:remove', 'rooms:end', 'rooms:timer', 'rooms:nextCard', 'rooms:settings',
] as const satisfies readonly InvokeChannel[];

export const PROGRESS_EVENT = 'llm:progress';
/** Main → window: live chat changes and the connection state. */
export const CHAT_EVENT = 'chat:event';
/** Main → window: changes of the room the person is in, signals from its peers, and the connection state. */
export const ROOM_EVENT = 'room:event';
export type { ChatLiveEvent, RoomLiveEvent };

type R<C extends InvokeChannel> = Promise<Result<Channels[C]['out']>>;

/** What the preload exposes as `window.devtalk`. */
export interface DevtalkApi {
  profile: { get(): R<'profile:get'>; save(p: ProfileInput): R<'profile:save'> };
  /** `provider` defaults to the one in the profile. */
  keys: { status(provider?: ProviderId): R<'keys:status'>; set(key: string, provider?: ProviderId): R<'keys:set'>; clear(provider?: ProviderId): R<'keys:clear'> };
  challenges: {
    next(requestId: string): R<'challenges:next'>;
    cancel(requestId: string): R<'challenges:cancel'>;
    pending(): R<'challenges:pending'>;
  };
  feedback: {
    submit(input: Channels['feedback:submit']['in']): R<'feedback:submit'>;
    cancel(requestId: string): R<'feedback:cancel'>;
    get(feedbackId: number): R<'feedback:get'>;
  };
  llm: { onProgress(cb: (e: ProgressEvent) => void): () => void };
  review: { queue(): R<'review:queue'>; rate(input: Channels['review:rate']['in']): R<'review:rate'> };
  progress: {
    summary(): R<'progress:summary'>;
    history(input: Channels['progress:history']['in']): R<'progress:history'>;
    graph(): R<'progress:graph'>;
  };
  settings: { get(): R<'settings:get'>; set(partial: Partial<Settings>): R<'settings:set'> };
  /** Checks that the chosen coach can be reached (used for Ollama). */
  llmCheck(): R<'llm:check'>;
  /** Community account, profile and personal data (main process talks to Supabase). */
  social: {
    status(): R<'social:status'>;
    sendCode(email: string): R<'social:sendCode'>;
    verifyCode(email: string, code: string): R<'social:verifyCode'>;
    acceptDocuments(): R<'social:acceptDocuments'>;
    getProfile(): R<'social:getProfile'>;
    saveProfile(draft: ProfileDraft): R<'social:saveProfile'>;
    setAvatar(bytes: Uint8Array): R<'social:setAvatar'>;
    removeAvatar(): R<'social:removeAvatar'>;
    avatar(userId: string): R<'social:avatar'>;
    notices(): R<'social:notices'>;
    readNotice(id: number): R<'social:readNotice'>;
    signOut(): R<'social:signOut'>;
    /** Opens a save dialog in main; resolves after the file is written or the dialog is cancelled. */
    exportData(includeLocal: boolean): R<'social:export'>;
    deleteAccount(input: Channels['social:deleteAccount']['in']): R<'social:deleteAccount'>;
    badges(userId: string): R<'social:badges'>;
    practiceGraph(userId: string): R<'social:practiceGraph'>;
    /** GIF or WebP; main checks it and removes its metadata before upload. */
    setBanner(bytes: Uint8Array): R<'social:setBanner'>;
    removeBanner(): R<'social:removeBanner'>;
    banner(userId: string): R<'social:banner'>;
    members(input: Channels['social:members']['in']): R<'social:members'>;
    profileOf(userId: string): R<'social:profileOf'>;
    socialStats(userId: string): R<'social:socialStats'>;
    follow(userId: string): R<'social:follow'>;
    unfollow(userId: string): R<'social:unfollow'>;
    like(userId: string): R<'social:like'>;
    unlike(userId: string): R<'social:unlike'>;
    followers(userId: string, page: number): R<'social:followers'>;
    following(userId: string, page: number): R<'social:following'>;
  };
  safety: {
    block(userId: string): R<'safety:block'>;
    unblock(userId: string): R<'safety:unblock'>;
    report(input: ReportInput): R<'safety:report'>;
  };
  moderation: {
    isModerator(): R<'moderation:isModerator'>;
    reports(): R<'moderation:reports'>;
    history(userId: string): R<'moderation:history'>;
    decide(decision: ModerationDecision): R<'moderation:decide'>;
    searchMembers(query: string): R<'moderation:searchMembers'>;
    grantBadge(change: BadgeChange): R<'moderation:grantBadge'>;
    revokeBadge(change: BadgeChange): R<'moderation:revokeBadge'>;
    reportContext(reportId: number): R<'moderation:reportContext'>;
    roomContext(reportId: number): R<'moderation:roomContext'>;
  };
  /** Private chat; live changes arrive through onEvent. */
  chat: {
    conversations(): R<'chat:conversations'>;
    messages(conversationId: string, before: number | null): R<'chat:messages'>;
    request(userId: string, body: string): R<'chat:request'>;
    respond(conversationId: string, accept: boolean): R<'chat:respond'>;
    send(conversationId: string, body: string): R<'chat:send'>;
    delete(messageId: number): R<'chat:delete'>;
    correct(messageId: number, corrected: string): R<'chat:correct'>;
    thank(correctionId: number): R<'chat:thank'>;
    read(conversationId: string): R<'chat:read'>;
    check(text: string): R<'chat:check'>;
    onEvent(cb: (e: ChatLiveEvent) => void): () => void;
  };
  /** Voice rooms: the room list and the person's own room. The voice itself never passes through main. */
  rooms: {
    list(): R<'rooms:list'>;
    create(draft: RoomDraft): R<'rooms:create'>;
    join(roomId: string): R<'rooms:join'>;
    leave(roomId: string): R<'rooms:leave'>;
    state(roomId: string): R<'rooms:state'>;
    signal(roomId: string, to: string, signal: RoomSignalKind, payload: string): R<'rooms:signal'>;
    makeModerator(roomId: string, userId: string): R<'rooms:makeModerator'>;
    removeModerator(roomId: string, userId: string): R<'rooms:removeModerator'>;
    passHost(roomId: string, userId: string): R<'rooms:passHost'>;
    mute(roomId: string, userId: string): R<'rooms:mute'>;
    remove(roomId: string, userId: string): R<'rooms:remove'>;
    end(roomId: string): R<'rooms:end'>;
    timer(roomId: string, seconds: RoomTimer | null): R<'rooms:timer'>;
    nextCard(roomId: string): R<'rooms:nextCard'>;
    settings(): R<'rooms:settings'>;
    onEvent(cb: (e: RoomLiveEvent) => void): () => void;
  };
}
