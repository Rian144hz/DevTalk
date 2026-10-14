import { z } from 'zod';
import type { InvokeChannel } from '../../shared/ipc-contract';
import { LEVELS } from '../../core/domain/types';
import { PROVIDERS } from '../../shared/providers';
import { PROFILE_LIMITS, REPORT_CONTEXTS, REPORT_REASONS } from '../../core/social/types';
import { ProfileDraftSchema } from '../../core/social/validate';

export const MAX_ANSWER_CHARS = 4000;

const empty = z.object({}).strict();
const requestId = z.object({ requestId: z.string().min(1).max(100) }).strict();
const settings = z.object({
  provider: z.enum(PROVIDERS),
  model: z.string().trim().min(1).max(100),
  theme: z.enum(['system', 'dark', 'light']),
});
const language = z.string().trim().min(1).max(60);
const email = z.string().trim().toLowerCase().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid e-mail address.');
const userId = z.string().min(1).max(64);
const MAX_AVATAR_INPUT = 8 * 1024 * 1024;
const reportId = z.number().int().positive();
const decision = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dismiss'), reportId }).strict(),
  z.object({ kind: z.literal('warn'), reportId: reportId.nullable(), target: userId, message: z.string().trim().min(1).max(1000) }).strict(),
  z
    .object({
      kind: z.literal('suspend'),
      reportId: reportId.nullable(),
      target: userId,
      days: z.union([z.literal(1), z.literal(7), z.literal(30), z.null()]),
      reason: z.string().trim().min(1).max(1000),
    })
    .strict(),
  z.object({ kind: z.literal('unsuspend'), target: userId }).strict(),
]);

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
  'keys:status': z.object({ provider: z.enum(PROVIDERS).optional() }).strict(),
  'keys:set': z.object({ key: z.string().trim().min(1).max(500), provider: z.enum(PROVIDERS).optional() }).strict(),
  'keys:clear': z.object({ provider: z.enum(PROVIDERS).optional() }).strict(),
  'challenges:next': requestId,
  'challenges:cancel': requestId,
  'challenges:pending': empty,
  'feedback:submit': z
    .object({
      requestId: z.string().min(1).max(100),
      challengeId: z.number().int().positive().nullable(),
      text: z.string().trim().min(1).max(MAX_ANSWER_CHARS),
    })
    .strict(),
  'feedback:cancel': requestId,
  'feedback:get': z.object({ feedbackId: z.number().int().positive() }).strict(),
  'review:queue': empty,
  'review:rate': z.object({ expressionId: z.number().int().positive(), rating: z.enum(['again', 'hard', 'good', 'easy']) }).strict(),
  'progress:summary': empty,
  'progress:history': z.object({ before: z.string().nullable(), limit: z.number().int().min(1).max(100).default(20) }).strict(),
  'settings:get': empty,
  'settings:set': settings.partial().strict(),
  'llm:check': empty,
  'social:status': empty,
  'social:sendCode': z.object({ email }).strict(),
  'social:verifyCode': z.object({ email, code: z.string().regex(/^\d{6,10}$/, 'The code has 6 to 10 digits.') }).strict(),
  'social:acceptDocuments': empty,
  'social:getProfile': empty,
  'social:saveProfile': ProfileDraftSchema.strict(),
  'social:setAvatar': z.object({ bytes: z.instanceof(Uint8Array).refine((b) => b.byteLength <= MAX_AVATAR_INPUT) }).strict(),
  'social:removeAvatar': empty,
  'social:avatar': z.object({ userId }).strict(),
  'social:notices': empty,
  'social:readNotice': z.object({ id: z.number().int().positive() }).strict(),
  'social:signOut': empty,
  'social:export': z.object({ includeLocal: z.boolean() }).strict(),
  'social:deleteAccount': z.object({ confirmEmail: z.string().max(254), deleteLocal: z.boolean() }).strict(),
  'safety:block': z.object({ userId }).strict(),
  'safety:unblock': z.object({ userId }).strict(),
  'safety:report': z
    .object({
      reported: userId,
      contextType: z.enum(REPORT_CONTEXTS),
      contextId: z.string().max(100).nullable(),
      reason: z.enum(REPORT_REASONS),
      details: z.string().max(PROFILE_LIMITS.reportDetails),
    })
    .strict(),
  'moderation:isModerator': empty,
  'moderation:reports': empty,
  'moderation:history': z.object({ userId }).strict(),
  'moderation:decide': decision,
} satisfies Record<InvokeChannel, z.ZodType>;
