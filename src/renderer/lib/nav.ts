import type { IconName } from '../app/icon-names';
import type { RouteName } from './router';

export interface NavItem {
  route: RouteName;
  label: string;
  icon: IconName;
}

/**
 * The sidebar, in order. The rail, Ctrl+digit and the palette's shortcut hints all read this list, so they cannot
 * disagree: Ctrl+1 is the first row, Ctrl+9 the ninth and Ctrl+0 the tenth.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { route: 'home', label: 'Home', icon: 'home' },
  { route: 'practice', label: 'Practice', icon: 'practice' },
  { route: 'check', label: 'Check', icon: 'check' },
  { route: 'review', label: 'Review', icon: 'review' },
  { route: 'people', label: 'People', icon: 'people' },
  { route: 'messages', label: 'Messages', icon: 'chat' },
  { route: 'rooms', label: 'Rooms', icon: 'rooms' },
  { route: 'progress', label: 'Progress', icon: 'progress' },
  { route: 'settings', label: 'Settings', icon: 'settings' },
];

/** The key of the row at this place in the list: '1'…'9' for the first nine, '0' for the tenth, none after that. */
const keyAt = (index: number): string | null => (index >= 0 && index < 9 ? String(index + 1) : index === 9 ? '0' : null);

/** The screen a Ctrl+digit opens: '1'…'9' are rows 1…9 and '0' is row 10. Anything else is not a shortcut. */
export function routeForShortcut(key: string, items: readonly NavItem[] = NAV_ITEMS): RouteName | null {
  if (!/^[0-9]$/.test(key)) return null;
  const index = key === '0' ? 9 : Number(key) - 1;
  return items[index]?.route ?? null;
}

/** How a row's shortcut reads in the palette: 'Ctrl 3'; the tenth row reads 'Ctrl 0'. Null for a screen with no row. */
export function shortcutLabel(route: RouteName, items: readonly NavItem[] = NAV_ITEMS): string | null {
  const key = keyAt(items.findIndex((i) => i.route === route));
  return key === null ? null : `Ctrl ${key}`;
}
