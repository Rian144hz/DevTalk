import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MEMBER_PAGE_SIZE } from '../../core/social/people';
import type { MemberRow } from '../../core/social/types';
import { Button, MemberList, Notice, Skeleton } from '../design-system';
import { AppErrorException } from '../lib/api';
import { useAvatars } from '../lib/useAvatars';

const message = (e: unknown) => (e instanceof AppErrorException ? e.message : 'Something went wrong. Try again.');

/**
 * A member list loaded 30 at a time with "Load more". `reloadKey` starts over from the first page when the
 * filters change; answers to older requests are ignored.
 */
export function PagedMembers({ load, label, empty, reloadKey }: {
  load: (page: number) => Promise<MemberRow[]>;
  label: string;
  empty: ReactNode;
  reloadKey: string;
}) {
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const avatars = useAvatars(rows ?? []);

  async function fetchPage(p: number) {
    const n = ++latest.current;
    setBusy(true);
    setError(null);
    try {
      const next = await loadRef.current(p);
      if (n !== latest.current) return;
      setRows((r) => (p === 0 ? next : [...(r ?? []), ...next]));
      setPage(p);
      setMore(next.length === MEMBER_PAGE_SIZE);
    } catch (e) {
      if (n === latest.current) setError(message(e));
    } finally {
      if (n === latest.current) setBusy(false);
    }
  }

  useEffect(() => {
    setRows(null);
    void fetchPage(0);
  }, [reloadKey]);

  if (error && rows === null) {
    return <Notice tone="error" title={error} action={<Button variant="secondary" onClick={() => void fetchPage(0)}>Try again</Button>} />;
  }
  if (rows === null) {
    return (
      <div className="member-skeleton" aria-busy="true">
        <Skeleton width="45%" /><Skeleton width="60%" /><Skeleton width="35%" />
      </div>
    );
  }
  if (rows.length === 0) return <>{empty}</>;
  return (
    <>
      <MemberList rows={rows} label={label} avatars={avatars} />
      {error && <Notice tone="error" title={error} />}
      {more && (
        <div className="row-actions">
          <Button variant="secondary" busy={busy} onClick={() => void fetchPage(page + 1)}>Load more</Button>
        </div>
      )}
    </>
  );
}
