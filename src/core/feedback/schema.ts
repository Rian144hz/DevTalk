import { z } from 'zod';
import { EXPRESSION_TYPES, MISTAKE_CATEGORIES } from '../domain/categories';

/** Mirrors the feedback_schema in prompts/coach.md (snake_case on the wire). */
export const FeedbackSchema = z.object({
  corrections: z.array(
    z.object({
      original: z.string(),
      corrected: z.string(),
      explanation: z.string().min(1),
      category: z.enum(MISTAKE_CATEGORIES),
    }),
  ),
  natural_rewrite: z.string().trim().min(1),
  new_expressions: z
    .array(
      z.object({
        expression: z.string().trim().min(1),
        type: z.enum(EXPRESSION_TYPES),
        meaning: z.string().min(1),
        example: z.string().min(1),
      }),
    )
    .min(2)
    .max(3),
  required_expressions_check: z.array(
    z.object({
      expression: z.string(),
      used: z.boolean(),
      used_correctly: z.boolean(),
      note: z.string(),
    }),
  ),
});

export type FeedbackPayload = z.infer<typeof FeedbackSchema>;
