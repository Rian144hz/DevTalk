import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { StoredProfile } from '../../core/ports';
import { api, unwrap } from '../lib/api';

interface AppData {
  /** undefined while loading, null before onboarding. */
  profile: StoredProfile | null | undefined;
  dueCount: number;
  refresh(): Promise<void>;
}

const Ctx = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<StoredProfile | null | undefined>(undefined);
  const [dueCount, setDueCount] = useState(0);
  const refresh = useCallback(async () => {
    const p = unwrap(await api().profile.get());
    setProfile(p);
    if (p) setDueCount(unwrap(await api().review.queue()).items.length);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return <Ctx.Provider value={{ profile, dueCount, refresh }}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppData outside AppDataProvider');
  return v;
}
