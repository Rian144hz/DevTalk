import { z } from 'zod';
import { CHALLENGE_CATEGORIES } from '../domain/categories';

/** Mirrors challenge_schema in prompts/challenge.md. */
export const ChallengeSchema = z.object({
  category: z.enum(CHALLENGE_CATEGORIES),
  situation: z.string().trim().min(1),
  interlocutor: z.string().trim().min(1),
  task: z.string().trim().min(1),
  required_expressions: z.array(z.object({ expression: z.string(), hint: z.string() })),
  summary: z.string().trim().min(1),
});

export type ChallengePayload = z.infer<typeof ChallengeSchema>;
