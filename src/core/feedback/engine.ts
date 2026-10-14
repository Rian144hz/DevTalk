import type { TextSource } from '../domain/categories';
import { normalizeExpression } from '../domain/text';
import type { Expression, LearnerProfile } from '../domain/types';
import { generateStructured, type ProgressStage } from '../llm/structured';
import type { LLMProvider } from '../llm/provider';
import type { Clock, StudyStore } from '../ports';
import { buildFeedbackUserMessage, coachSystemVars, type FeedbackContext } from '../prompts/messages';
import { renderTemplate } from '../prompts/render';
import { newCard } from '../srs/srs';
import { FeedbackSchema, type FeedbackPayload } from './schema';

export interface FeedbackInput {
  text: string;
  /** Stored for statistics only; the engine treats every source the same. */
  source: TextSource;
  context: FeedbackContext;
  learner: LearnerProfile;
}

export interface Feedback {
  feedbackId: number;
  attemptId: number;
  corrections: FeedbackPayload['corrections'];
  naturalRewrite: string;
  newExpressions: { expression: Expression; isNew: boolean }[];
  requiredChecks: { expression: Expression; used: boolean; usedCorrectly: boolean; note: string }[];
  latencyMs: number;
}

export class FeedbackEngine {
  constructor(
    private readonly deps: { provider: LLMProvider; store: StudyStore; clock: Clock; coachTemplate: string },
  ) {}

  async review(input: FeedbackInput, signal: AbortSignal, onProgress?: (s: ProgressStage) => void): Promise<Feedback> {
    const { provider, store, clock } = this.deps;
    const required = input.context.kind === 'challenge' ? input.context.challenge.required.map((r) => r.expression) : [];

    const started = clock.now();
    const { value, raw } = await generateStructured(provider, {
      system: renderTemplate(this.deps.coachTemplate, coachSystemVars(input.learner)),
      user: buildFeedbackUserMessage({ text: input.text, context: input.context }),
      schema: FeedbackSchema,
      schemaName: 'feedback',
      signal,
      refine: (payload) => missingChecks(payload, required),
      onProgress,
    });
    const now = clock.now();
    const latencyMs = now.getTime() - started.getTime();

    const requiredChecks = required.map((expression) => {
      const check = findCheck(value, expression)!;
      // A correct use only counts when the expression was actually used.
      return { expression, used: check.used, usedCorrectly: check.used && check.used_correctly, note: check.note };
    });

    const saved = store.saveFeedback({
      attempt: {
        challengeId: input.context.kind === 'challenge' ? input.context.challenge.id : null,
        text: input.text,
        source: input.source,
      },
      feedback: { naturalRewrite: value.natural_rewrite, provider: provider.id, model: provider.model, latencyMs, rawJson: raw },
      corrections: value.corrections,
      newExpressions: uniqueExpressions(value.new_expressions),
      checks: requiredChecks.map((c) => ({ expressionId: c.expression.id, used: c.used, usedCorrectly: c.usedCorrectly, note: c.note })),
      initialCard: newCard(now),
      now,
    });

    return {
      feedbackId: saved.feedbackId,
      attemptId: saved.attemptId,
      corrections: value.corrections,
      naturalRewrite: value.natural_rewrite,
      newExpressions: saved.expressions,
      requiredChecks,
      latencyMs,
    };
  }
}

function findCheck(payload: FeedbackPayload, expression: Expression) {
  const wanted = normalizeExpression(expression.text);
  return payload.required_expressions_check.find((c) => normalizeExpression(c.expression) === wanted);
}

function missingChecks(payload: FeedbackPayload, required: Expression[]): string | null {
  const missing = required.filter((e) => !findCheck(payload, e)).map((e) => `"${e.text}"`);
  return missing.length ? `required_expressions_check is missing ${missing.join(', ')}` : null;
}

function uniqueExpressions(items: FeedbackPayload['new_expressions']) {
  const seen = new Set<string>();
  return items.flatMap((e) => {
    const normalizedText = normalizeExpression(e.expression);
    if (!normalizedText || seen.has(normalizedText)) return [];
    seen.add(normalizedText);
    return [{ text: e.expression.trim(), normalizedText, type: e.type, meaning: e.meaning, example: e.example }];
  });
}
