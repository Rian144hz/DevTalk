import { useCallback, useEffect, useId, useState } from 'react';
import type { ModerationDecision, ModerationReport, ReportContext } from '../../core/social/types';
import type { ModerationHistoryEntry } from '../../shared/ipc-contract';
import type { ReportedMessage } from '../../core/social/chat';
import { ROOM_THEME_LABELS, type RoomReportContext } from '../../core/social/rooms';
import { messageTime } from '../lib/chat';
import { latestOnly } from '../lib/latest';
import { Avatar, Button, EmptyState, Notice, REPORT_REASON_LABELS, Segmented, Skeleton, TextArea, TextField } from '../design-system';
import { AppErrorException, api, unwrap } from '../lib/api';
import { formatLongDate } from '../lib/format';
import { describeAction, isSuspended } from '../lib/moderation';
import { BadgeModeration } from './BadgeModeration';

const message = (e: unknown) => (e instanceof AppErrorException ? e.message : 'Something went wrong. Try again.');

const CONTEXT_LABELS: Record<ReportContext, string> = { profile: 'Profile', message: 'Chat message', room: 'Voice room' };
type Length = '1' | '7' | '30' | 'permanent';
const LENGTHS: { value: Length; label: string }[] = [
  { value: '1', label: '1 day' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: 'permanent', label: 'Permanent' },
];

const when = (iso: string) => `${formatLongDate(iso)}, ${messageTime(iso)}`;
const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();

/** The room a report came from: its title, theme, host and opening time, then who was in it and when. */
function RoomContext({ room }: { room: RoomReportContext | null | undefined }) {
  const headingId = useId();
  return (
    <section className="decision" aria-labelledby={headingId}>
      <h3 id={headingId}>The room</h3>
      {room === undefined ? (
        <Skeleton width="50%" />
      ) : room === null ? (
        <p className="muted">No copy of the room was kept. The reporter or the reported person was not in it.</p>
      ) : (
        <>
          <dl className="profile-facts">
            <dt>Title</dt>
            <dd dir="auto">{room.title}</dd>
            <dt>Theme</dt>
            <dd>{ROOM_THEME_LABELS[room.theme]}</dd>
            <dt>Host</dt>
            <dd>{room.hostName ?? <span className="muted">No host</span>}</dd>
            <dt>Opened</dt>
            <dd>{when(room.createdAt)}</dd>
          </dl>
          <ul className="room-context" aria-label="Who was in the room">
            {room.people.map((p, i) => (
              <li key={i}>
                <span className="room-context-who">{p.name ?? 'Deleted account'}</span>
                <span className="muted">
                  {p.leftAt
                    ? `${when(p.joinedAt)} to ${sameDay(p.joinedAt, p.leftAt) ? messageTime(p.leftAt) : when(p.leftAt)}`
                    : `${when(p.joinedAt)}, still in the room`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function ModerationScreen() {
  const [reports, setReports] = useState<ModerationReport[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ModerationReport | null>(null);
  const [history, setHistory] = useState<ModerationHistoryEntry[] | null>(null);
  const [context, setContext] = useState<ReportedMessage[] | null>(null);
  /** A room report's room; undefined while it loads, null when there is no copy to show. */
  const [room, setRoom] = useState<RoomReportContext | null | undefined>(undefined);
  // A slow answer for a report clicked earlier never shows under the one selected now.
  const [latestContext] = useState(latestOnly);
  const [latestHistory] = useState(latestOnly);
  const [avatars, setAvatars] = useState<Record<string, string | null>>({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [warnText, setWarnText] = useState('');
  const [length, setLength] = useState<Length>('7');
  const [reason, setReason] = useState('');

  const loadReports = useCallback(async () => {
    setLoadError(null);
    try {
      const list = unwrap(await api().moderation.reports());
      setReports(list);
      for (const id of new Set(list.flatMap((r) => (r.reported ? [r.reported.id] : [])))) {
        void api().social.avatar(id).then((res) => setAvatars((a) => ({ ...a, [id]: res.ok ? res.data : null })));
      }
    } catch (e) {
      setLoadError(message(e));
    }
  }, []);
  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const loadHistory = useCallback(
    async (userId: string) => {
      setHistory(null);
      await latestHistory(api().moderation.history(userId), (res) => {
        if (res.ok) setHistory(res.data);
        else setActionError(res.error.message);
      });
    },
    [latestHistory],
  );

  function select(r: ModerationReport) {
    setSelected(r);
    setSaved(false);
    setActionError(null);
    setWarnText('');
    setReason('');
    setLength('7');
    if (r.reported) void loadHistory(r.reported.id);
    else setHistory([]);
    setContext(null);
    setRoom(undefined);
    if (r.contextType === 'message') {
      void latestContext(api().moderation.reportContext(r.id), (res) => {
        if (res.ok) setContext(res.data);
        else setActionError(res.error.message);
      });
    } else if (r.contextType === 'room') {
      void latestContext(api().moderation.roomContext(r.id), (res) => {
        if (res.ok) setRoom(res.data);
        else setActionError(res.error.message);
      });
    }
  }

  async function decide(kind: string, decision: ModerationDecision) {
    setBusy(kind);
    setActionError(null);
    try {
      unwrap(await api().moderation.decide(decision));
      if (decision.kind !== 'unsuspend') setSaved(true);
      setWarnText('');
      setReason('');
      await loadReports();
      if (selected?.reported) await loadHistory(selected.reported.id);
    } catch (e) {
      setActionError(message(e));
    } finally {
      setBusy(null);
    }
  }

  const head = (
    <header className="page-head">
      <div>
        <h1>Moderation</h1>
        <p className="lede">Open reports, oldest first. Each decision is recorded in the person's history.</p>
      </div>
    </header>
  );

  if (loadError) {
    return (
      <main className="page moderation-page">
        {head}
        <Notice tone="error" title={loadError} action={<Button variant="secondary" onClick={() => void loadReports()}>Try again</Button>} />
      </main>
    );
  }
  if (!reports) {
    return (
      <main className="page moderation-page" aria-busy="true">
        {head}
        <Skeleton width="40%" /><Skeleton width="60%" />
      </main>
    );
  }

  const target = selected?.reported ?? null;
  const reportId = saved ? null : (selected?.id ?? null);
  return (
    <main className="page moderation-page">
      {head}
      <div className="moderation">
        <div className="report-col">
          {reports.length === 0 ? (
            <EmptyState title="No open reports." body="New reports appear here. Nothing needs a decision right now." />
          ) : (
            <ul className="report-list" aria-label="Open reports">
              {reports.map((r) => (
                <li key={r.id}>
                  <button type="button" aria-current={selected?.id === r.id ? 'true' : undefined} onClick={() => select(r)}>
                    <Avatar src={r.reported ? (avatars[r.reported.id] ?? null) : null} name={r.reported?.displayName ?? '?'} size={32} userId={r.reported?.id} mascot={r.reported?.mascot} />
                    <span className="report-main">
                      <span className="report-who">{r.reported?.displayName ?? 'Deleted account'}</span>
                      <span className="report-meta">{REPORT_REASON_LABELS[r.reason]}, {CONTEXT_LABELS[r.contextType].toLowerCase()}</span>
                    </span>
                    <span className="report-date">{formatLongDate(r.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {selected && (
          <section className="report-detail" aria-labelledby="report-title">
            <h2 id="report-title">Report about {target?.displayName ?? 'a deleted account'}</h2>
            {saved && <p className="report-saved" role="status">Decision saved. The report is closed.</p>}
            <dl className="profile-facts">
              <dt>Reason</dt>
              <dd>{REPORT_REASON_LABELS[selected.reason]}</dd>
              <dt>Where</dt>
              <dd>{CONTEXT_LABELS[selected.contextType]}</dd>
              <dt>Sent</dt>
              <dd>{formatLongDate(selected.createdAt)}</dd>
              <dt>Details</dt>
              <dd className="bio">{selected.details || <span className="muted">No details given.</span>}</dd>
            </dl>

            {selected.contextType === 'message' && (
              <div className="decision">
                <h3>The conversation</h3>
                {context === null ? (
                  <Skeleton width="50%" />
                ) : context.length === 0 ? (
                  <p className="muted">No copy of the conversation was kept. The reporter was not in it, or it was deleted.</p>
                ) : (
                  <ol className="report-context" aria-label="Reported conversation">
                    {context.map((m) => (
                      <li key={m.messageId} className={m.reported ? 'is-reported' : undefined}>
                        <p className="report-context-who">
                          <span>{m.senderName ?? 'Deleted account'}</span>
                          <span className="muted">{formatLongDate(m.createdAt)}, {messageTime(m.createdAt)}</span>
                          {m.reported && <span className="report-context-flag">Reported</span>}
                        </p>
                        {m.body ? <p className="chat-bubble">{m.body}</p> : <p className="chat-bubble is-deleted">Message deleted</p>}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}

            {selected.contextType === 'room' && <RoomContext room={room} />}

            {target && (
              <div className="decision">
                <h3>History</h3>
                {history === null ? (
                  <Skeleton width="50%" />
                ) : history.length === 0 ? (
                  <p className="muted">No earlier actions.</p>
                ) : (
                  <ul className="history-list" aria-label="Earlier actions">
                    {history.map((h, k) => (
                      <li key={k}>
                        <span className="history-what">{describeAction(h)}</span>
                        {h.reason && <span className="history-why">{h.reason}</span>}
                        <span className="history-when">{formatLongDate(h.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {history && isSuspended(history) && (
                  <div className="row-actions">
                    <Button variant="secondary" busy={busy === 'unsuspend'} onClick={() => void decide('unsuspend', { kind: 'unsuspend', target: target.id })}>
                      Lift suspension
                    </Button>
                  </div>
                )}
              </div>
            )}

            {actionError && <Notice tone="error" title={actionError} />}

            {!saved && (
              <>
                <div className="decision">
                  <h3>Dismiss</h3>
                  <p className="muted">Nothing breaks the code of conduct. The report is closed without action.</p>
                  <div className="row-actions">
                    <Button variant="secondary" busy={busy === 'dismiss'} onClick={() => void decide('dismiss', { kind: 'dismiss', reportId: selected.id })}>
                      Dismiss report
                    </Button>
                  </div>
                </div>

                {target && (
                  <>
                    <div className="decision">
                      <h3>Warn</h3>
                      <TextArea label="Warning message" className="textarea-short" rows={3} maxLength={1000} value={warnText}
                        onChange={(e) => setWarnText(e.target.value)} hint={`${target.displayName} sees this message on their People page.`} />
                      <div className="row-actions">
                        <Button variant="secondary" busy={busy === 'warn'} disabled={!warnText.trim()}
                          onClick={() => void decide('warn', { kind: 'warn', reportId, target: target.id, message: warnText.trim() })}>
                          Send warning
                        </Button>
                      </div>
                    </div>

                    <div className="decision">
                      <h3>Suspend</h3>
                      <Segmented label="Length" value={length} options={LENGTHS} onChange={setLength} />
                      <TextField label="Reason for the suspension" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)}
                        hint="Kept in the history. Other moderators read it." />
                      <div className="row-actions">
                        <Button variant="secondary" busy={busy === 'suspend'} disabled={!reason.trim()}
                          onClick={() => void decide('suspend', {
                            kind: 'suspend',
                            reportId,
                            target: target.id,
                            days: length === 'permanent' ? null : (Number(length) as 1 | 7 | 30),
                            reason: reason.trim(),
                          })}>
                          Suspend {target.displayName}
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        )}
      </div>
      <BadgeModeration />
    </main>
  );
}
