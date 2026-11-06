import { MISTAKE_CATEGORIES } from '../domain/categories';
import { normalizeExpression } from '../domain/text';
import type { ExpressionDraft, LearnerProfile } from '../domain/types';
import type { LLMProvider } from '../llm/provider';
import { generateStructured, type ProgressStage } from '../llm/structured';
import { fenced, learnerVars } from '../prompts/messages';
import { renderTemplate } from '../prompts/render';
import { CHECK_SCHEMA_EXAMPLE, CheckSchema, type CheckPayload } from './schema';
import { CHECK_TYPE_LABELS, CHECK_TYPE_TONES, type CheckResult, type CheckType } from './types';

/** What the check prompt (prompts/check.md) fills in: the learner, the text type and its tone. */
export function checkSystemVars(type: CheckType, learner: LearnerProfile): Record<string, string> {
  return {
    ...learnerVars(learner),
    mistake_categories: MISTAKE_CATEGORIES.join(', '),
    text_type: CHECK_TYPE_LABELS[type],
    type_tone: CHECK_TYPE_TONES[type],
    check_schema: CHECK_SCHEMA_EXAMPLE,
  };
}

/** The type first, then the text between triple quotes (a triple quote inside the text cannot close the block). */
export function buildCheckUserMessage(type: CheckType, text: string): string {
  return [`Text type: ${CHECK_TYPE_LABELS[type]}`, '', "Learner's text:", fenced(text)].join('\n');
}

/**
 * Checks a real text with the coach. It has no store on purpose: the text, the corrections and the expressions
 * are returned and nothing is kept (the person decides which expressions go to Review).
 */
export class TextChecker {
  constructor(private readonly deps: { provider: LLMProvider; template: string }) {}

  async check(
    input: { type: CheckType; text: string; learner: LearnerProfile },
    signal: AbortSignal,
    onProgress?: (s: ProgressStage) => void,
  ): Promise<CheckResult> {
    const { value } = await generateStructured(this.deps.provider, {
      system: renderTemplate(this.deps.template, checkSystemVars(input.type, input.learner)),
      user: buildCheckUserMessage(input.type, input.text),
      schema: CheckSchema,
      schemaName: 'check',
      signal,
      onProgress,
    });
    return { corrections: value.corrections, naturalRewrite: value.natural_rewrite, expressions: uniqueDrafts(value.new_expressions) };
  }
}

/** One draft per expression, even when the coach repeats one in another case or with punctuation. */
function uniqueDrafts(items: CheckPayload['new_expressions']): ExpressionDraft[] {
  const seen = new Set<string>();
  return items.flatMap((e) => {
    const key = normalizeExpression(e.expression);
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [{ text: e.expression.trim(), type: e.type, meaning: e.meaning, example: e.example }];
  });
}
