import { NAV_ITEMS, type NavItem } from '../lib/nav';
import type { RouteName } from '../lib/router';
import { PROVIDER_LABELS, type ProviderId } from '../../shared/providers';
import { Brand } from '../design-system';
import { Icon } from './icons';

export function Rail(props: {
  active: RouteName;
  dueCount: number;
  /** Unread messages, requests included. */
  unread?: number;
  provider: ProviderId;
  model: string;
  moderator?: boolean;
  /** The voice room the person is in: Rooms leads back to it. */
  room?: string | null;
  onOpenPalette(): void;
}) {
  // Moderators get one more row at the end; it has no shortcut.
  const nav: readonly NavItem[] = props.moderator ? [...NAV_ITEMS, { route: 'moderation', label: 'Moderation', icon: 'shield' }] : NAV_ITEMS;
  return (
    <aside className="rail">
      <Brand />
      <button className="jump" type="button" onClick={props.onOpenPalette} aria-keyshortcuts="Control+K">
        Search or jump to… <kbd>Ctrl K</kbd>
      </button>
      <nav aria-label="Main">
        <ul className="nav">
          {nav.map((item) => (
            <li key={item.route}>
              <a href={item.route === 'rooms' && props.room ? `#/rooms/${props.room}` : `#/${item.route}`} aria-current={props.active === item.route ? 'page' : undefined}>
                <Icon name={item.icon} />
                {item.label}
                {item.route === 'review' && props.dueCount > 0 && (
                  <span className="count num">{props.dueCount}<span className="visually-hidden"> due</span></span>
                )}
                {item.route === 'messages' && (props.unread ?? 0) > 0 && (
                  <span className="count num">{props.unread}<span className="visually-hidden"> unread</span></span>
                )}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <p className="rail-foot">Coach: {PROVIDER_LABELS[props.provider]}<span className="rail-model">{props.model}</span></p>
    </aside>
  );
}
