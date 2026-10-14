import type { z } from 'zod';
import { ChallengeGenerator } from '../../core/challenges/generator';
import { FeedbackEngine } from '../../core/feedback/engine';
import { LLMError } from '../../core/llm/errors';
import type { LLMProvider } from '../../core/llm/provider';
import type { ProgressStage } from '../../core/llm/structured';
import type { Clock, StoredProfile, StudyStore } from '../../core/ports';
import { buildProgressSummary } from '../../core/progress/summary';
import { previewDue, rate, REVIEW_RATINGS } from '../../core/srs/srs';
import type { AppError, AppErrorKind, Channels, InvokeChannel, Result, Settings } from '../../shared/ipc-contract';
import { DEFAULT_PROVIDER, type ProviderId } from '../../shared/providers';
import { KeyringUnavailableError, type KeyVault } from '../vault/key-vault';
import { INPUT_SCHEMAS } from './schemas';

export interface HandlerDeps {
  store: StudyStore;
  /** One key per provider. */
  vaults: (provider: ProviderId) => KeyVault;
  clock: Clock;
  /** Throws LLMError('no_key') when the provider needs a key and there is none. */
  makeProvider: (apiKey: string | null, profile: StoredProfile) => LLMProvider;
  /** Reachability check for the chosen coach (Ollama: running and model installed). */
  checkProvider: (profile: StoredProfile) => Promise<{ ok: boolean; detail: string }>;
  templates: () => { coach: string; challenge: string };
  /** Tie-breaker for the challenge category (fixture mode makes it deterministic). */
  rng?: () => number;
  emitProgress: (requestId: string, stage: ProgressStage) => void;
}

export type Handlers = { [C in InvokeChannel]: (input: unknown) => Promise<Result<Channels[C]['out']>> };

const MESSAGES: Record<AppErrorKind, string> = {
  no_key: 'Add your API key in Settings to use the coach.',
  auth: 'Your API key was rejected. Check it in Settings.',
  config: 'The coach could not use this model. Check the model name in Settings and your Anthropic account credits.',
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
};

class AppFailure extends Error {
  constructor(
    readonly kind: AppErrorKind,
    message = MESSAGES[kind],
  ) {
    super(message);
  }
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppFailure) return { kind: err.kind, message: err.message };
  if (err instanceof LLMError) {
    if (err.kind === 'config' || err.kind === 'unavailable') console.error(`[devtalk] LLM ${err.kind}: ${err.message}`, err.cause ?? '');
    return { kind: err.kind, message: MESSAGES[err.kind] };
  }
  if (err instanceof KeyringUnavailableError) return { kind: 'keyring_unavailable', message: MESSAGES.keyring_unavailable };
  console.error('[devtalk] unexpected error', err);
  return { kind: 'internal', message: MESSAGES.internal };
}

const settingsOf = (p: StoredProfile): Settings => ({ provider: p.provider as ProviderId, model: p.model, theme: p.theme });

export function createHandlers(deps: HandlerDeps): Handlers {
  const { store, clock } = deps;
  /** The provider a keys:* call refers to: the explicit one, else the profile's, else the default. */
  const keyVault = (provider?: ProviderId) => deps.vaults(provider ?? (store.getProfile()?.provider as ProviderId | undefined) ?? DEFAULT_PROVIDER);
  const inFlight = new Map<string, AbortController>();

  function handle<C extends InvokeChannel>(
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

  function requireProfile(): StoredProfile {
    const profile = store.getProfile();
    if (!profile) throw new AppFailure('not_found', 'Finish onboarding first.');
    return profile;
  }

  /** Runs an LLM-backed job that can be cancelled by requestId. */
  async function cancellable<T>(requestId: string, job: (signal: AbortSignal, onProgress: (s: ProgressStage) => void) => Promise<T>): Promise<T> {
    if (inFlight.has(requestId)) throw new AppFailure('busy');
    const controller = new AbortController();
    inFlight.set(requestId, controller);
    try {
      return await job(controller.signal, (stage) => deps.emitProgress(requestId, stage));
    } finally {
      inFlight.delete(requestId);
    }
  }

  const cancel = ({ requestId }: { requestId: string }) => {
    inFlight.get(requestId)?.abort();
    return null;
  };

  const providerFor = (profile: StoredProfile) => deps.makeProvider(deps.vaults(profile.provider as ProviderId).get(), profile);

  return {
    'profile:get': handle('profile:get', () => store.getProfile()),
    'profile:save': handle('profile:save', (p) => {
      store.saveProfile(p, clock.now());
      return store.getProfile()!;
    }),
    'keys:status': handle('keys:status', ({ provider }) => ({ hasKey: keyVault(provider).has() })),
    'keys:set': handle('keys:set', ({ key, provider }) => {
      const vault = keyVault(provider);
      vault.set(key);
      return { hasKey: vault.has() };
    }),
    'keys:clear': handle('keys:clear', ({ provider }) => {
      keyVault(provider).clear();
      return { hasKey: false };
    }),

    'challenges:next': handle('challenges:next', ({ requestId }) => {
      const profile = requireProfile();
      const provider = providerFor(profile);
      const generator = new ChallengeGenerator({ provider, store, clock, challengeTemplate: deps.templates().challenge, rng: deps.rng });
      return cancellable(requestId, (signal, onProgress) => generator.next(profile, signal, onProgress));
    }),
    'challenges:cancel': handle('challenges:cancel', cancel),
    'challenges:pending': handle('challenges:pending', () => store.pendingChallenge()),

    'feedback:submit': handle('feedback:submit', ({ requestId, challengeId, text }) => {
      const profile = requireProfile();
      const challenge = challengeId === null ? null : store.getChallenge(challengeId);
      if (challengeId !== null && !challenge) throw new AppFailure('not_found', 'That challenge no longer exists.');
      const provider = providerFor(profile);
      const engine = new FeedbackEngine({ provider, store, clock, coachTemplate: deps.templates().coach });
      return cancellable(requestId, async (signal, onProgress) => {
        const result = await engine.review(
          { text, source: 'typed', context: challenge ? { kind: 'challenge', challenge } : { kind: 'free' }, learner: profile },
          signal,
          onProgress,
        );
        return store.getFeedback(result.feedbackId)!;
      });
    }),
    'feedback:cancel': handle('feedback:cancel', cancel),
    'feedback:get': handle('feedback:get', ({ feedbackId }) => {
      const feedback = store.getFeedback(feedbackId);
      if (!feedback) throw new AppFailure('not_found', 'That feedback no longer exists.');
      return feedback;
    }),

    'review:queue': handle('review:queue', () => {
      const now = clock.now();
      const items = store.dueCards(now, { excludeNew: false, limit: 50 }).map(({ expression, card }) => {
        const preview = previewDue(card, now);
        return {
          expression,
          card,
          preview: Object.fromEntries(REVIEW_RATINGS.map((r) => [r, preview[r].toISOString()])) as Record<(typeof REVIEW_RATINGS)[number], string>,
        };
      });
      return { items, nextDueAt: store.nextDueAt()?.toISOString() ?? null };
    }),
    'review:rate': handle('review:rate', ({ expressionId, rating }) => {
      const card = store.getCard(expressionId);
      if (!card) throw new AppFailure('not_found', 'That expression no longer exists.');
      const next = rate(card, rating, clock.now());
      store.saveReview(expressionId, next.card, next.log);
      return { card: next.card };
    }),

    'progress:summary': handle('progress:summary', () => buildProgressSummary(store, clock.now())),
    'progress:history': handle('progress:history', ({ before, limit }) => store.history({ before, limit })),

    'settings:get': handle('settings:get', () => {
      const p = store.getProfile();
      return p ? settingsOf(p) : null;
    }),
    'llm:check': handle('llm:check', () => deps.checkProvider(requireProfile())),
    'settings:set': handle('settings:set', (partial) => {
      const { onboardedAt: _, ...p } = requireProfile();
      store.saveProfile({ ...p, ...partial }, clock.now());
      return settingsOf(store.getProfile()!);
    }),
  };
}
