// Badge icons (16 × 16, drawn as 1.6 px strokes) and display rules. Language badges use the stack logo instead.
import type { Badge, BadgeGroup } from '../../core/social/types';
import { stackIconFor } from './stack-icons';

const STAR = 'M8 2l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 11.4 4.3 13.5l.8-4.2L2 6.4l4.2-.5z';
const FLAME = 'M8 14c-2.8 0-4.5-1.8-4.5-4.2C3.5 6.5 7 5.5 7 1.8c2.6 1.6 5.5 4.3 5.5 8 0 2.4-1.7 4.2-4.5 4.2zM8 14c-1.2 0-2-.8-2-2 0-1.4 1.2-2 2-3.4.8 1.4 2 2 2 3.4 0 1.2-.8 2-2 2z';
/** A rounded rectangle as a path (x, y, width, height, radius). */
const box = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1-${r} ${r}h-${w - 2 * r}a${r} ${r} 0 0 1-${r}-${r}v-${h - 2 * r}a${r} ${r} 0 0 1 ${r}-${r}z`;
/** A circle as a path (centre x, centre y, radius). */
const dot = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0-${2 * r} 0z`;

/** Path data per badge id; each string is one stroked path. */
export const BADGE_ICONS: Record<string, string[]> = {
  creator: [STAR],
  moderator: ['M8 1.8 13 3.8v3.8c0 3-2.1 5.2-5 6.6-2.9-1.4-5-3.6-5-6.6V3.8z'],
  founding_member: ['M3.5 14V2.5M3.5 3h8l-1.6 2.8 1.6 2.8h-8'],
  beta_tester: ['M6 2h4M6.5 2v4L3 13a1 1 0 0 0 .9 1.5h8.2A1 1 0 0 0 13 13L9.5 6V2M4.8 10h6.4'],
  mentor: ['M8 1.8a4.2 4.2 0 0 0-2.5 7.6c.6.5 1 1.1 1 1.8v.3h3v-.3c0-.7.4-1.3 1-1.8A4.2 4.2 0 0 0 8 1.8zM6.3 13h3.4M6.8 14.6h2.4'],
  open_source: [dot(5, 3.5, 1.5), dot(5, 12.5, 1.5), dot(11, 5.5, 1.5), 'M5 5v6M11 7c0 2.5-6 1.5-6 4'],
  diff_master: ['M4.5 2.5v5M2 5h5M9 11.5h5'],
  room_host: ['M8 1.8a2 2 0 0 1 2 2v3.7a2 2 0 0 1-4 0V3.8a2 2 0 0 1 2-2zM4 7.5a4 4 0 0 0 8 0M8 11.5v2.7M5.8 14.2h4.4'],
  active_speaker: ['M3.5 3h9a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1H8l-3 2.5v-2.5H3.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM5.5 6.75h5'],
  'area:backend': [box(2.5, 2.5, 11, 4.5, 1), box(2.5, 9, 11, 4.5, 1), 'M5 4.75h.01M5 11.25h.01'],
  'area:frontend': [box(2, 2.5, 12, 11, 1.5), 'M2 6h12M4.5 4.25h.01M6.5 4.25h.01'],
  'area:mobile': [box(4, 1.5, 8, 13, 1.5), 'M7 12h2'],
  'area:data': ['M3 4c0-1.1 2.2-2 5-2s5 .9 5 2-2.2 2-5 2-5-.9-5-2zM3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2'],
  'area:devops': ['M13 6.5A5 5 0 0 0 3.6 5M3 9.5A5 5 0 0 0 12.4 11M3.6 2.4V5h2.6M12.4 13.6V11H9.8'],
  linux: [box(1.5, 2.5, 13, 11, 1.5), 'M4.5 6.5l2 1.5-2 1.5M8 10h3.5'],
  streak_7: [FLAME],
  streak_30: [FLAME],
  level_up: ['M2.5 13.5h3v-3h3v-3h3v-3h2'],
  vocabulary: ['M2.5 3.5c2-.8 3.8-.8 5.5.5 1.7-1.3 3.5-1.3 5.5-.5v9c-2-.8-3.8-.8-5.5.5-1.7-1.3-3.5-1.3-5.5-.5zM8 4v9'],
};

const GROUP_ORDER: BadgeGroup[] = ['community', 'technical', 'language', 'evolution'];

/** Community first, then technical, language and evolution; the server's order inside each group. */
export function orderBadges(badges: Badge[]): Badge[] {
  return GROUP_ORDER.flatMap((g) => badges.filter((b) => b.group === g));
}

/** The stack tag behind a language badge ("lang:python" → "python"). */
export const languageTag = (badge: Badge) => badge.id.slice('lang:'.length);

/** What the chip says: a language by the name people know it by, everything else by its label. */
export function badgeText(badge: Badge): string {
  if (badge.group !== 'language') return badge.label;
  const tag = languageTag(badge);
  return stackIconFor(tag)?.label ?? tag;
}

/** A longer description for the tooltip, or null when the text says it all. */
export function badgeHint(badge: Badge): string | null {
  if (!badge.detail) return null;
  if (badge.id === 'streak_7' || badge.id === 'streak_30') return `Practised ${badge.detail} days in a row`;
  if (badge.id === 'vocabulary') return `${badge.detail} expressions saved`;
  if (badge.id === 'level_up') return 'Moved up a level in the app';
  return null;
}
