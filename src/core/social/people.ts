// Member lists: page size, search limit and how a member is described in a row.
import { BADGE_LABELS } from './badges';
import type { MemberRow } from './types';

export const MEMBER_PAGE_SIZE = 30;
export const MEMBER_QUERY_MAX = 40;

/** "Back end developer, B1"; "Developer, C1" when the area is other. */
export function memberLine(row: Pick<MemberRow, 'area' | 'level'>): string {
  const area = row.area === 'other' ? null : BADGE_LABELS[`area:${row.area}`];
  return `${area ? `${area} developer` : 'Developer'}, ${row.level}`;
}
