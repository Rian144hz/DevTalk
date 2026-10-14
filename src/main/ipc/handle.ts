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

const CODES_LIMIT = 'Too many codes were sent. Wait a few minutes and try again.';
const REPORTS_LIMIT = 'You reached the limit of 20 reports a day. Try again tomorrow.';

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
      return { kind: 'rate_limited', message: /report limit/i.test(err.message) ? REPORTS_LIMIT : CODES_LIMIT };
    case 'suspended':
      return { kind: 'suspended', message: suspendedMessage(err.until) };
    case 'unknown':
      console.error('[devtalk] community error:', err.message);
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
