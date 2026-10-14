import type { ChallengeCategory, ExpressionType, MistakeCategory, TextSource } from './domain/categories';
import type { Challenge, Expression, LearnerProfile } from './domain/types';
import type { SrsCard, SrsLog } from './srs/srs';

export interface Clock {
  now(): Date;
}

export type Theme = 'system' | 'dark' | 'light';
export type ProfileInput = LearnerProfile & { provider: string; model: string; theme: Theme };
export type StoredProfile = ProfileInput & { onboardedAt: string | null };

export interface NewChallenge {
  category: ChallengeCategory;
  situation: string;
  interlocutor: string;
  task: string;
  summary: string;
  required: { expressionId: number; hint: string }[];
}

export interface SaveFeedbackInput {
  attempt: { challengeId: number | null; text: string; source: TextSource };
  feedback: { naturalRewrite: string; provider: string; model: string; latencyMs: number; rawJson: string };
  corrections: { original: string; corrected: string; explanation: string; category: MistakeCategory }[];
  newExpressions: { text: string; normalizedText: string; type: ExpressionType; meaning: string; example: string }[];
  checks: { expressionId: number; used: boolean; usedCorrectly: boolean; note: string }[];
  /** Used only for expressions that did not exist yet. */
  initialCard: SrsCard;
  now: Date;
}

export interface SavedFeedback {
  feedbackId: number;
  attemptId: number;
  expressions: { expression: Expression; isNew: boolean }[];
}

export interface DueCard {
  expression: Expression;
  card: SrsCard;
}

export interface HistoryItem {
  attemptId: number;
  feedbackId: number;
  createdAt: string;
  category: ChallengeCategory | null;
  text: string;
  correctionCount: number;
}

export interface StudyStore {
  getProfile(): StoredProfile | null;
  saveProfile(p: ProfileInput, now: Date): void;
  saveChallenge(c: NewChallenge, now: Date): Challenge;
  getChallenge(id: number): Challenge | null;
  /** Newest first. */
  recentChallenges(limit: number): { category: ChallengeCategory; summary: string }[];
  /** Atomic: either everything is stored or nothing is. */
  saveFeedback(input: SaveFeedbackInput): SavedFeedback;
  /** Cards with due <= now, most overdue first. */
  dueCards(now: Date, opts: { excludeNew: boolean; limit: number }): DueCard[];
  getCard(expressionId: number): SrsCard | null;
  saveReview(expressionId: number, card: SrsCard, log: SrsLog): void;
  /** Sorted by count desc; categories with zero corrections are omitted. */
  mistakeCounts(since: Date | null): { category: MistakeCategory; count: number }[];
  /** Distinct expressions with at least one correct use in a challenge. */
  reusedExpressionCount(): number;
  expressionCount(): number;
  countDue(before: Date): number;
  /** Newest first; `before` is a createdAt cursor (exclusive). */
  history(opts: { before: string | null; limit: number }): HistoryItem[];
}
