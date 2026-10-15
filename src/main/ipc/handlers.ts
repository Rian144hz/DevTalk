import { ChallengeGenerator } from '../../core/challenges/generator';
import { FeedbackEngine } from '../../core/feedback/engine';
import { LEVELS } from '../../core/domain/types';
import type { LLMProvider } from '../../core/llm/provider';
import type { ProgressStage } from '../../core/llm/structured';
import type { Clock, StoredProfile, StudyStore } from '../../core/ports';
import { addDays, bucketByDay, localDay, streaks } from '../../core/progress/practice';
import { buildProgressSummary } from '../../core/progress/summary';
import { previewDue, rate, REVIEW_RATINGS } from '../../core/srs/srs';
import type { InvokeChannel, Settings } from '../../shared/ipc-contract';
import { DEFAULT_PROVIDER, type ProviderId } from '../../shared/providers';
import type { KeyVault } from '../vault/key-vault';
import { AppFailure, handle, type HandlerMap } from './handle';

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
  /** Practice happened (an answer, a review, or a level rise like 'B1>B2'); must not block or throw. */
  onActivity?: (kind: 'answer' | 'review' | 'level', detail?: string) => void;
  /** IANA time zone of this machine (practice days are local days). */
  timeZone?: () => string;
}

export type SocialChannel = Extract<InvokeChannel, `social:${string}` | `safety:${string}` | `moderation:${string}`>;
export type CoreChannel = Exclude<InvokeChannel, SocialChannel>;
export type Handlers = HandlerMap<InvokeChannel>;

const GRAPH_DAYS = 53 * 7;

const settingsOf = (p: StoredProfile): Settings => ({ provider: p.provider as ProviderId, model: p.model, theme: p.theme });

export function createHandlers(deps: HandlerDeps): HandlerMap<CoreChannel> {
  const { store, clock } = deps;
  /** The provider a keys:* call refers to: the explicit one, else the profile's, else the default. */
  const keyVault = (provider?: ProviderId) => deps.vaults(provider ?? (store.getProfile()?.provider as ProviderId | undefined) ?? DEFAULT_PROVIDER);
  const inFlight = new Map<string, AbortController>();

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
      const before = store.getProfile()?.currentLevel;
      store.saveProfile(p, clock.now());
      if (before && LEVELS.indexOf(p.currentLevel) > LEVELS.indexOf(before)) deps.onActivity?.('level', `${before}>${p.currentLevel}`);
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
        deps.onActivity?.('answer');
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
      deps.onActivity?.('review');
      return { card: next.card };
    }),

    'progress:summary': handle('progress:summary', () => buildProgressSummary(store, clock.now())),
    'progress:history': handle('progress:history', ({ before, limit }) => store.history({ before, limit })),
    'progress:graph': handle('progress:graph', () => {
      const timeZone = deps.timeZone?.() ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      const today = localDay(clock.now(), timeZone);
      const { answers, reviews } = store.activityTimestamps(new Date(0));
      const all = bucketByDay(answers, reviews, timeZone);
      // The graph shows 53 weeks; the longest streak counts the whole history.
      const first = addDays(today, -GRAPH_DAYS);
      return { days: all.filter((d) => d.day > first && d.day <= today), ...streaks(all, today) };
    }),

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
