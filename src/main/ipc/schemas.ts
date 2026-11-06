import { z } from 'zod';
import type { InvokeChannel } from '../../shared/ipc-contract';
import { CHECK_TEXT_MAX, CHECK_TYPES, checkText } from '../../core/check/types';
import { EXPRESSION_TYPES } from '../../core/domain/categories';
import { LEVELS } from '../../core/domain/types';
import { PROVIDERS } from '../../shared/providers';
import { MANUAL_BADGES } from '../../core/social/badges';
import { MEMBER_QUERY_MAX } from '../../core/social/people';
import { CHAT_TEXT_MAX, chatText } from '../../core/social/chat';
import { ROOM_SIGNAL_KINDS, ROOM_SIGNAL_MAX_BYTES, ROOM_THEMES, ROOM_TITLE_MAX, ROOM_TITLE_MIN, roomTitle } from '../../core/social/rooms';
import { AREAS, PROFILE_LIMITS, REPORT_CONTEXTS, REPORT_REASONS } from '../../core/social/types';
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
const MAX_BANNER_INPUT = 8 * 1024 * 1024;
const page = z.number().int().min(0).max(10_000);
const byUser = z.object({ userId }).strict();
const badgeChange = z
  .object({ userId, badge: z.enum(MANUAL_BADGES), reason: z.string().trim().min(1, 'Write a reason.').max(200) })
  .strict();
const reportId = z.number().int().positive();
const chatBody = z
  .string()
  .max(CHAT_TEXT_MAX * 2)
  .refine((s) => chatText(s) !== null, `Write 1 to ${CHAT_TEXT_MAX} characters.`);
// The length cap only keeps a giant string out of the trim; checkText decides (the same count as the chat). A key in the
// text is refused by the handler, which owns the exact message.
const checkBody = z
  .string()
  .max(CHECK_TEXT_MAX * 2)
  .refine((s) => checkText(s) !== null, `Write 1 to ${CHECK_TEXT_MAX} characters.`);
const conversationId = z.string().min(1).max(64);
const messageId = z.number().int().positive();
const roomId = z.string().min(1).max(64);
const inRoom = z.object({ roomId }).strict();
const onMember = z.object({ roomId, userId }).strict();
// Characters, not UTF-16 units: the same count the database makes. The length cap only keeps a giant string out of the check.
const roomTitleText = z
  .string()
  .max(ROOM_TITLE_MAX * 4)
  .refine((s) => roomTitle(s) !== null, `Write ${ROOM_TITLE_MIN} to ${ROOM_TITLE_MAX} characters.`);
// A character is at least one byte, so a longer string is too big whatever it holds; the byte count decides the rest.
const roomSignalPayload = z
  .string()
  .max(ROOM_SIGNAL_MAX_BYTES, 'The connection message is too long.')
  .refine((s) => Buffer.byteLength(s, 'utf8') <= ROOM_SIGNAL_MAX_BYTES, 'The connection message is too long.');
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
  'review:keep': z
    .object({
      text: z.string().trim().min(1).max(300),
      type: z.enum(EXPRESSION_TYPES),
      meaning: z.string().trim().min(1).max(1000),
      example: z.string().trim().min(1).max(1000),
    })
    .strict(),
  'check:run': z.object({ requestId: z.string().min(1).max(100), type: z.enum(CHECK_TYPES), text: checkBody }).strict(),
  'check:cancel': requestId,
  'progress:summary': empty,
  'progress:history': z.object({ before: z.string().nullable(), limit: z.number().int().min(1).max(100).default(20) }).strict(),
  'progress:graph': empty,
  'settings:get': empty,
  'settings:set': settings.partial().strict(),
  'llm:check': empty,
  'social:status': empty,
  'social:sendCode': z.object({ email }).strict(),
  'social:verifyCode': z.object({ email, code: z.string().regex(/^\d{6,10}$/, 'The code has 6 to 10 digits.') }).strict(),
  'social:acceptDocuments': empty,
  'social:getProfile': empty,
  'social:saveProfile': ProfileDraftSchema,
  'social:setAvatar': z.object({ bytes: z.instanceof(Uint8Array).refine((b) => b.byteLength <= MAX_AVATAR_INPUT) }).strict(),
  'social:removeAvatar': empty,
  'social:avatar': z.object({ userId }).strict(),
  'social:notices': empty,
  'social:readNotice': z.object({ id: z.number().int().positive() }).strict(),
  'social:signOut': empty,
  'social:signInWithGitHub': empty,
  'social:cancelSignIn': empty,
  'social:githubSuggestion': empty,
  'social:export': z.object({ includeLocal: z.boolean() }).strict(),
  'social:deleteAccount': z.object({ confirmEmail: z.string().max(254), deleteLocal: z.boolean() }).strict(),
  'social:badges': z.object({ userId }).strict(),
  'social:practiceGraph': z.object({ userId }).strict(),
  'social:setBanner': z.object({ bytes: z.instanceof(Uint8Array).refine((b) => b.byteLength <= MAX_BANNER_INPUT) }).strict(),
  'social:removeBanner': empty,
  'social:banner': z.object({ userId }).strict(),
  'social:members': z
    .object({
      query: z.string().max(MEMBER_QUERY_MAX).optional(),
      level: z.enum(LEVELS).optional(),
      area: z.enum(AREAS).optional(),
      stack: z.string().max(PROFILE_LIMITS.stackTagLength).optional(),
      page,
    })
    .strict(),
  'social:profileOf': byUser,
  'social:socialStats': byUser,
  'social:follow': byUser,
  'social:unfollow': byUser,
  'social:like': byUser,
  'social:unlike': byUser,
  'social:followers': z.object({ userId, page }).strict(),
  'social:following': z.object({ userId, page }).strict(),
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
  'moderation:searchMembers': z.object({ query: z.string().trim().min(1).max(40) }).strict(),
  'moderation:grantBadge': badgeChange,
  'moderation:revokeBadge': badgeChange,
  'moderation:reportContext': z.object({ reportId }).strict(),
  'chat:conversations': empty,
  'chat:messages': z.object({ conversationId, before: messageId.nullable() }).strict(),
  'chat:request': z.object({ userId, body: chatBody }).strict(),
  'chat:respond': z.object({ conversationId, accept: z.boolean() }).strict(),
  'chat:send': z.object({ conversationId, body: chatBody }).strict(),
  'chat:delete': z.object({ messageId }).strict(),
  'chat:correct': z.object({ messageId, corrected: chatBody }).strict(),
  'chat:thank': z.object({ correctionId: messageId }).strict(),
  'chat:read': z.object({ conversationId }).strict(),
  'chat:check': z.object({ text: chatBody }).strict(),
  'moderation:roomContext': z.object({ reportId }).strict(),
  'rooms:list': empty,
  'rooms:create': z.object({ title: roomTitleText, theme: z.enum(ROOM_THEMES), level: z.enum(LEVELS).nullable() }).strict(),
  'rooms:join': inRoom,
  'rooms:leave': inRoom,
  'rooms:state': inRoom,
  'rooms:signal': z.object({ roomId, to: userId, signal: z.enum(ROOM_SIGNAL_KINDS), payload: roomSignalPayload }).strict(),
  'rooms:makeModerator': onMember,
  'rooms:removeModerator': onMember,
  'rooms:passHost': onMember,
  'rooms:mute': onMember,
  'rooms:setMuted': z.object({ roomId, muted: z.boolean() }).strict(),
  'rooms:remove': onMember,
  'rooms:end': inRoom,
  'rooms:timer': z.object({ roomId, seconds: z.union([z.literal(60), z.literal(90), z.null()]) }).strict(),
  'rooms:nextCard': inRoom,
  'rooms:settings': empty,
} satisfies Record<InvokeChannel, z.ZodType>;
