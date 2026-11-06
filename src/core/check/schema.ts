import type { z } from 'zod';
import { FeedbackSchema } from '../feedback/schema';

/** The practice feedback without the challenge field: a real text has no required expressions. */
export const CheckSchema = FeedbackSchema.omit({ required_expressions_check: true });

export type CheckPayload = z.infer<typeof CheckSchema>;

/** Mirrors CheckSchema for the prompt (snake_case on the wire). */
export const CHECK_SCHEMA_EXAMPLE = `{
  "corrections": [{"original": "...", "corrected": "...", "explanation": "...", "category": "..."}],
  "natural_rewrite": "...",
  "new_expressions": [{"expression": "...", "type": "chunk | phrasal_verb | collocation", "meaning": "...", "example": "..."}]
}`;
