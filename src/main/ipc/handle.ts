import type { z } from 'zod';
import { LLMError } from '../../core/llm/errors';
import type { AppError, AppErrorKind, Channels, InvokeChannel, Result } from '../../shared/ipc-contract';
import { SocialError } from '../social/errors';
import { KeyringUnavailableError } from '../vault/key-vault';
import { INPUT_SCHEMAS } from './schemas';

export const MESSAGES: Record<AppErrorKind, string> = {
  no_key: 'Add your API key in Settings to use the coach.',
  auth: 'Your API key was rejected. Check it in Settings.',
  config: 'The coach could not use this model. Check the model name in Settings and your provider account.',
  unavailable: 'The coach is unavailable right now. Try again in a moment.',
  rate_limited: "You reached the provider's usage limit for now. Wait a minute and try again, or come back later today.",
  invalid_output: 'The coach returned something unexpected. Try again.',
  refusal: 'The coach declined to answer this one. Try rewording it.',
  truncated: "The coach's reply was cut off. Try again.",
  cancelled: 'Cancelled.',
  validation: 'That input is not valid.',
  busy: 'This request is already running.',
  not_found: 'Not found.',
  keyring_unavailable: 'Your system keyring is not available, so the API key cannot be stored safely.',
  internal: 'Something went wrong. Try again.',
  not_configured: 'Community is not set up in this build.',
  offline: 'You are offline. Your practice still works; the community needs a connection.',
  invalid_code: 'That code did not work. Check it or send a new one.',
  asleep: 'The community server is asleep. Try again in a minute.',
  suspended: 'Your account is suspended.',
  not_signed_in: 'Sign in to the community first.',
  forbidden: 'You are not allowed to do that.',
};

/** The GitHub sign-in's own plain-English messages (see oauth-loopback.ts and the backends): shown as they are, and no fault to log. */
const GITHUB_SIGN_IN_NOTICE = /^(Sign-in was not finished\.|Could not start GitHub sign-in\.)/;

const CODES_LIMIT = 'Too many codes were sent. Wait a few minutes and try again.';
const REPORTS_LIMIT = 'You reached the limit of 20 reports a day. Try again tomorrow.';
const FOLLOWS_LIMIT = 'You reached the limit of 200 follows a day. Try again tomorrow.';
const LIKES_LIMIT = 'You reached the limit of 200 likes a day. Try again tomorrow.';
const REQUESTS_LIMIT = 'You reached the limit of 10 message requests a day. Try again tomorrow.';
const MESSAGES_LIMIT = 'You reached the limit of 500 messages a day. Try again tomorrow.';
const CORRECTIONS_LIMIT = 'You reached the limit of 200 corrections a day. Try again tomorrow.';
const ROOMS_LIMIT = 'You can create up to 10 rooms a day. Try again tomorrow.';
const ROOM_ACTIONS_LIMIT = 'Too many room actions. Wait a moment.';
const SIGNALS_LIMIT = 'Too many connection messages. Wait a moment.';
const ROOM_FULL = 'This room is full.';
const ROOM_ENDED = 'This room has ended.';
const ROOM_ALREADY_JOINING = 'You are already joining a room.';

export class AppFailure extends Error {
  constructor(
    readonly kind: AppErrorKind,
    message = MESSAGES[kind],
  ) {
    super(message);
  }
}

export function suspendedMessage(until: string | undefined): string {
  if (!until || until === 'infinity' || Number.isNaN(Date.parse(until))) return MESSAGES.suspended;
  const date = new Date(until).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return `Your account is suspended until ${date}.`;
}

function socialAppError(err: SocialError): AppError {
  switch (err.kind) {
    case 'rate_limited':
      return {
        kind: 'rate_limited',
        message: /report limit/i.test(err.message) ? REPORTS_LIMIT
          : /follow limit/i.test(err.message) ? FOLLOWS_LIMIT
          : /like limit/i.test(err.message) ? LIKES_LIMIT
          : /request limit/i.test(err.message) ? REQUESTS_LIMIT
          : /message limit/i.test(err.message) ? MESSAGES_LIMIT
          : /correction limit/i.test(err.message) ? CORRECTIONS_LIMIT
          : /room action limit/i.test(err.message) ? ROOM_ACTIONS_LIMIT
          : /room limit/i.test(err.message) ? ROOMS_LIMIT
          : /signal limit/i.test(err.message) ? SIGNALS_LIMIT
          : CODES_LIMIT,
      };
    case 'suspended':
      return { kind: 'suspended', message: suspendedMessage(err.until) };
    case 'unknown':
      // Not faults: a seventh person at the door, a room that ended, or two joins at the same moment (one open seat
      // per person).
      if (/room is full/i.test(err.message)) return { kind: 'validation', message: ROOM_FULL };
      if (/room has ended/i.test(err.message)) return { kind: 'validation', message: ROOM_ENDED };
      if (/room_sessions_one_open/.test(err.message)) return { kind: 'validation', message: ROOM_ALREADY_JOINING };
      if (!GITHUB_SIGN_IN_NOTICE.test(err.message)) console.error('[devtalk] community error:', err.message);
      return { kind: 'internal', message: err.message || MESSAGES.internal };
    default:
      return { kind: err.kind, message: MESSAGES[err.kind] };
  }
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppFailure) return { kind: err.kind, message: err.message };
  if (err instanceof SocialError) return socialAppError(err);
  if (err instanceof LLMError) {
    if (err.kind === 'config' || err.kind === 'unavailable') console.error(`[devtalk] LLM ${err.kind}: ${err.message}`, err.cause ?? '');
    return { kind: err.kind, message: err.userMessage ?? MESSAGES[err.kind] };
  }
  if (err instanceof KeyringUnavailableError) return { kind: 'keyring_unavailable', message: MESSAGES.keyring_unavailable };
  console.error('[devtalk] unexpected error', err);
  return { kind: 'internal', message: MESSAGES.internal };
}

export type HandlerMap<K extends InvokeChannel> = { [C in K]: (input: unknown) => Promise<Result<Channels[C]['out']>> };

/** Validates the payload with the channel's schema, runs `fn`, and always answers with a Result. */
export function handle<C extends InvokeChannel>(
  channel: C,
  fn: (input: z.output<(typeof INPUT_SCHEMAS)[C]>) => Promise<Channels[C]['out']> | Channels[C]['out'],
) {
  return async (raw: unknown): Promise<Result<Channels[C]['out']>> => {
    const parsed = INPUT_SCHEMAS[channel].safeParse(raw ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return { ok: false, error: { kind: 'validation', message: issue ? `${issue.path.join('.') || 'input'}: ${issue.message}` : MESSAGES.validation } };
    }
    try {
      return { ok: true, data: await fn(parsed.data as z.output<(typeof INPUT_SCHEMAS)[C]>) };
    } catch (err) {
      return { ok: false, error: toAppError(err) };
    }
  };
}
