import { ChallengeGenerator } from '../../core/challenges/generator';
import { FeedbackEngine } from '../../core/feedback/engine';
import { normalizeExpression } from '../../core/domain/text';
import { LEVELS } from '../../core/domain/types';
import type { LLMProvider } from '../../core/llm/provider';
import type { ProgressStage } from '../../core/llm/structured';
import type { Clock, StoredProfile, StudyStore } from '../../core/ports';
import { addDays, bucketByDay, localDay, streaks } from '../../core/progress/practice';
import { buildProgressSummary } from '../../core/progress/summary';
import { newCard, previewDue, rate, REVIEW_RATINGS } from '../../core/srs/srs';
import type { InvokeChannel, Settings } from '../../shared/ipc-contract';
import { DEFAULT_PROVIDER, type ProviderId } from '../../shared/providers';
import type { KeyVault } from '../vault/key-vault';
import { AppFailure, handle, type HandlerMap } from './handle';
import { createInFlight, type InFlight } from './in-flight';

/** The prompt files, read on every use. Each feature that calls the coach adds its own. */
export interface Templates {
  coach: string;
  challenge: string;
  check: string;
}

export interface HandlerDeps {
  store: StudyStore;
  /** One key per provider. */
  vaults: (provider: ProviderId) => KeyVault;
  clock: Clock;
  /** Throws LLMError('no_key') when the provider needs a key and there is none. */
  makeProvider: (apiKey: string | null, profile: StoredProfile) => LLMProvider;
  /** Reachability check for the chosen coach (Ollama: running and model installed). */
  checkProvider: (profile: StoredProfile) => Promise<{ ok: boolean; detail: string }>;
  templates: () => Templates;
  /** Tie-breaker for the challenge category (fixture mode makes it deterministic). */
  rng?: () => number;
  emitProgress: (requestId: string, stage: ProgressStage) => void;
  /** Practice happened (an answer, a review, or a level rise like 'B1>B2'); must not block or throw. */
  onActivity?: (kind: 'answer' | 'review' | 'level', detail?: string) => void;
  /** IANA time zone of this machine (practice days are local days). */
  timeZone?: () => string;
  /** The cancellable coach calls, shared by every handler group. Without it `createHandlers` keeps its own. */
  inFlight?: InFlight;
}

/** Channels served by the community backend; chat:check uses the coach and stays here. */
export type SocialChannel = Exclude<
  Extract<InvokeChannel, `social:${string}` | `safety:${string}` | `moderation:${string}` | `chat:${string}` | `rooms:${string}`>,
  'chat:check'
>;
/** Each feature's own channels, served by its own handler group (the daily and simulate groups come with their features). */
export type CheckChannel = Extract<InvokeChannel, `check:${string}`>;
export type DailyChannel = Extract<InvokeChannel, `daily:${string}`>;
export type SimulateChannel = Extract<InvokeChannel, `simulate:${string}`>;
export type CoreChannel = Exclude<InvokeChannel, SocialChannel | CheckChannel | DailyChannel | SimulateChannel>;
export type Handlers = HandlerMap<InvokeChannel>;

const GRAPH_DAYS = 53 * 7;

const settingsOf = (p: StoredProfile): Settings => ({ provider: p.provider as ProviderId, model: p.model, theme: p.theme });

/** The saved profile; the coach cannot be asked before onboarding. */
export function requireProfile(store: StudyStore): StoredProfile {
  const profile = store.getProfile();
  if (!profile) throw new AppFailure('not_found', 'Finish onboarding first.');
  return profile;
}

/** The coach the profile chose, with that provider's key (fails with no_key when it needs one and there is none). */
export function providerFor(deps: Pick<HandlerDeps, 'vaults' | 'makeProvider'>, profile: StoredProfile): LLMProvider {
  return deps.makeProvider(deps.vaults(profile.provider as ProviderId).get(), profile);
}

export function createHandlers(deps: HandlerDeps): HandlerMap<CoreChannel> {
  const { store, clock } = deps;
  /** The provider a keys:* call refers to: the explicit one, else the profile's, else the default. */
  const keyVault = (provider?: ProviderId) => deps.vaults(provider ?? (store.getProfile()?.provider as ProviderId | undefined) ?? DEFAULT_PROVIDER);
  const inFlight = deps.inFlight ?? createInFlight(deps.emitProgress);

  const cancel = ({ requestId }: { requestId: string }) => {
    inFlight.cancel(requestId);
    return null;
  };

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
      const profile = requireProfile(store);
      const provider = providerFor(deps, profile);
      const generator = new ChallengeGenerator({ provider, store, clock, challengeTemplate: deps.templates().challenge, rng: deps.rng });
      return inFlight.run(requestId, (signal, onProgress) => generator.next(profile, signal, onProgress));
    }),
    'challenges:cancel': handle('challenges:cancel', cancel),
    'challenges:pending': handle('challenges:pending', () => store.pendingChallenge()),

    'feedback:submit': handle('feedback:submit', ({ requestId, challengeId, text }) => {
      const profile = requireProfile(store);
      const challenge = challengeId === null ? null : store.getChallenge(challengeId);
      if (challengeId !== null && !challenge) throw new AppFailure('not_found', 'That challenge no longer exists.');
      const provider = providerFor(deps, profile);
      const engine = new FeedbackEngine({ provider, store, clock, coachTemplate: deps.templates().coach });
      return inFlight.run(requestId, async (signal, onProgress) => {
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
    'review:keep': handle('review:keep', (draft) => {
      const normalizedText = normalizeExpression(draft.text);
      // Nothing but punctuation is nothing to keep.
      if (!normalizedText) throw new AppFailure('validation', 'Write an expression to keep.');
      const now = clock.now();
      return store.saveExpression({ ...draft, normalizedText }, newCard(now), now);
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

    'chat:check': handle('chat:check', async ({ text }) => {
      const profile = requireProfile(store);
      const engine = new FeedbackEngine({ provider: providerFor(deps, profile), store, clock, coachTemplate: deps.templates().coach });
      const result = await engine.check(
        { text: text.trim(), context: { kind: 'free', situation: 'a chat message to another developer' }, learner: profile },
        new AbortController().signal,
      );
      return {
        rewrite: result.naturalRewrite,
        corrections: result.corrections.map(({ original, corrected, explanation }) => ({ original, corrected, explanation })),
      };
    }),

    'settings:get': handle('settings:get', () => {
      const p = store.getProfile();
      return p ? settingsOf(p) : null;
    }),
    'llm:check': handle('llm:check', () => deps.checkProvider(requireProfile(store))),
    'settings:set': handle('settings:set', (partial) => {
      const { onboardedAt: _, ...p } = requireProfile(store);
      store.saveProfile({ ...p, ...partial }, clock.now());
      return settingsOf(store.getProfile()!);
    }),
  };
}
