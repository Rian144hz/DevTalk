// How moderation history entries read in the Moderation screen.
import { BADGE_LABELS } from '../../core/social/badges';
import type { ModerationHistoryEntry } from '../../shared/ipc-contract';
import { formatLongDate } from './format';

export function describeAction(entry: ModerationHistoryEntry): string {
  if (entry.action === 'warn') return 'Warned';
  if (entry.action === 'unsuspend') return 'Suspension lifted';
  if (entry.action === 'grant_badge' || entry.action === 'revoke_badge') {
    const verb = entry.action === 'grant_badge' ? 'Gave' : 'Removed';
    const label = entry.badge ? BADGE_LABELS[entry.badge] : undefined;
    return label ? `${verb} ${label}` : `${verb} a badge`;
  }
  if (entry.until === 'infinity') return 'Suspended permanently';
  return `Suspended until ${entry.until ? formatLongDate(entry.until) : 'a later date'}`;
}

export const isBadgeAction = (entry: ModerationHistoryEntry) => entry.action === 'grant_badge' || entry.action === 'revoke_badge';

/** Suspended when the newest suspend/unsuspend action is a suspension still running (badge actions do not count). */
export function isSuspended(history: ModerationHistoryEntry[]): boolean {
  const last = history.find((h) => h.action === 'suspend' || h.action === 'unsuspend');
  if (!last || last.action !== 'suspend') return false;
  return last.until === 'infinity' || (!!last.until && Date.parse(last.until) > Date.now());
}
