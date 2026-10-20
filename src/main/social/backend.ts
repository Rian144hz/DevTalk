import type { DayActivity, PracticeGraphData } from '../../core/progress/practice';
import type { ChatEvent, ChatMessage, ConversationSummary, ReportedMessage } from '../../core/social/chat';
import type { ManualBadge } from '../../core/social/badges';
import type { Badge, MemberFilters, MemberRow, MemberSummary, NoticeActor, NoticeKind, SocialStats, ModerationDecision, ModerationReport, ProfileDraft, ReportInput, SocialProfile } from '../../core/social/types';
import { SocialError } from './errors';

export interface SocialSession {
  userId: string;
  email: string;
}

export interface Notice {
  id: number;
  message: string;
  createdAt: string;
  read: boolean;
  kind: NoticeKind;
  /** Who caused it (the follower of a follow notice); null for moderation notices. */
  actor: NoticeActor | null;
}

export type { MemberSummary, PracticeGraphData };

export interface ModerationHistoryItem {
  action: string;
  reason: string;
  until: string | null;
  /** The badge given or taken (grant_badge / revoke_badge), otherwise null. */
  badge: string | null;
  createdAt: string;
}

/** Everything the app does with the community server. Lives in the main process only. */
export interface SocialBackend {
  readonly configured: boolean;
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<SocialSession>;
  session(): Promise<SocialSession | null>;
  signOut(): Promise<void>;
  hasAcceptedCurrentDocuments(): Promise<boolean>;
  /** Accepts every legal document and the 18+ attestation at the current version. */
  acceptDocuments(): Promise<void>;
  getOwnProfile(): Promise<SocialProfile | null>;
  saveProfile(draft: ProfileDraft): Promise<SocialProfile>;
  uploadAvatar(webp: Uint8Array): Promise<void>;
  removeAvatar(): Promise<void>;
  avatarDataUrl(userId: string): Promise<string | null>;
  block(userId: string): Promise<void>;
  unblock(userId: string): Promise<void>;
  listBlocks(): Promise<string[]>;
  report(input: ReportInput): Promise<void>;
  listNotices(): Promise<Notice[]>;
  markNoticeRead(id: number): Promise<void>;
  isModerator(): Promise<boolean>;
  listOpenReports(): Promise<ModerationReport[]>;
  actionsAbout(userId: string): Promise<ModerationHistoryItem[]>;
  decide(decision: ModerationDecision): Promise<void>;
  exportOwnData(): Promise<Record<string, unknown>>;
  deleteAccount(): Promise<void>;
  /** Badges of someone the caller may see (empty otherwise). */
  badges(userId: string): Promise<Badge[]>;
  practiceGraph(userId: string): Promise<PracticeGraphData>;
  /** Upserts the caller's own practice days. */
  publishPracticeDays(days: DayActivity[]): Promise<void>;
  /** Inserts a milestone; duplicates are ignored, invalid values refused. */
  publishMilestone(kind: 'level_up' | 'vocabulary', value: string): Promise<void>;
  setUsesLinux(on: boolean): Promise<void>;
  /** Stores the banner (already validated and cleaned) and records it on the profile. */
  uploadBanner(bytes: Uint8Array, ext: 'gif' | 'webp'): Promise<void>;
  removeBanner(): Promise<void>;
  bannerDataUrl(userId: string): Promise<string | null>;
  /** Moderators only: members whose display name contains `query`, at most 20. */
  searchMembers(query: string): Promise<MemberSummary[]>;
  grantBadge(userId: string, badge: ManualBadge, reason: string): Promise<void>;
  revokeBadge(userId: string, badge: ManualBadge, reason: string): Promise<void>;
  /** Listed, active members the caller is not blocked with, closest English level first; 30 per page. */
  members(filters: MemberFilters, page: number): Promise<MemberRow[]>;
  /** Another member's profile, or null when the caller cannot see it (blocked, suspended, gone). */
  profileOf(userId: string): Promise<SocialProfile | null>;
  socialStats(userId: string): Promise<SocialStats>;
  follow(userId: string): Promise<void>;
  unfollow(userId: string): Promise<void>;
  like(userId: string): Promise<void>;
  unlike(userId: string): Promise<void>;
  followers(userId: string, page: number): Promise<MemberRow[]>;
  following(userId: string, page: number): Promise<MemberRow[]>;
  /** The caller's conversations and requests, newest first. */
  conversations(): Promise<ConversationSummary[]>;
  /** The newest 50 messages before `before` (all when null), oldest first, with their corrections. */
  messages(conversationId: string, before: number | null): Promise<ChatMessage[]>;
  /** Asks for a conversation with a first message; returns the conversation id. */
  requestConversation(userId: string, body: string): Promise<string>;
  respondConversation(conversationId: string, accept: boolean): Promise<void>;
  sendMessage(conversationId: string, body: string): Promise<void>;
  deleteMessage(messageId: number): Promise<void>;
  suggestCorrection(messageId: number, corrected: string): Promise<void>;
  thankCorrection(correctionId: number): Promise<void>;
  markRead(conversationId: string): Promise<void>;
  /** Moderators: the messages copied into a message report (empty for anyone else). */
  reportContext(reportId: number): Promise<ReportedMessage[]>;
  /** Live changes for the signed-in member; returns the unsubscribe. */
  subscribe(onEvent: (e: ChatEvent) => void, onStatus: (online: boolean) => void): () => void;
}

/** Used when the build has no Supabase settings: every call says so. */
export function createUnconfiguredBackend(): SocialBackend {
  const fail = async (): Promise<never> => {
    throw new SocialError('not_configured', 'Community is not set up in this build.');
  };
  return {
    configured: false,
    sendCode: fail,
    verifyCode: fail,
    session: async () => null,
    signOut: async () => {},
    hasAcceptedCurrentDocuments: fail,
    acceptDocuments: fail,
    getOwnProfile: fail,
    saveProfile: fail,
    uploadAvatar: fail,
    removeAvatar: fail,
    avatarDataUrl: fail,
    block: fail,
    unblock: fail,
    listBlocks: fail,
    report: fail,
    listNotices: fail,
    markNoticeRead: fail,
    isModerator: async () => false,
    listOpenReports: fail,
    actionsAbout: fail,
    decide: fail,
    exportOwnData: fail,
    deleteAccount: fail,
    badges: fail,
    practiceGraph: fail,
    publishPracticeDays: fail,
    publishMilestone: fail,
    setUsesLinux: fail,
    uploadBanner: fail,
    removeBanner: fail,
    bannerDataUrl: fail,
    searchMembers: fail,
    grantBadge: fail,
    revokeBadge: fail,
    members: fail,
    profileOf: fail,
    socialStats: fail,
    follow: fail,
    unfollow: fail,
    like: fail,
    unlike: fail,
    followers: fail,
    following: fail,
    conversations: fail,
    messages: fail,
    requestConversation: fail,
    respondConversation: fail,
    sendMessage: fail,
    deleteMessage: fail,
    suggestCorrection: fail,
    thankCorrection: fail,
    markRead: fail,
    reportContext: fail,
    subscribe: () => () => {},
  };
}
