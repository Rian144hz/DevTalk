import { NAV_ITEMS, routeForShortcut, shortcutLabel } from '../../src/renderer/lib/nav';

const ROUTES = ['home', 'practice', 'check', 'review', 'people', 'messages', 'rooms', 'progress', 'settings'];

test('NAV_ITEMS keep the spec order up to Settings (nine items)', () => {
  expect(NAV_ITEMS.map((i) => i.route)).toEqual(ROUTES);
  expect(NAV_ITEMS.map((i) => i.label)).toEqual(['Home', 'Practice', 'Check', 'Review', 'People', 'Messages', 'Rooms', 'Progress', 'Settings']);
  expect(NAV_ITEMS).toHaveLength(9);
  // Check uses the tick; every row has an icon.
  expect(NAV_ITEMS.find((i) => i.route === 'check')!.icon).toBe('check');
  for (const item of NAV_ITEMS) expect(item.icon.length, item.route).toBeGreaterThan(0);
});

test("routeForShortcut('1'…'9') follow it, '0' and 'a' are null", () => {
  for (const [i, route] of ROUTES.entries()) expect(routeForShortcut(String(i + 1)), String(i + 1)).toBe(route);
  // There is no tenth item yet, so Ctrl+0 is not a shortcut.
  expect(routeForShortcut('0')).toBeNull();
  for (const key of ['a', 'A', '', ' ', '10', '-1', 'Enter', 'Control', '!', '٣']) expect(routeForShortcut(key), JSON.stringify(key)).toBeNull();
});

test("shortcutLabel('check') is 'Ctrl 3'", () => {
  expect(shortcutLabel('check')).toBe('Ctrl 3');
  for (const [i, route] of ROUTES.entries()) expect(shortcutLabel(route as never), route).toBe(`Ctrl ${i + 1}`);
  // Routes that are not in the rail have no shortcut.
  for (const route of ['feedback', 'onboarding', 'join', 'legal', 'moderation', 'components'] as const) expect(shortcutLabel(route), route).toBeNull();
});

test("the tenth item is Ctrl+0: '0' reads 'Ctrl 0'", () => {
  const ten = [...NAV_ITEMS, { route: 'moderation' as const, label: 'Tenth', icon: 'shield' as const }];
  expect(routeForShortcut('0', ten)).toBe('moderation');
  expect(routeForShortcut('9', ten)).toBe('settings');
  expect(shortcutLabel('moderation', ten)).toBe('Ctrl 0');
  expect(shortcutLabel('settings', ten)).toBe('Ctrl 9');
  // An eleventh item has no key.
  const eleven = [...ten, { route: 'join' as const, label: 'Eleventh', icon: 'x' as const }];
  expect(shortcutLabel('join', eleven)).toBeNull();
});
