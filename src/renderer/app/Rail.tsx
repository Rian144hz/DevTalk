import type { RouteName } from '../lib/router';
import { PROVIDER_LABELS, type ProviderId } from '../../shared/providers';
import { Icon, type IconName } from './icons';

const NAV: { route: RouteName; label: string; icon: IconName }[] = [
  { route: 'home', label: 'Home', icon: 'home' },
  { route: 'practice', label: 'Practice', icon: 'practice' },
  { route: 'review', label: 'Review', icon: 'review' },
  { route: 'people', label: 'People', icon: 'people' },
  { route: 'rooms', label: 'Rooms', icon: 'rooms' },
  { route: 'progress', label: 'Progress', icon: 'progress' },
  { route: 'settings', label: 'Settings', icon: 'settings' },
];

export function Rail(props: { active: RouteName; dueCount: number; provider: ProviderId; model: string; onOpenPalette(): void }) {
  return (
    <aside className="rail">
      <div className="brand"><Icon name="pencil" size={18} />DevTalk</div>
      <button className="jump" type="button" onClick={props.onOpenPalette} aria-keyshortcuts="Control+K">
        Search or jump to… <kbd>Ctrl K</kbd>
      </button>
      <nav aria-label="Main">
        <ul className="nav">
          {NAV.map((item) => (
            <li key={item.route}>
              <a href={`#/${item.route}`} aria-current={props.active === item.route ? 'page' : undefined}>
                <Icon name={item.icon} />
                {item.label}
                {item.route === 'review' && props.dueCount > 0 && (
                  <span className="count num">{props.dueCount}<span className="visually-hidden"> due</span></span>
                )}
                {item.route === 'people' && <span className="later">Later</span>}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <p className="rail-foot">Coach: {PROVIDER_LABELS[props.provider]}<span className="rail-model">{props.model}</span></p>
    </aside>
  );
}
