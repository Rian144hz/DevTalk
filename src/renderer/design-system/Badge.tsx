import type { CSSProperties } from 'react';
import type { Badge as BadgeInfo } from '../../core/social/types';
import { BADGE_ICONS, badgeHint, badgeText, languageTag, orderBadges } from '../lib/badges';
import { languageColour, stackIconFor } from '../lib/stack-icons';

/**
 * One badge: an icon in the group's colour (community violet, technical neutral, language brand colour, evolution
 * copper) and its name in the text colour.
 */
export function Badge({ badge }: { badge: BadgeInfo }) {
  const hint = badgeHint(badge);
  let icon;
  let style: CSSProperties | undefined;
  if (badge.group === 'language') {
    const tag = languageTag(badge);
    const logo = stackIconFor(tag);
    // Both theme colours are set; CSS picks the one for the current theme, so a theme switch needs no re-render.
    style = { '--badge-dark': languageColour(tag, 'dark'), '--badge-light': languageColour(tag, 'light') } as CSSProperties;
    icon = logo ? (
      <svg className="badge-logo" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={logo.path} /></svg>
    ) : null;
  } else {
    const paths = BADGE_ICONS[badge.id] ?? [];
    icon = (
      <svg className="badge-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        {paths.map((d) => <path key={d} d={d} />)}
      </svg>
    );
  }
  return (
    <span className={`member-badge member-badge-${badge.group}`} style={style} title={hint ?? undefined}>
      {badge.group === 'language' && <span className="visually-hidden">Main technology: </span>}
      {icon}
      <span>{badgeText(badge)}</span>
      {hint && <span className="visually-hidden">, {hint}</span>}
    </span>
  );
}

/** A member's badges in the fixed group order; nothing when there are none. */
export function BadgeRow({ badges }: { badges: BadgeInfo[] }) {
  if (badges.length === 0) return null;
  return (
    <ul className="badge-row" aria-label="Badges">
      {orderBadges(badges).map((b) => (
        <li key={b.id}><Badge badge={b} /></li>
      ))}
    </ul>
  );
}
