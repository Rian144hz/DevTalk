import type { RouteName } from '../lib/router';
import { PROVIDER_LABELS, type ProviderId } from '../../shared/providers';
import { Brand } from '../design-system';
import { Icon, type IconName } from './icons';

const NAV: { route: RouteName; label: string; icon: IconName }[] = [
  { route: 'home', label: 'Home', icon: 'home' },
  { route: 'practice', label: 'Practice', icon: 'practice' },
  { route: 'review', label: 'Review', icon: 'review' },
  { route: 'people', label: 'People', icon: 'people' },
  { route: 'messages', label: 'Messages', icon: 'chat' },
  { route: 'rooms', label: 'Rooms', icon: 'rooms' },
  { route: 'progress', label: 'Progress', icon: 'progress' },
  { route: 'settings', label: 'Settings', icon: 'settings' },
];

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
  const nav = props.moderator ? [...NAV, { route: 'moderation' as const, label: 'Moderation', icon: 'shield' as const }] : NAV;
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
