import type { Badge, MemberRow } from '../../core/social/types';
import { memberLine } from '../../core/social/people';
import { Avatar } from './Avatar';
import { BadgeRow } from './Badge';

const languageBadges = (row: MemberRow): Badge[] =>
  row.mainStack.map((tag) => ({ id: `lang:${tag}`, group: 'language', label: tag, detail: null }));

/** Members as ruled rows: picture, name, area and level, main technologies. Each row opens the profile. */
export function MemberList({ rows, label, avatars }: { rows: MemberRow[]; label: string; avatars: Record<string, string | null> }) {
  return (
    <ul className="member-list" aria-label={label}>
      {rows.map((r) => (
        <li key={r.id}>
          <a className="member-row" href={`#/people/u/${r.id}`}>
            <Avatar src={avatars[r.id] ?? null} name={r.displayName} size={40} userId={r.id} mascot={r.mascot} />
            <span className="member-main">
              <span className="member-name">{r.displayName}</span>
              <span className="member-meta">{memberLine(r)}</span>
            </span>
            <BadgeRow badges={languageBadges(r)} />
          </a>
        </li>
      ))}
    </ul>
  );
}
