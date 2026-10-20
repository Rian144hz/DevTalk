// Hash routes. Pure: parse/format only; the React hook lives in useRoute.ts.
export const ROUTE_NAMES = [
  'onboarding', 'home', 'practice', 'feedback', 'review', 'progress', 'settings', 'people', 'messages', 'rooms', 'components',
  'join', 'legal', 'moderation',
] as const;
export type RouteName = (typeof ROUTE_NAMES)[number];
export interface Route {
  name: RouteName;
  id?: number;
  /** A named sub-page, only where SUB_PAGES allows it. */
  sub?: string;
  /** Another member's profile: #/people/u/<uuid>. */
  userId?: string;
  /** One of their lists: #/people/u/<uuid>/followers or /following. */
  list?: 'followers' | 'following';
  /** One conversation: #/messages/<uuid>. */
  conversationId?: string;
  /** A first message to someone: #/messages/to/<uuid>. */
  to?: string;
}

const SUB_PAGES: Partial<Record<RouteName, readonly string[]>> = {
  people: ['edit', 'me', 'following'],
  legal: ['terms', 'privacy', 'conduct'],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LISTS = ['followers', 'following'] as const;

export function parseHash(hash: string): Route {
  const [name, rest, userId, list] = hash.replace(/^#\/?/, '').split('/');
  if (!name || !(ROUTE_NAMES as readonly string[]).includes(name)) return { name: 'home' };
  const route = name as RouteName;
  if (route === 'people' && rest === 'u') {
    if (!userId || !UUID.test(userId)) return { name: route };
    return (LISTS as readonly string[]).includes(list ?? '')
      ? { name: route, userId, list: list as Route['list'] }
      : { name: route, userId };
  }
  if (route === 'messages') {
    if (rest === 'to') return userId && UUID.test(userId) ? { name: route, to: userId } : { name: route };
    return rest && UUID.test(rest) ? { name: route, conversationId: rest } : { name: route };
  }
  if (rest && SUB_PAGES[route]?.includes(rest)) return { name: route, sub: rest };
  const n = Number(rest);
  return rest && Number.isInteger(n) && n > 0 ? { name: route, id: n } : { name: route };
}

export function toHash(route: Route): string {
  if (route.conversationId) return `#/${route.name}/${route.conversationId}`;
  if (route.to) return `#/${route.name}/to/${route.to}`;
  if (route.userId) return `#/${route.name}/u/${route.userId}${route.list ? `/${route.list}` : ''}`;
  return `#/${route.name}${route.sub ? `/${route.sub}` : route.id ? `/${route.id}` : ''}`;
}
