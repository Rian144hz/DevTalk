import type { ChallengeCategory, MistakeCategory, TextSource } from '../domain/categories';
import type { Challenge, Expression } from '../domain/types';
import type {
  DueCard,
  HistoryItem,
  NewChallenge,
  ProfileInput,
  SaveFeedbackInput,
  SavedFeedback,
  StoredFeedback,
  StoredProfile,
  StudyStore,
} from '../ports';
import type { SrsCard, SrsLog } from '../srs/srs';

interface ChallengeRow extends NewChallenge {
  id: number;
  createdAt: string;
}
interface AttemptRow {
  id: number;
  challengeId: number | null;
  text: string;
  source: TextSource;
  createdAt: string;
}
interface FeedbackRow {
  id: number;
  attemptId: number;
  naturalRewrite: string;
  expressionIds: number[];
  createdAt: string;
}
interface CorrectionRow {
  feedbackId: number;
  original: string;
  corrected: string;
  explanation: string;
  category: MistakeCategory;
  createdAt: string;
}
interface CheckRow {
  feedbackId: number;
  expressionId: number;
  used: boolean;
  usedCorrectly: boolean;
  note: string;
}

/** In-memory StudyStore for core tests; behaviour is pinned by the shared contract suite. */
export class MemoryStudyStore implements StudyStore {
  private profile: StoredProfile | null = null;
  private challenges: ChallengeRow[] = [];
  private attempts: AttemptRow[] = [];
  private feedbacks: FeedbackRow[] = [];
  private corrections: CorrectionRow[] = [];
  private checks: CheckRow[] = [];
  private expressions: (Expression & { normalizedText: string })[] = [];
  private cards = new Map<number, SrsCard>();
  private logs: { expressionId: number; log: SrsLog }[] = [];
  private nextId = 1;

  getProfile(): StoredProfile | null {
    return this.profile ? { ...this.profile } : null;
  }

  saveProfile(p: ProfileInput, now: Date): void {
    this.profile = { ...p, onboardedAt: this.profile?.onboardedAt ?? now.toISOString() };
  }

  saveChallenge(c: NewChallenge, now: Date): Challenge {
    for (const r of c.required) this.expressionById(r.expressionId);
    const row: ChallengeRow = { ...c, required: [...c.required], id: this.nextId++, createdAt: now.toISOString() };
    this.challenges.push(row);
    return this.toChallenge(row);
  }

  getChallenge(id: number): Challenge | null {
    const row = this.challenges.find((c) => c.id === id);
    return row ? this.toChallenge(row) : null;
  }

  recentChallenges(limit: number): { category: ChallengeCategory; summary: string }[] {
    return [...this.challenges]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
      .slice(0, limit)
      .map((c) => ({ category: c.category, summary: c.summary }));
  }

  saveFeedback(input: SaveFeedbackInput): SavedFeedback {
    // Validate everything before mutating, so a failure leaves no trace.
    for (const check of input.checks) this.expressionById(check.expressionId);
    if (input.attempt.challengeId !== null && !this.challenges.some((c) => c.id === input.attempt.challengeId)) {
      throw new Error(`Unknown challenge ${input.attempt.challengeId}`);
    }

    const createdAt = input.now.toISOString();
    const attemptId = this.nextId++;
    const feedbackId = this.nextId++;
    this.attempts.push({ id: attemptId, ...input.attempt, createdAt });
    const feedback: FeedbackRow = { id: feedbackId, attemptId, naturalRewrite: input.feedback.naturalRewrite, expressionIds: [], createdAt };
    this.feedbacks.push(feedback);
    for (const c of input.corrections) this.corrections.push({ feedbackId, ...c, createdAt });
    for (const c of input.checks) this.checks.push({ feedbackId, ...c });

    const expressions = input.newExpressions.map((e) => {
      const existing = this.expressions.find((x) => x.normalizedText === e.normalizedText);
      if (existing) return { expression: stripNormalized(existing), isNew: false };
      const created = { id: this.nextId++, text: e.text, type: e.type, meaning: e.meaning, example: e.example, normalizedText: e.normalizedText };
      this.expressions.push(created);
      this.cards.set(created.id, { ...input.initialCard });
      return { expression: stripNormalized(created), isNew: true };
    });
    feedback.expressionIds = expressions.map((e) => e.expression.id);
    return { feedbackId, attemptId, expressions };
  }

  getFeedback(feedbackId: number): StoredFeedback | null {
    const f = this.feedbacks.find((x) => x.id === feedbackId);
    if (!f) return null;
    const attempt = this.attempts.find((a) => a.id === f.attemptId)!;
    return {
      feedbackId: f.id,
      attemptId: attempt.id,
      createdAt: f.createdAt,
      text: attempt.text,
      challenge: attempt.challengeId === null ? null : this.getChallenge(attempt.challengeId),
      corrections: this.corrections
        .filter((c) => c.feedbackId === f.id)
        .map(({ original, corrected, explanation, category }) => ({ original, corrected, explanation, category })),
      naturalRewrite: f.naturalRewrite,
      expressions: f.expressionIds.map((id) => this.expressionById(id)),
      requiredChecks: this.checks
        .filter((c) => c.feedbackId === f.id)
        .map((c) => ({ expression: this.expressionById(c.expressionId), used: c.used, usedCorrectly: c.usedCorrectly, note: c.note })),
    };
  }

  pendingChallenge(): Challenge | null {
    const answered = new Set(this.attempts.map((a) => a.challengeId));
    const row = [...this.challenges]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
      .find((c) => !answered.has(c.id));
    return row ? this.toChallenge(row) : null;
  }

  nextDueAt(): Date | null {
    const dues = [...this.cards.values()].map((c) => c.due.getTime());
    return dues.length ? new Date(Math.min(...dues)) : null;
  }

  dueCards(now: Date, opts: { excludeNew: boolean; limit: number }): DueCard[] {
    return [...this.cards.entries()]
      .filter(([, card]) => card.due <= now && !(opts.excludeNew && card.state === 'new'))
      .sort(([idA, a], [idB, b]) => a.due.getTime() - b.due.getTime() || idA - idB)
      .slice(0, opts.limit)
      .map(([id, card]) => ({ expression: this.expressionById(id), card: { ...card } }));
  }

  getCard(expressionId: number): SrsCard | null {
    const card = this.cards.get(expressionId);
    return card ? { ...card } : null;
  }

  saveReview(expressionId: number, card: SrsCard, log: SrsLog): void {
    this.expressionById(expressionId);
    this.cards.set(expressionId, { ...card });
    this.logs.push({ expressionId, log });
  }

  mistakeCounts(since: Date | null): { category: MistakeCategory; count: number }[] {
    const counts = new Map<MistakeCategory, number>();
    for (const c of this.corrections) {
      if (since && c.createdAt < since.toISOString()) continue;
      counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  }

  reusedExpressionCount(): number {
    return new Set(this.checks.filter((c) => c.usedCorrectly).map((c) => c.expressionId)).size;
  }

  expressionCount(): number {
    return this.expressions.length;
  }

  activityTimestamps(since: Date): { answers: string[]; reviews: string[] } {
    const from = since.toISOString();
    return {
      answers: this.feedbacks.map((f) => f.createdAt).filter((t) => t >= from).sort(),
      reviews: this.logs.map((l) => l.log.review.toISOString()).filter((t) => t >= from).sort(),
    };
  }

  countDue(before: Date): number {
    return [...this.cards.values()].filter((c) => c.due <= before).length;
  }

  history(opts: { before: string | null; limit: number }): HistoryItem[] {
    return this.feedbacks
      .filter((f) => opts.before === null || f.createdAt < opts.before)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
      .slice(0, opts.limit)
      .map((f) => {
        const attempt = this.attempts.find((a) => a.id === f.attemptId)!;
        const challenge = this.challenges.find((c) => c.id === attempt.challengeId);
        return {
          attemptId: attempt.id,
          feedbackId: f.id,
          createdAt: f.createdAt,
          category: challenge?.category ?? null,
          text: attempt.text,
          correctionCount: this.corrections.filter((c) => c.feedbackId === f.id).length,
        };
      });
  }

  private expressionById(id: number): Expression {
    const e = this.expressions.find((x) => x.id === id);
    if (!e) throw new Error(`Unknown expression ${id}`);
    return stripNormalized(e);
  }

  private toChallenge(row: ChallengeRow): Challenge {
    return {
      id: row.id,
      category: row.category,
      situation: row.situation,
      interlocutor: row.interlocutor,
      task: row.task,
      summary: row.summary,
      createdAt: row.createdAt,
      required: row.required.map((r) => ({ expression: this.expressionById(r.expressionId), hint: r.hint })),
    };
  }
}

function stripNormalized(e: Expression & { normalizedText: string }): Expression {
  return { id: e.id, text: e.text, type: e.type, meaning: e.meaning, example: e.example };
}
