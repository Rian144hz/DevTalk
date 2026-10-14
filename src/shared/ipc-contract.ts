// Types and channel names shared by main, preload and renderer. No runtime dependencies:
// the sandboxed preload bundles this file and cannot load node_modules.
import type { Challenge, Expression } from '../core/domain/types';
import type { Feedback } from '../core/feedback/engine';
import type { LLMErrorKind } from '../core/llm/errors';
import type { ProgressStage } from '../core/llm/structured';
import type { HistoryItem, ProfileInput, StoredProfile, Theme } from '../core/ports';
import type { ProgressSummary } from '../core/progress/summary';
import type { ReviewRating, SrsCard } from '../core/srs/srs';
import type { ProviderId } from './providers';

export type AppErrorKind = LLMErrorKind | 'validation' | 'busy' | 'not_found' | 'keyring_unavailable' | 'internal';
export interface AppError {
  kind: AppErrorKind;
  message: string;
}
export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

export interface Settings {
  provider: ProviderId;
  model: string;
  theme: Theme;
}
export interface KeyStatus {
  hasKey: boolean;
}
export interface ReviewItem {
  expression: Expression;
  card: SrsCard;
  /** ISO dates of the next due date for each rating. */
  preview: Record<ReviewRating, string>;
}
export interface ProgressEvent {
  requestId: string;
  stage: ProgressStage;
}

/** Input and output of every invoke channel. */
export interface Channels {
  'profile:get': { in: Record<string, never>; out: StoredProfile | null };
  'profile:save': { in: ProfileInput; out: StoredProfile };
  'keys:status': { in: { provider?: ProviderId }; out: KeyStatus };
  'keys:set': { in: { key: string; provider?: ProviderId }; out: KeyStatus };
  'keys:clear': { in: { provider?: ProviderId }; out: KeyStatus };
  'challenges:next': { in: { requestId: string }; out: Challenge };
  'challenges:cancel': { in: { requestId: string }; out: null };
  'feedback:submit': { in: { requestId: string; challengeId: number | null; text: string }; out: Feedback };
  'feedback:cancel': { in: { requestId: string }; out: null };
  'review:queue': { in: Record<string, never>; out: ReviewItem[] };
  'review:rate': { in: { expressionId: number; rating: ReviewRating }; out: { card: SrsCard } };
  'progress:summary': { in: Record<string, never>; out: ProgressSummary };
  'progress:history': { in: { before: string | null; limit?: number }; out: HistoryItem[] };
  'settings:get': { in: Record<string, never>; out: Settings | null };
  'settings:set': { in: Partial<Settings>; out: Settings };
}
export type InvokeChannel = keyof Channels;

export const INVOKE_CHANNELS = [
  'profile:get', 'profile:save', 'keys:status', 'keys:set', 'keys:clear', 'challenges:next', 'challenges:cancel',
  'feedback:submit', 'feedback:cancel', 'review:queue', 'review:rate', 'progress:summary', 'progress:history',
  'settings:get', 'settings:set',
] as const satisfies readonly InvokeChannel[];

export const PROGRESS_EVENT = 'llm:progress';

type R<C extends InvokeChannel> = Promise<Result<Channels[C]['out']>>;

/** What the preload exposes as `window.devtalk`. */
export interface DevtalkApi {
  profile: { get(): R<'profile:get'>; save(p: ProfileInput): R<'profile:save'> };
  /** `provider` defaults to the one in the profile. */
  keys: { status(provider?: ProviderId): R<'keys:status'>; set(key: string, provider?: ProviderId): R<'keys:set'>; clear(provider?: ProviderId): R<'keys:clear'> };
  challenges: { next(requestId: string): R<'challenges:next'>; cancel(requestId: string): R<'challenges:cancel'> };
  feedback: {
    submit(input: Channels['feedback:submit']['in']): R<'feedback:submit'>;
    cancel(requestId: string): R<'feedback:cancel'>;
  };
  llm: { onProgress(cb: (e: ProgressEvent) => void): () => void };
  review: { queue(): R<'review:queue'>; rate(input: Channels['review:rate']['in']): R<'review:rate'> };
  progress: { summary(): R<'progress:summary'>; history(input: Channels['progress:history']['in']): R<'progress:history'> };
  settings: { get(): R<'settings:get'>; set(partial: Partial<Settings>): R<'settings:set'> };
}
