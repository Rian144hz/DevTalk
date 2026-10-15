// Sends how much the person practised per day (counts only, never what they wrote) and a few milestones
// to the community. Only for members; failures are logged and retried on the next flush.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { LEVELS } from '../../core/domain/types';
import type { Clock, StudyStore } from '../../core/ports';
import { addDays, bucketByDay, localDay } from '../../core/progress/practice';
import type { SocialBackend } from './backend';

export type ActivityKind = 'answer' | 'review' | 'level';

export interface PracticeSync {
  start(): Promise<void>;
  notify(kind: ActivityKind, detail?: string): void;
  flush(): Promise<void>;
}

/** What the server already has, so only changed days are sent again. */
interface SyncState {
  userId: string;
  /** day → "answers/reviews" as last sent. */
  days: Record<string, string>;
  /** "kind:value" of every milestone sent. */
  milestones: string[];
}

const WINDOW_DAYS = 400;
const VOCABULARY_STEPS = [50, 100];

/** The time zone when Intl knows it, else null. */
function knownTimeZone(tz: string): string | null {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

const isLevelUp = (v: string) => {
  const [from, to] = v.split('>') as [string, string?];
  const a = LEVELS.indexOf(from as (typeof LEVELS)[number]);
  const b = LEVELS.indexOf(to as (typeof LEVELS)[number]);
  return a >= 0 && b > a;
};

export function createPracticeSync(deps: {
  store: StudyStore;
  backend: SocialBackend;
  clock: Clock;
  timeZone: () => string;
  platform: NodeJS.Platform;
  statePath: string | null;
  debounceMs?: number;
  schedule?: (fn: () => void, ms: number) => { cancel(): void };
}): PracticeSync {
  const { store, backend, clock } = deps;
  const debounceMs = deps.debounceMs ?? 5000;
  const schedule =
    deps.schedule ??
    ((fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      return { cancel: () => clearTimeout(t) };
    });

  let memory: SyncState | null = null;
  let pending: { cancel(): void } | null = null;
  let running: Promise<void> = Promise.resolve();
  let linuxReported = false;
  const levelUps: string[] = [];

  const load = (userId: string): SyncState => {
    if (memory?.userId === userId) return memory;
    let loaded: SyncState | null = null;
    if (deps.statePath && existsSync(deps.statePath)) {
      try {
        const parsed = JSON.parse(readFileSync(deps.statePath, 'utf8')) as Partial<SyncState>;
        if (parsed.userId === userId && parsed.days && Array.isArray(parsed.milestones)) loaded = parsed as SyncState;
      } catch {
        // A damaged cache only means everything is sent again.
      }
    }
    memory = loaded ?? { userId, days: {}, milestones: [] };
    return memory;
  };

  const save = (state: SyncState) => {
    memory = state;
    if (!deps.statePath) return;
    const tmp = `${deps.statePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    renameSync(tmp, deps.statePath);
  };

  /** The member's id and the time zone their days are counted in (the profile's, as the server's streak). */
  const member = async (): Promise<{ userId: string; timeZone: string } | null> => {
    const session = await backend.session();
    if (!session || !(await backend.hasAcceptedCurrentDocuments())) return null;
    const profile = await backend.getOwnProfile();
    if (!profile) return null;
    if (profile.suspendedUntil && (profile.suspendedUntil === 'infinity' || new Date(profile.suspendedUntil) > clock.now())) return null;
    return { userId: session.userId, timeZone: knownTimeZone(profile.timezone) ?? deps.timeZone() };
  };

  const sendDays = async (state: SyncState, timeZone: string) => {
    const now = clock.now();
    const today = localDay(now, timeZone);
    const first = addDays(today, -(WINDOW_DAYS - 1));
    // One extra day each side covers any time zone offset; the day filter does the rest.
    const { answers, reviews } = store.activityTimestamps(new Date(`${addDays(first, -1)}T00:00:00Z`));
    const inWindow = bucketByDay(answers, reviews, timeZone).filter((d) => d.day >= first && d.day <= today);
    const active = new Set(inWindow.map((d) => d.day));
    // A day sent before that has no activity now (the time zone changed) is set to zero, or it would count twice.
    const emptied = Object.keys(state.days)
      .filter((day) => day >= first && day <= today && !active.has(day))
      .map((day) => ({ day, answers: 0, reviews: 0 }));
    const changed = [...emptied, ...inWindow.filter((d) => state.days[d.day] !== `${d.answers}/${d.reviews}`)].sort((a, b) =>
      a.day.localeCompare(b.day),
    );
    if (changed.length === 0) return;
    await backend.publishPracticeDays(changed);
    const days = Object.fromEntries(Object.entries(state.days).filter(([day]) => day >= first && active.has(day)));
    for (const d of changed) if (active.has(d.day)) days[d.day] = `${d.answers}/${d.reviews}`;
    save({ ...state, days });
  };

  const sendMilestone = async (kind: 'level_up' | 'vocabulary', value: string) => {
    const state = memory!;
    const key = `${kind}:${value}`;
    if (state.milestones.includes(key)) return;
    await backend.publishMilestone(kind, value);
    save({ ...memory!, milestones: [...memory!.milestones, key] });
  };

  const sync = async () => {
    try {
      const me = await member();
      if (!me) return;
      if (!linuxReported) {
        await backend.setUsesLinux(deps.platform === 'linux');
        linuxReported = true;
      }
      await sendDays(load(me.userId), me.timeZone);
      const words = store.expressionCount();
      for (const step of VOCABULARY_STEPS) if (words >= step) await sendMilestone('vocabulary', String(step));
      while (levelUps.length > 0) {
        await sendMilestone('level_up', levelUps[0]!);
        levelUps.shift();
      }
    } catch (err) {
      console.error('[devtalk] practice sync failed:', err instanceof Error ? err.message : err);
    }
  };

  const flush = () => {
    pending?.cancel();
    pending = null;
    running = running.then(sync);
    return running;
  };

  return {
    start: () => {
      linuxReported = false;
      return flush();
    },
    notify(kind, detail) {
      if (kind === 'level' && detail && isLevelUp(detail) && !levelUps.includes(detail)) levelUps.push(detail);
      if (pending) return;
      pending = schedule(() => {
        pending = null;
        void flush();
      }, debounceMs);
    },
    flush,
  };
}
