import { BADGE_LABELS, MANUAL_BADGES } from '../../src/core/social/badges';
import { fnv1a32, mascotFor } from '../../src/core/social/mascots';
import { MASCOTS, type ProfileDraft } from '../../src/core/social/types';
import { ProfileDraftSchema } from '../../src/core/social/validate';
import { bucketByDay, graphLevel, graphWeeks, streaks, type DayActivity } from '../../src/core/progress/practice';

const day = (d: string, answers = 0, reviews = 0): DayActivity => ({ day: d, answers, reviews });

describe('mascots', () => {
  test('the nine ids are the spec values', () => {
    expect(MASCOTS).toEqual(['duck-1', 'duck-2', 'duck-3', 'bear-1', 'bear-2', 'bear-3', 'axolotl-1', 'axolotl-2', 'axolotl-3']);
  });

  test('fnv1a32 matches the reference values', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
  });

  test('the default mascot is stable and covers all nine', () => {
    expect(mascotFor('362f7b40-f2e3-4623-9d92-7146cf81ef62', null)).toBe(mascotFor('362f7b40-f2e3-4623-9d92-7146cf81ef62', null));
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(mascotFor(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, null));
    expect(seen.size).toBe(9);
  });

  test('a chosen mascot wins over the default', () => {
    expect(mascotFor('any-id', 'bear-2')).toBe('bear-2');
  });
});

describe('badges catalog', () => {
  test('manual badges and labels follow the spec', () => {
    expect(MANUAL_BADGES).toEqual(['beta_tester', 'mentor', 'open_source']);
    expect(BADGE_LABELS['founding_member']).toBe('Founding member');
    expect(BADGE_LABELS['open_source']).toBe('Open source contributor');
    expect(BADGE_LABELS['streak_30']).toBe('30-day streak');
    expect(BADGE_LABELS['area:backend']).toBe('Back end');
  });
});

describe('practice days', () => {
  test('timestamps fall on the local day of the given time zone', () => {
    const days = bucketByDay(['2026-10-14T02:30:00Z', '2026-10-14T15:00:00Z'], ['2026-10-14T02:31:00Z'], 'America/Sao_Paulo');
    expect(days).toEqual([day('2026-10-13', 1, 1), day('2026-10-14', 1, 0)]);
    expect(bucketByDay(['2026-10-14T02:30:00Z'], [], 'UTC')).toEqual([day('2026-10-14', 1, 0)]);
  });

  test('graph levels use answers × 5 + reviews', () => {
    expect(graphLevel(day('d'))).toBe(0);
    expect(graphLevel(day('d', 0, 1))).toBe(1);
    expect(graphLevel(day('d', 0, 9))).toBe(1);
    expect(graphLevel(day('d', 2, 0))).toBe(2);
    expect(graphLevel(day('d', 0, 24))).toBe(2);
    expect(graphLevel(day('d', 5, 0))).toBe(3);
    expect(graphLevel(day('d', 0, 49))).toBe(3);
    expect(graphLevel(day('d', 10, 0))).toBe(4);
  });

  test('the current streak ends today or yesterday; a gap breaks it', () => {
    const run = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'].map((d) => day(d, 1));
    expect(streaks(run, '2026-10-13')).toEqual({ current: 4, longest: 4 });
    expect(streaks(run, '2026-10-14')).toEqual({ current: 4, longest: 4 });
    expect(streaks(run, '2026-10-15')).toEqual({ current: 0, longest: 4 });
    expect(streaks([...run, day('2026-10-14', 0, 0)], '2026-10-14')).toEqual({ current: 4, longest: 4 });
  });

  test('the longest streak spans the whole history', () => {
    const days = [...['2026-01-01', '2026-01-02', '2026-01-03'].map((d) => day(d, 1)), day('2026-10-14', 0, 3)];
    expect(streaks(days, '2026-10-14')).toEqual({ current: 1, longest: 3 });
  });

  test('graphWeeks gives 53 Monday-first columns ending in the current week', () => {
    const weeks = graphWeeks([day('2026-10-14', 2, 3)], '2026-10-14');
    expect(weeks).toHaveLength(53);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(new Date(`${weeks[0]![0]!.day}T12:00:00Z`).getUTCDay()).toBe(1);
    const last = weeks[52]!;
    expect(last[0]!.day).toBe('2026-10-12');
    expect(last[2]).toEqual({ day: '2026-10-14', answers: 2, reviews: 3, level: 2 });
  });
});

describe('profile draft extras', () => {
  const base: ProfileDraft = {
    displayName: 'Rian', nativeLanguage: 'Portuguese (Brazil)', level: 'B1', timezone: 'America/Bahia', area: 'backend',
    stack: ['python', 'java', 'c++'], availability: [], bio: '', mainStack: ['python'], showProgress: true, mascot: null,
  };
  const paths = (d: unknown) => {
    const r = ProfileDraftSchema.safeParse(d);
    return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
  };

  test('a valid draft with extras parses', () => {
    expect(paths(base)).toEqual([]);
    expect(paths({ ...base, mascot: 'axolotl-2', mainStack: ['python', 'java'], showProgress: false })).toEqual([]);
  });

  test('at most two main stacks, all from the stack', () => {
    expect(paths({ ...base, mainStack: ['python', 'java', 'c++'] })).toEqual(['mainStack']);
    expect(paths({ ...base, mainStack: ['rust'] })).toEqual(['mainStack']);
  });

  test('the mascot must be one of the nine', () => {
    expect(paths({ ...base, mascot: 'cat-1' })).toEqual(['mascot']);
  });
});
