import { CHALLENGE_CATEGORIES, type ChallengeCategory } from '../domain/categories';

export const CATEGORY_WINDOW = 8;

/** Least-used category among the last 8 challenges (newest first); ties broken by `rng`. */
export function pickCategory(recent: ChallengeCategory[], rng: () => number): ChallengeCategory {
  const counts = new Map<ChallengeCategory, number>(CHALLENGE_CATEGORIES.map((c) => [c, 0]));
  for (const c of recent.slice(0, CATEGORY_WINDOW)) counts.set(c, (counts.get(c) ?? 0) + 1);
  const min = Math.min(...counts.values());
  const candidates = CHALLENGE_CATEGORIES.filter((c) => counts.get(c) === min);
  return candidates[Math.min(Math.floor(rng() * candidates.length), candidates.length - 1)]!;
}
