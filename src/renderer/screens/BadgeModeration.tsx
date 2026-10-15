import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { BADGE_LABELS, MANUAL_BADGES, type ManualBadge } from '../../core/social/badges';
import type { Badge as BadgeInfo, MemberSummary } from '../../core/social/types';
import type { ModerationHistoryEntry } from '../../shared/ipc-contract';
import { Avatar, Badge, BadgeRow, Button, EmptyState, Notice, Skeleton, TextField } from '../design-system';
import { AppErrorException, api, unwrap } from '../lib/api';
import { formatLongDate } from '../lib/format';
import { describeAction, isBadgeAction } from '../lib/moderation';

const message = (e: unknown) => (e instanceof AppErrorException ? e.message : 'Something went wrong. Try again.');
const SEARCH_DELAY_MS = 300;

/** Moderators find a member by name and give or take the badges that are given by hand, always with a reason. */
export function BadgeModeration() {
  const ids = { title: useId(), reason: useId() };
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<MemberSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [avatars, setAvatars] = useState<Record<string, string | null>>({});
  const [member, setMember] = useState<MemberSummary | null>(null);
  const [badges, setBadges] = useState<BadgeInfo[] | null>(null);
  const [history, setHistory] = useState<ModerationHistoryEntry[] | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    const n = ++latest.current;
    if (!q) {
      setFound(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      api()
        .moderation.searchMembers(q)
        .then((r) => {
          if (n !== latest.current) return;
          const list = unwrap(r);
          setFound(list);
          setSearchError(null);
          for (const m of list.filter((x) => x.hasAvatar)) {
            void api().social.avatar(m.id).then((a) => setAvatars((s) => ({ ...s, [m.id]: a.ok ? a.data : null })));
          }
        })
        .catch((e: unknown) => n === latest.current && setSearchError(message(e)))
        .finally(() => n === latest.current && setSearching(false));
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [query]);

  const loadMember = useCallback(async (m: MemberSummary) => {
    setBadges(null);
    setHistory(null);
    try {
      const [b, h] = await Promise.all([api().social.badges(m.id).then(unwrap), api().moderation.history(m.id).then(unwrap)]);
      setBadges(b);
      setHistory(h.filter(isBadgeAction));
    } catch (e) {
      setError(message(e));
    }
  }, []);

  function select(m: MemberSummary) {
    setMember(m);
    setReason('');
    setReasonError(null);
    setError(null);
    void loadMember(m);
  }

  async function change(kind: 'grant' | 'revoke', badge: ManualBadge) {
    if (!member) return;
    if (!reason.trim()) {
      setReasonError('Write a reason first.');
      return;
    }
    setBusy(`${kind}:${badge}`);
    setReasonError(null);
    setError(null);
    try {
      const input = { userId: member.id, badge, reason: reason.trim() };
      unwrap(await (kind === 'grant' ? api().moderation.grantBadge(input) : api().moderation.revokeBadge(input)));
      setReason('');
      await loadMember(member);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  const has = (badge: ManualBadge) => !!badges?.some((b) => b.id === badge);

  return (
    <section className="badge-moderation" aria-labelledby={ids.title}>
      <h2 id={ids.title}>Badges</h2>
      <p className="lede">Give or remove Beta tester, Mentor and Open source contributor. The person gets a notice when they receive one.</p>
      <div className="moderation">
        <div className="report-col">
          <TextField label="Find a member" type="search" value={query} maxLength={40} spellCheck={false}
            onChange={(e) => setQuery(e.target.value)} hint="Search by display name." />
          {searchError && <Notice tone="error" title={searchError} />}
          {searching && <Skeleton width="60%" />}
          {!searching && found && found.length === 0 && <p className="muted">No member with that name.</p>}
          {!searching && found && found.length > 0 && (
            <ul className="report-list" aria-label="Members found">
              {found.map((m) => (
                <li key={m.id}>
                  <button type="button" className="member-button" aria-current={member?.id === m.id ? 'true' : undefined} onClick={() => select(m)}>
                    <Avatar src={avatars[m.id] ?? null} name={m.displayName} size={32} userId={m.id} mascot={m.mascot} />
                    <span className="report-who">{m.displayName}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {member ? (
          <div className="report-detail">
            <h3 className="member-title">{member.displayName}</h3>
            {badges === null ? <Skeleton width="50%" /> : badges.length > 0 ? <BadgeRow badges={badges} /> : <p className="muted">No badges yet.</p>}
            <TextField label="Reason" value={reason} maxLength={200} error={reasonError ?? undefined}
              onChange={(e) => setReason(e.target.value)} hint="Required. Kept in the history for other moderators." />
            {error && <Notice tone="error" title={error} />}
            <ul className="ruled badge-actions" aria-label="Badges given by moderators">
              {MANUAL_BADGES.map((b) => {
                const label = BADGE_LABELS[b]!;
                const owned = has(b);
                return (
                  <li key={b}>
                    <Badge badge={{ id: b, group: 'community', label, detail: null }} />
                    <Button variant="secondary" busy={busy === `${owned ? 'revoke' : 'grant'}:${b}`} disabled={badges === null || busy !== null}
                      onClick={() => void change(owned ? 'revoke' : 'grant', b)}>
                      {owned ? `Remove ${label}` : `Give ${label}`}
                    </Button>
                  </li>
                );
              })}
            </ul>
            {history && history.length > 0 && (
              <ul className="history-list" aria-label="Badge history">
                {history.map((h, k) => (
                  <li key={k}>
                    <span className="history-what">{describeAction(h)}</span>
                    {h.reason && <span className="history-why">{h.reason}</span>}
                    <span className="history-when">{formatLongDate(h.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <EmptyState title="Find a member to see their badges" body="Search by display name, then choose the person." />
        )}
      </div>
    </section>
  );
}
