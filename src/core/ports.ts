import type { ChallengeCategory, ExpressionType, MistakeCategory, TextSource } from './domain/categories';
import type { Challenge, Expression, ExpressionDraft, LearnerProfile } from './domain/types';
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

/** A saved feedback with everything needed to show it again. */
export interface StoredFeedback {
  feedbackId: number;
  attemptId: number;
  createdAt: string;
  text: string;
  challenge: Challenge | null;
  /** In the order the coach returned them. */
  corrections: { original: string; corrected: string; explanation: string; category: MistakeCategory }[];
  naturalRewrite: string;
  /** The new expressions this feedback suggested, in order (including ones that already existed). */
  expressions: Expression[];
  requiredChecks: { expression: Expression; used: boolean; usedCorrectly: boolean; note: string }[];
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
  /**
   * Keeps one expression for Review without any answer or feedback ("Keep in Review" on a checked text). The same
   * `normalizedText` as an expression that exists is not stored again: that one is returned with `isNew` false and
   * its card is left alone. `initialCard` is used only for a new expression.
   */
  saveExpression(e: ExpressionDraft & { normalizedText: string }, initialCard: SrsCard, now: Date): { expression: Expression; isNew: boolean };
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
  getFeedback(feedbackId: number): StoredFeedback | null;
  /** The newest challenge that has no answer yet. */
  pendingChallenge(): Challenge | null;
  /** The earliest due date of any card, or null when there are no cards. */
  nextDueAt(): Date | null;
  /** ISO timestamps of answers (feedbacks) and reviews at or after `since`, oldest first. */
  activityTimestamps(since: Date): { answers: string[]; reviews: string[] };
}
