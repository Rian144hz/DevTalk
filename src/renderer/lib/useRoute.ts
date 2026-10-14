import { useCallback, useSyncExternalStore } from 'react';
import { parseHash, toHash, type Route } from './router';

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useRoute(): [Route, (route: Route) => void] {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const navigate = useCallback((route: Route) => {
    window.location.hash = toHash(route);
  }, []);
  return [parseHash(hash), navigate];
}
