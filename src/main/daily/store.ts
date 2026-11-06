import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { DEFAULT_REMINDER_TIME, REMINDER_TIME, type DailyPick } from '../../core/daily/daily';
import { CHALLENGE_CATEGORIES } from '../../core/domain/categories';

/** What the daily challenge remembers between runs. */
export interface DailyState {
  /** The daily challenge is on: the Home card, and (with the reminder) a notice at `time`. */
  enabled: boolean;
  /** HH:MM, local time. */
  time: string;
  /** The local day that already had its notice (it shows once a day); null when none yet. */
  lastNotifiedDay: string | null;
  /** The challenge of the current local day; null before the first ask. */
  pick: DailyPick | null;
}

export interface DailyStore {
  /** The saved state; the defaults when there is no file, or the file is damaged or holds something it should not. */
  get(): DailyState;
  /** Saves the fields in `patch` (the others stay) and returns the new state. Refuses what `get` would not read back. */
  update(patch: Partial<DailyState>): DailyState;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const StateSchema = z.object({
  enabled: z.boolean().default(false),
  time: z.string().regex(REMINDER_TIME).default(DEFAULT_REMINDER_TIME),
  lastNotifiedDay: z.string().regex(DAY).nullable().default(null),
  pick: z
    .object({
      day: z.string().regex(DAY),
      category: z.enum(CHALLENGE_CATEGORIES),
      challengeId: z.number().int().positive().nullable(),
    })
    .nullable()
    .default(null),
});

const defaults = (): DailyState => ({ enabled: false, time: DEFAULT_REMINDER_TIME, lastNotifiedDay: null, pick: null });

/**
 * One small file in the data folder (`daily.json`). It is checked on every read: anything that is not a good state gives the
 * defaults, so a damaged or edited file can never keep the app from starting. A write goes to a temp file and is renamed over
 * the real one, so the file is whole or untouched.
 */
export function createDailyStore(o: { filePath: string }): DailyStore {
  const { filePath } = o;

  const get = (): DailyState => {
    if (!existsSync(filePath)) return defaults();
    try {
      const parsed = StateSchema.safeParse(JSON.parse(readFileSync(filePath, 'utf8')));
      return parsed.success ? parsed.data : defaults();
    } catch {
      return defaults();
    }
  };

  return {
    get,
    update(patch) {
      // A field set to undefined means "no change", not "back to the default".
      const changes = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
      const next = StateSchema.parse({ ...get(), ...changes });
      const tmp = `${filePath}.tmp`;
      try {
        writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
        renameSync(tmp, filePath);
      } catch (err) {
        rmSync(tmp, { force: true });
        throw err;
      }
      return next;
    },
  };
}
