import { ChallengeGenerator } from '../../core/challenges/generator';
import { CATEGORY_WINDOW, pickCategory } from '../../core/challenges/select';
import { dailyTheme, practisedOn, type DailyPick } from '../../core/daily/daily';
import { streaks } from '../../core/progress/practice';
import type { DailySettings } from '../../shared/ipc-contract';
import type { DailyState, DailyStore } from '../daily/store';
import { AppFailure, handle, type HandlerMap } from './handle';
import { localToday, practiceDays, providerFor, requireProfile, type DailyChannel, type HandlerDeps } from './handlers';
import type { InFlight } from './in-flight';

/**
 * The pick of a local day: the one stored for `day`, else a new one, chosen without the coach by the rule that picks any
 * challenge (the category used least lately, ties by the tie-breaker) and stored. Asking again on the same day never changes
 * it, whatever happened in between; a new day picks again.
 */
export function pickForDay(deps: Pick<HandlerDeps, 'store' | 'rng'>, daily: DailyStore, day: string): DailyPick {
  const stored = daily.get().pick;
  if (stored && stored.day === day) return stored;
  const recent = deps.store.recentChallenges(CATEGORY_WINDOW).map((c) => c.category);
  const pick: DailyPick = { day, category: pickCategory(recent, deps.rng ?? Math.random), challengeId: null };
  daily.update({ pick });
  return pick;
}

const settingsOf = ({ enabled, time }: DailyState): DailySettings => ({ enabled, time });

/**
 * The daily challenge: a Home card with the day's theme and the streak, a challenge the coach writes once on Start and keeps for
 * the day, and the settings. `daily.onChanged` is told after a change of the switch or the time (the reminder follows them).
 */
export function createDailyHandlers(
  deps: HandlerDeps & { inFlight: InFlight; daily: { store: DailyStore; onChanged(): void } },
): HandlerMap<DailyChannel> {
  const { store, clock, inFlight, daily } = deps;
  /** The signal of the Start that is writing the challenge now. A cancelled Start no longer counts, so Start works again at once. */
  let starting: AbortSignal | null = null;

  return {
    'daily:today': handle('daily:today', () => {
      if (!daily.store.get().enabled) return null;
      const { days, today } = practiceDays(deps);
      const pick = pickForDay(deps, daily.store, today);
      return {
        day: today,
        category: pick.category,
        theme: dailyTheme(pick.category),
        streak: streaks(days, today).current,
        practisedToday: practisedOn(days, today),
        challengeId: pick.challengeId,
      };
    }),

    'daily:start': handle('daily:start', async ({ requestId }) => {
      const profile = requireProfile(store);
      const pick = pickForDay(deps, daily.store, localToday(deps));
      // Written already: the same challenge, with no coach call and no key needed.
      const written = pick.challengeId === null ? null : store.getChallenge(pick.challengeId);
      if (written) return written;
      // One coach call at a time, whatever the request ids are (two screens, a double click).
      if (starting && !starting.aborted) throw new AppFailure('busy');
      const generator = new ChallengeGenerator({
        provider: providerFor(deps, profile),
        store,
        clock,
        challengeTemplate: deps.templates().challenge,
        rng: deps.rng,
      });
      return inFlight.run(requestId, async (signal, onProgress) => {
        starting = signal;
        try {
          const challenge = await generator.next(profile, signal, onProgress, { category: pick.category });
          // It belongs to the day it was written for: if midnight passed meanwhile, the new day's pick is left alone.
          const current = daily.store.get().pick;
          if (current && current.day === pick.day) daily.store.update({ pick: { ...current, challengeId: challenge.id } });
          return challenge;
        } finally {
          if (starting === signal) starting = null;
        }
      });
    }),

    'daily:settings': handle('daily:settings', () => settingsOf(daily.store.get())),

    'daily:setSettings': handle('daily:setSettings', (patch) => {
      const before = daily.store.get();
      const changed = (patch.enabled !== undefined && patch.enabled !== before.enabled) || (patch.time !== undefined && patch.time !== before.time);
      if (!changed) return settingsOf(before);
      const next = daily.store.update({ enabled: patch.enabled, time: patch.time });
      try {
        daily.onChanged();
      } catch (err) {
        // The change is saved; a hook that fails must not make it look as if it was not.
        console.error('[devtalk] daily onChanged failed:', err);
      }
      return settingsOf(next);
    }),
  };
}
