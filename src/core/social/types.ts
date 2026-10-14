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
export const LEGAL_VERSION = '2026-10-14';

export const PROFILE_LIMITS = {
  displayName: { min: 2, max: 40 },
  nativeLanguage: { min: 1, max: 60 },
  stackTags: 10,
  stackTagLength: 30,
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
}

export type ProfileDraft = Omit<SocialProfile, 'id' | 'hasAvatar' | 'suspendedUntil'>;

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
  reported: { id: string; displayName: string } | null;
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
