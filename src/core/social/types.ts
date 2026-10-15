import type { Level } from '../domain/types';

export const AREAS = ['backend', 'frontend', 'mobile', 'data', 'devops', 'other'] as const;
export type Area = (typeof AREAS)[number];

export const REPORT_REASONS = ['harassment', 'hate', 'sexual', 'spam', 'impersonation', 'minor', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_CONTEXTS = ['profile', 'message', 'room'] as const;
export type ReportContext = (typeof REPORT_CONTEXTS)[number];

/** Documents accepted at sign-up; `age_18` is stored alongside them as an attestation. */
export const LEGAL_DOCUMENTS = ['terms', 'privacy', 'conduct'] as const;
export type LegalDocument = (typeof LEGAL_DOCUMENTS)[number];
export const LEGAL_VERSION = '2026-10-15.2';

/** Default pictures for members without a photo (files in src/renderer/assets/mascots). */
export const MASCOTS = ['duck-1', 'duck-2', 'duck-3', 'bear-1', 'bear-2', 'bear-3', 'axolotl-1', 'axolotl-2', 'axolotl-3'] as const;
export type MascotId = (typeof MASCOTS)[number];

export const PROFILE_LIMITS = {
  displayName: { min: 2, max: 40 },
  nativeLanguage: { min: 1, max: 60 },
  stackTags: 10,
  stackTagLength: 30,
  mainStack: 2,
  availabilitySlots: 14,
  bio: 160,
  reportDetails: 1000,
} as const;

export interface AvailabilitySlot {
  day: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  from: string;
  to: string;
}

export interface SocialProfile {
  id: string;
  displayName: string;
  nativeLanguage: string;
  level: Level;
  timezone: string;
  area: Area;
  stack: string[];
  availability: AvailabilitySlot[];
  bio: string;
  hasAvatar: boolean;
  suspendedUntil: string | null;
  /** Up to two stacks shown as language badges. */
  mainStack: string[];
  /** Whether other members see the practice graph and evolution badges. */
  showProgress: boolean;
  /** Chosen default picture; null = the stable default for this account. */
  mascot: MascotId | null;
  hasBanner: boolean;
  /** Shown in the member list; when false, the profile is still reachable through follower lists or a link. */
  listed: boolean;
}

export type ProfileDraft = Omit<SocialProfile, 'id' | 'hasAvatar' | 'suspendedUntil' | 'hasBanner'>;

export type BadgeGroup = 'community' | 'technical' | 'language' | 'evolution';
/** One badge as the server computes it (`profile_badges`). */
/** A member as moderators find them when giving badges. */
export interface MemberSummary {
  id: string;
  displayName: string;
  hasAvatar: boolean;
  mascot: MascotId | null;
}

export interface Badge {
  id: string;
  group: BadgeGroup;
  label: string;
  detail: string | null;
}

export interface ReportInput {
  reported: string;
  contextType: ReportContext;
  contextId: string | null;
  reason: ReportReason;
  details: string;
}

export interface ModerationReport {
  id: number;
  reporter: string;
  reported: { id: string; displayName: string; mascot: MascotId | null; hasAvatar: boolean } | null;
  contextType: ReportContext;
  contextId: string | null;
  reason: ReportReason;
  details: string;
  createdAt: string;
}

export type ModerationDecision =
  | { kind: 'dismiss'; reportId: number }
  | { kind: 'warn'; reportId: number | null; target: string; message: string }
  | { kind: 'suspend'; reportId: number | null; target: string; days: 1 | 7 | 30 | null; reason: string }
  | { kind: 'unsuspend'; target: string };

/** A member as lists show them (member list, followers, following). */
export interface MemberRow {
  id: string;
  displayName: string;
  level: Level;
  area: Area;
  mainStack: string[];
  mascot: MascotId | null;
  hasAvatar: boolean;
}

/** Public counts of a profile, plus the caller's own follow and like. */
export interface SocialStats {
  followers: number;
  following: number;
  likes: number;
  iFollow: boolean;
  iLike: boolean;
}

export interface MemberFilters {
  query?: string;
  level?: Level;
  area?: Area;
  stack?: string;
}

export type NoticeKind = 'moderation' | 'follow';

/** Who caused a notice (the follower of a follow notice), enough to show their picture and link. */
export interface NoticeActor {
  id: string;
  displayName: string;
  hasAvatar: boolean;
  mascot: MascotId | null;
}
