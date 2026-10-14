import type { ModerationDecision, ModerationReport, ProfileDraft, ReportInput, SocialProfile } from '../../core/social/types';
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
}

export interface ModerationHistoryItem {
  action: string;
  reason: string;
  until: string | null;
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
  };
}
