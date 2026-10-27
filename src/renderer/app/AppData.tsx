import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { StoredProfile } from '../../core/ports';
import { api, unwrap } from '../lib/api';

interface AppData {
  /** undefined while loading, null before onboarding. */
  profile: StoredProfile | null | undefined;
  /** The first load of the profile failed (it stays undefined); `refresh` tries again. */
  loadFailed: boolean;
  dueCount: number;
  refresh(): Promise<void>;
  /** Unread messages for the rail, requests included. */
  unread: number;
  /** Screens that load the conversations tell the rail at once (reading clears the count). */
  setUnread(n: number): void;
  /** The voice room the person is in; Rooms in the rail, the palette and Ctrl+6 go back to it instead of the list. */
  room: string | null;
  setRoom(roomId: string | null): void;
}

const Ctx = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<StoredProfile | null | undefined>(undefined);
  const [dueCount, setDueCount] = useState(0);
  const [unread, setUnread] = useState(0);
  const [room, setRoom] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const refresh = useCallback(async () => {
    const p = unwrap(await api().profile.get());
    setProfile(p);
    if (p) setDueCount(unwrap(await api().review.queue()).items.length);
  }, []);
  useEffect(() => {
    refresh().catch(() => setLoadFailed(true));
  }, [refresh]);
  // A later successful `refresh` (the retry) clears the failure.
  useEffect(() => {
    if (profile !== undefined) setLoadFailed(false);
  }, [profile]);
  return <Ctx.Provider value={{ profile, loadFailed, dueCount, refresh, unread, setUnread, room, setRoom }}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppData outside AppDataProvider');
  return v;
}
