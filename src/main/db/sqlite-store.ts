import type { ChallengeCategory, ExpressionType, MistakeCategory } from '../../core/domain/categories';
import type { Challenge, Expression, Level } from '../../core/domain/types';
import type {
  DueCard,
  HistoryItem,
  NewChallenge,
  ProfileInput,
  SaveFeedbackInput,
  SavedFeedback,
  StoredProfile,
  StudyStore,
  Theme,
} from '../../core/ports';
import type { CardState, SrsCard, SrsLog } from '../../core/srs/srs';
import type { DB } from './open';

interface ExpressionRow {
  id: number;
  text: string;
  type: ExpressionType;
  meaning: string;
  example: string;
}
interface CardRow {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: CardState;
  last_review: string | null;
}

const toExpression = (r: ExpressionRow): Expression => ({ id: r.id, text: r.text, type: r.type, meaning: r.meaning, example: r.example });

const toCard = (r: CardRow): SrsCard => ({
  due: new Date(r.due),
  stability: r.stability,
  difficulty: r.difficulty,
  elapsedDays: r.elapsed_days,
  scheduledDays: r.scheduled_days,
  learningSteps: r.learning_steps,
  reps: r.reps,
  lapses: r.lapses,
  state: r.state,
  lastReview: r.last_review ? new Date(r.last_review) : null,
});

const cardParams = (expressionId: number, c: SrsCard) => ({
  expression_id: expressionId,
  due: c.due.toISOString(),
  stability: c.stability,
  difficulty: c.difficulty,
  elapsed_days: c.elapsedDays,
  scheduled_days: c.scheduledDays,
  learning_steps: c.learningSteps,
  reps: c.reps,
  lapses: c.lapses,
  state: c.state,
  last_review: c.lastReview ? c.lastReview.toISOString() : null,
});

const UPSERT_CARD = `
  INSERT INTO review_cards (expression_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review)
  VALUES (@expression_id, @due, @stability, @difficulty, @elapsed_days, @scheduled_days, @learning_steps, @reps, @lapses, @state, @last_review)
  ON CONFLICT(expression_id) DO UPDATE SET
    due = excluded.due, stability = excluded.stability, difficulty = excluded.difficulty, elapsed_days = excluded.elapsed_days,
    scheduled_days = excluded.scheduled_days, learning_steps = excluded.learning_steps, reps = excluded.reps,
    lapses = excluded.lapses, state = excluded.state, last_review = excluded.last_review`;

export class SqliteStudyStore implements StudyStore {
  constructor(private readonly db: DB) {}

  getProfile(): StoredProfile | null {
    const r = this.db.prepare('SELECT * FROM profile WHERE id = 1').get() as
      | { native_language: string; current_level: Level; target_level: Level; explanation_language: string; provider: string; model: string; theme: Theme; onboarded_at: string | null }
      | undefined;
    if (!r) return null;
    return {
      nativeLanguage: r.native_language,
      currentLevel: r.current_level,
      targetLevel: r.target_level,
      explanationLanguage: r.explanation_language,
      provider: r.provider,
      model: r.model,
      theme: r.theme,
      onboardedAt: r.onboarded_at,
    };
  }

  saveProfile(p: ProfileInput, now: Date): void {
    this.db
      .prepare(
        `INSERT INTO profile (id, native_language, current_level, target_level, explanation_language, provider, model, theme, onboarded_at)
         VALUES (1, @nativeLanguage, @currentLevel, @targetLevel, @explanationLanguage, @provider, @model, @theme, @now)
         ON CONFLICT(id) DO UPDATE SET
           native_language = excluded.native_language, current_level = excluded.current_level, target_level = excluded.target_level,
           explanation_language = excluded.explanation_language, provider = excluded.provider, model = excluded.model, theme = excluded.theme`,
      )
      .run({ ...p, now: now.toISOString() });
  }

  saveChallenge(c: NewChallenge, now: Date): Challenge {
    const id = this.db.transaction(() => {
      const { lastInsertRowid } = this.db
        .prepare('INSERT INTO challenges (category, situation, interlocutor, task, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(c.category, c.situation, c.interlocutor, c.task, c.summary, now.toISOString());
      const insertReq = this.db.prepare('INSERT INTO challenge_required (challenge_id, expression_id, position, hint) VALUES (?, ?, ?, ?)');
      c.required.forEach((r, i) => insertReq.run(lastInsertRowid, r.expressionId, i, r.hint));
      return Number(lastInsertRowid);
    })();
    return this.getChallenge(id)!;
  }

  getChallenge(id: number): Challenge | null {
    const row = this.db.prepare('SELECT * FROM challenges WHERE id = ?').get(id) as
      | { id: number; category: ChallengeCategory; situation: string; interlocutor: string; task: string; summary: string; created_at: string }
      | undefined;
    if (!row) return null;
    const required = this.db
      .prepare(
        `SELECT e.id, e.text, e.type, e.meaning, e.example, cr.hint FROM challenge_required cr
         JOIN expressions e ON e.id = cr.expression_id WHERE cr.challenge_id = ? ORDER BY cr.position`,
      )
      .all(id) as (ExpressionRow & { hint: string })[];
    return {
      id: row.id,
      category: row.category,
      situation: row.situation,
      interlocutor: row.interlocutor,
      task: row.task,
      summary: row.summary,
      createdAt: row.created_at,
      required: required.map((r) => ({ expression: toExpression(r), hint: r.hint })),
    };
  }

  recentChallenges(limit: number): { category: ChallengeCategory; summary: string }[] {
    return this.db
      .prepare('SELECT category, summary FROM challenges ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(limit) as { category: ChallengeCategory; summary: string }[];
  }

  saveFeedback(input: SaveFeedbackInput): SavedFeedback {
    return this.db.transaction((): SavedFeedback => {
      const createdAt = input.now.toISOString();
      const attemptId = Number(
        this.db
          .prepare('INSERT INTO attempts (challenge_id, text, source, created_at) VALUES (?, ?, ?, ?)')
          .run(input.attempt.challengeId, input.attempt.text, input.attempt.source, createdAt).lastInsertRowid,
      );
      const f = input.feedback;
      const feedbackId = Number(
        this.db
          .prepare(
            'INSERT INTO feedbacks (attempt_id, natural_rewrite, provider, model, latency_ms, raw_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(attemptId, f.naturalRewrite, f.provider, f.model, f.latencyMs, f.rawJson, createdAt).lastInsertRowid,
      );

      const insertCorrection = this.db.prepare(
        'INSERT INTO corrections (feedback_id, position, original, corrected, explanation, category) VALUES (?, ?, ?, ?, ?, ?)',
      );
      input.corrections.forEach((c, i) => insertCorrection.run(feedbackId, i, c.original, c.corrected, c.explanation, c.category));

      const insertCheck = this.db.prepare(
        'INSERT INTO expression_checks (feedback_id, expression_id, used, used_correctly, note) VALUES (?, ?, ?, ?, ?)',
      );
      for (const c of input.checks) insertCheck.run(feedbackId, c.expressionId, c.used ? 1 : 0, c.usedCorrectly ? 1 : 0, c.note);

      const insertExpr = this.db.prepare(
        `INSERT INTO expressions (text, normalized_text, type, meaning, example, origin_feedback_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(normalized_text) DO NOTHING RETURNING id`,
      );
      const findExpr = this.db.prepare('SELECT id, text, type, meaning, example FROM expressions WHERE normalized_text = ?');
      const insertCard = this.db.prepare(UPSERT_CARD);
      const link = this.db.prepare('INSERT OR IGNORE INTO feedback_expressions (feedback_id, expression_id, position) VALUES (?, ?, ?)');

      const expressions = input.newExpressions.map((e, i) => {
        const inserted = insertExpr.get(e.text, e.normalizedText, e.type, e.meaning, e.example, feedbackId, createdAt) as { id: number } | undefined;
        if (inserted) insertCard.run(cardParams(inserted.id, input.initialCard));
        const row = findExpr.get(e.normalizedText) as ExpressionRow;
        link.run(feedbackId, row.id, i);
        return { expression: toExpression(row), isNew: inserted !== undefined };
      });
      return { feedbackId, attemptId, expressions };
    })();
  }

  dueCards(now: Date, opts: { excludeNew: boolean; limit: number }): DueCard[] {
    const rows = this.db
      .prepare(
        `SELECT e.id, e.text, e.type, e.meaning, e.example, c.* FROM review_cards c
         JOIN expressions e ON e.id = c.expression_id
         WHERE c.due <= ? ${opts.excludeNew ? "AND c.state <> 'new'" : ''}
         ORDER BY c.due ASC, e.id ASC LIMIT ?`,
      )
      .all(now.toISOString(), opts.limit) as (ExpressionRow & CardRow)[];
    return rows.map((r) => ({ expression: toExpression(r), card: toCard(r) }));
  }

  getCard(expressionId: number): SrsCard | null {
    const row = this.db.prepare('SELECT * FROM review_cards WHERE expression_id = ?').get(expressionId) as CardRow | undefined;
    return row ? toCard(row) : null;
  }

  saveReview(expressionId: number, card: SrsCard, log: SrsLog): void {
    this.db.transaction(() => {
      this.db.prepare(UPSERT_CARD).run(cardParams(expressionId, card));
      this.db
        .prepare(
          `INSERT INTO review_logs (expression_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, review, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          expressionId,
          log.rating,
          log.state,
          log.due.toISOString(),
          log.stability,
          log.difficulty,
          log.elapsedDays,
          log.scheduledDays,
          log.review.toISOString(),
          log.review.toISOString(),
        );
    })();
  }

  mistakeCounts(since: Date | null): { category: MistakeCategory; count: number }[] {
    return this.db
      .prepare(
        `SELECT c.category, COUNT(*) AS count FROM corrections c JOIN feedbacks f ON f.id = c.feedback_id
         WHERE (? IS NULL OR f.created_at >= ?)
         GROUP BY c.category ORDER BY count DESC, c.category ASC`,
      )
      .all(since?.toISOString() ?? null, since?.toISOString() ?? null) as { category: MistakeCategory; count: number }[];
  }

  reusedExpressionCount(): number {
    return (this.db.prepare('SELECT COUNT(DISTINCT expression_id) AS n FROM expression_checks WHERE used_correctly = 1').get() as { n: number }).n;
  }

  expressionCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM expressions').get() as { n: number }).n;
  }

  countDue(before: Date): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM review_cards WHERE due <= ?').get(before.toISOString()) as { n: number }).n;
  }

  history(opts: { before: string | null; limit: number }): HistoryItem[] {
    return this.db
      .prepare(
        `SELECT a.id AS attemptId, f.id AS feedbackId, f.created_at AS createdAt, ch.category AS category, a.text AS text,
                (SELECT COUNT(*) FROM corrections c WHERE c.feedback_id = f.id) AS correctionCount
         FROM feedbacks f JOIN attempts a ON a.id = f.attempt_id LEFT JOIN challenges ch ON ch.id = a.challenge_id
         WHERE (? IS NULL OR f.created_at < ?)
         ORDER BY f.created_at DESC, f.id DESC LIMIT ?`,
      )
      .all(opts.before, opts.before, opts.limit) as HistoryItem[];
  }
}
