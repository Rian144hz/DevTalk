import { z } from 'zod';
import type { InvokeChannel } from '../../shared/ipc-contract';
import { LEVELS } from '../../core/domain/types';

export const MAX_ANSWER_CHARS = 4000;

const empty = z.object({}).strict();
const requestId = z.object({ requestId: z.string().min(1).max(100) }).strict();
const settings = z.object({
  provider: z.enum(['anthropic', 'ollama']),
  model: z.string().trim().min(1).max(100),
  theme: z.enum(['system', 'dark', 'light']),
});
const language = z.string().trim().min(1).max(60);

/** Every invoke payload is validated here before any handler logic runs. */
export const INPUT_SCHEMAS = {
  'profile:get': empty,
  'profile:save': settings
    .extend({
      nativeLanguage: language,
      currentLevel: z.enum(LEVELS),
      targetLevel: z.enum(LEVELS),
      explanationLanguage: language,
    })
    .strict(),
  'keys:status': empty,
  'keys:set': z.object({ key: z.string().trim().min(1).max(500) }).strict(),
  'keys:clear': empty,
  'challenges:next': requestId,
  'challenges:cancel': requestId,
  'feedback:submit': z
    .object({
      requestId: z.string().min(1).max(100),
      challengeId: z.number().int().positive().nullable(),
      text: z.string().trim().min(1).max(MAX_ANSWER_CHARS),
    })
    .strict(),
  'feedback:cancel': requestId,
  'review:queue': empty,
  'review:rate': z.object({ expressionId: z.number().int().positive(), rating: z.enum(['again', 'hard', 'good', 'easy']) }).strict(),
  'progress:summary': empty,
  'progress:history': z.object({ before: z.string().nullable(), limit: z.number().int().min(1).max(100).default(20) }).strict(),
  'settings:get': empty,
  'settings:set': settings.partial().strict(),
} satisfies Record<InvokeChannel, z.ZodType>;
