import { useCallback, useEffect, useState } from 'react';
import type { ModerationDecision, ModerationReport, ReportContext } from '../../core/social/types';
import type { ModerationHistoryEntry } from '../../shared/ipc-contract';
import { Avatar, Button, EmptyState, Notice, REPORT_REASON_LABELS, Segmented, Skeleton, TextArea, TextField } from '../design-system';
import { AppErrorException, api, unwrap } from '../lib/api';
import { formatLongDate } from '../lib/format';

const message = (e: unknown) => (e instanceof AppErrorException ? e.message : 'Something went wrong. Try again.');

const CONTEXT_LABELS: Record<ReportContext, string> = { profile: 'Profile', message: 'Chat message', room: 'Voice room' };
type Length = '1' | '7' | '30' | 'permanent';
const LENGTHS: { value: Length; label: string }[] = [
  { value: '1', label: '1 day' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: 'permanent', label: 'Permanent' },
];

function describe(entry: ModerationHistoryEntry): string {
  if (entry.action === 'warn') return 'Warned';
  if (entry.action === 'unsuspend') return 'Suspension lifted';
  if (entry.until === 'infinity') return 'Suspended permanently';
  return `Suspended until ${entry.until ? formatLongDate(entry.until) : 'a later date'}`;
}

function isSuspended(history: ModerationHistoryEntry[]): boolean {
  const last = history[0];
  if (!last || last.action !== 'suspend') return false;
  return last.until === 'infinity' || (!!last.until && Date.parse(last.until) > Date.now());
}

export function ModerationScreen() {
  const [reports, setReports] = useState<ModerationReport[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ModerationReport | null>(null);
  const [history, setHistory] = useState<ModerationHistoryEntry[] | null>(null);
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

  const loadHistory = useCallback(async (userId: string) => {
    setHistory(null);
    try {
      setHistory(unwrap(await api().moderation.history(userId)));
    } catch (e) {
      setActionError(message(e));
    }
  }, []);

  function select(r: ModerationReport) {
    setSelected(r);
    setSaved(false);
    setActionError(null);
    setWarnText('');
    setReason('');
    setLength('7');
    if (r.reported) void loadHistory(r.reported.id);
    else setHistory([]);
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
                        <span className="history-what">{describe(h)}</span>
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
    </main>
  );
}
