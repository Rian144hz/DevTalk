// Follow and like counts as the profile shows them, updated before the server answers.
import type { SocialStats } from '../../core/social/types';

/** The counts after the caller follows (on) or stops following; already in that state = unchanged. */
export function applyFollow(stats: SocialStats, on: boolean): SocialStats {
  if (stats.iFollow === on) return stats;
  return { ...stats, iFollow: on, followers: Math.max(0, stats.followers + (on ? 1 : -1)) };
}

/** The counts after the caller likes (on) or stops liking; already in that state = unchanged. */
export function applyLike(stats: SocialStats, on: boolean): SocialStats {
  if (stats.iLike === on) return stats;
  return { ...stats, iLike: on, likes: Math.max(0, stats.likes + (on ? 1 : -1)) };
}

export const followersText = (n: number) => `${n} follower${n === 1 ? '' : 's'}`;
export const followingText = (n: number) => `${n} following`;
export const likesText = (n: number) => `${n} like${n === 1 ? '' : 's'}`;
