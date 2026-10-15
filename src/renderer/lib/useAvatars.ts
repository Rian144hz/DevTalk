import { useEffect, useState } from 'react';
import type { MemberRow } from '../../core/social/types';
import { api } from './api';

/** Photos of the listed members that have one, fetched once each; a failed fetch shows the mascot. */
export function useAvatars(rows: Pick<MemberRow, 'id' | 'hasAvatar'>[]): Record<string, string | null> {
  const [avatars, setAvatars] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let alive = true;
    for (const r of rows) {
      if (!r.hasAvatar || r.id in avatars) continue;
      void api().social.avatar(r.id).then((res) => {
        if (alive) setAvatars((a) => ({ ...a, [r.id]: res.ok ? res.data : null }));
      });
    }
    return () => {
      alive = false;
    };
    // Only new rows matter; avatars already asked for stay.
  }, [rows]);
  return avatars;
}
