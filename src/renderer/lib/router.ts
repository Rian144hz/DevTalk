// Hash routes. Pure: parse/format only; the React hook lives in useRoute.ts.
export const ROUTE_NAMES = [
  'onboarding', 'home', 'practice', 'feedback', 'review', 'progress', 'settings', 'people', 'rooms', 'components',
] as const;
export type RouteName = (typeof ROUTE_NAMES)[number];
export interface Route {
  name: RouteName;
  id?: number;
}

export function parseHash(hash: string): Route {
  const [name, id] = hash.replace(/^#\/?/, '').split('/');
  if (!name || !(ROUTE_NAMES as readonly string[]).includes(name)) return { name: 'home' };
  const n = Number(id);
  return id && Number.isInteger(n) && n > 0 ? { name: name as RouteName, id: n } : { name: name as RouteName };
}

export function toHash(route: Route): string {
  return `#/${route.name}${route.id ? `/${route.id}` : ''}`;
}
