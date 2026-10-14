// Hash routes. Pure: parse/format only; the React hook lives in useRoute.ts.
export const ROUTE_NAMES = [
  'onboarding', 'home', 'practice', 'feedback', 'review', 'progress', 'settings', 'people', 'rooms', 'components',
  'join', 'legal', 'moderation',
] as const;
export type RouteName = (typeof ROUTE_NAMES)[number];
export interface Route {
  name: RouteName;
  id?: number;
  /** A named sub-page, only where SUB_PAGES allows it. */
  sub?: string;
}

const SUB_PAGES: Partial<Record<RouteName, readonly string[]>> = {
  people: ['edit'],
  legal: ['terms', 'privacy', 'conduct'],
};

export function parseHash(hash: string): Route {
  const [name, rest] = hash.replace(/^#\/?/, '').split('/');
  if (!name || !(ROUTE_NAMES as readonly string[]).includes(name)) return { name: 'home' };
  const route = name as RouteName;
  if (rest && SUB_PAGES[route]?.includes(rest)) return { name: route, sub: rest };
  const n = Number(rest);
  return rest && Number.isInteger(n) && n > 0 ? { name: route, id: n } : { name: route };
}

export function toHash(route: Route): string {
  return `#/${route.name}${route.sub ? `/${route.sub}` : route.id ? `/${route.id}` : ''}`;
}
