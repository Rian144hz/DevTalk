import { useCallback, useEffect, useId, useState } from 'react';
import type { SocialStatus } from '../../shared/ipc-contract';
import { Button, Notice, TextField } from '../design-system';
import { AppErrorException, api, unwrap } from '../lib/api';
import { setReturnTo } from '../lib/returnTo';
import { LEGAL_TITLES, type LegalDoc } from './LegalScreen';

const message = (e: unknown) => (e instanceof AppErrorException ? e.message : 'Something went wrong. Try again.');

/** Settings › Account: who you are signed in as, sign out, export and delete. */
export function AccountSection() {
  const ids = { includeLocal: useId(), deleteLocal: useId() };
  const [status, setStatus] = useState<SocialStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [includeLocal, setIncludeLocal] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleteLocal, setDeleteLocal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setStatus(unwrap(await api().social.status()));
    } catch (e) {
      setLoadError(message(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function signOut() {
    setStatus(unwrap(await api().social.signOut()));
    setDeleted(false);
  }

  async function exportData() {
    setExporting(true);
    setExportMsg(null);
    setExportError(null);
    try {
      const r = unwrap(await api().social.exportData(includeLocal));
      if (r.saved && r.path) setExportMsg(`Saved to ${r.path}`);
    } catch (e) {
      setExportError(message(e));
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    try {
      unwrap(await api().social.deleteAccount({ confirmEmail: typed, deleteLocal }));
      setConfirming(false);
      setTyped('');
      setDeleted(true);
      await load();
    } catch (e) {
      setDeleteError(message(e));
    } finally {
      setDeleting(false);
    }
  }

  const docs = (
    <p className="small account-docs">
      {(['terms', 'privacy', 'conduct'] as LegalDoc[]).map((d) => (
        <a key={d} href={`#/legal/${d}`} onClick={() => setReturnTo('#/settings', 'Back to Settings')}>{LEGAL_TITLES[d]}</a>
      ))}
    </p>
  );

  let body: React.ReactNode;
  if (loadError) {
    body = <Notice tone="error" title={loadError} action={<Button variant="secondary" onClick={() => void load()}>Try again</Button>} />;
  } else if (!status) {
    body = <p className="muted">Loading…</p>;
  } else if (!status.configured) {
    body = <p className="muted">Community is not set up in this build. Your practice works as usual.</p>;
  } else if (!status.signedIn) {
    body = (
      <>
        {deleted && <p role="status">Your community account was deleted.</p>}
        <p className="muted">You are not in the community. Your practice works without an account.</p>
        <div className="settings-actions">
          <Button variant="secondary" onClick={() => { window.location.hash = '#/join'; }}>Join the community</Button>
        </div>
      </>
    );
  } else {
    const email = status.email ?? '';
    const matches = typed.trim().toLowerCase() === email.toLowerCase() && email !== '';
    body = (
      <>
        <div className="account-who">
          <p>Signed in as <strong>{email}</strong></p>
          <Button variant="quiet" onClick={() => void signOut()}>Sign out</Button>
        </div>

        <div className="account-block">
          <h3>Your data</h3>
          <p className="muted">Download your community data (profile, accepted documents, blocks, reports you sent, notices) as a JSON file.</p>
          <label className="check-row" htmlFor={ids.includeLocal}>
            <input id={ids.includeLocal} type="checkbox" checked={includeLocal} onChange={(e) => setIncludeLocal(e.target.checked)} />
            <span>Include my practice history</span>
          </label>
          <div className="settings-actions">
            <Button variant="secondary" busy={exporting} onClick={() => void exportData()}>Export my data</Button>
            {exportMsg && <span className="small muted" role="status">{exportMsg}</span>}
          </div>
          {exportError && <Notice tone="error" title={exportError} />}
        </div>

        <div className="account-block">
          <h3>Delete my account</h3>
          <p className="muted">This removes your profile, photo and community data from the server. It cannot be undone.</p>
          {!confirming ? (
            <div className="settings-actions">
              <Button variant="secondary" onClick={() => setConfirming(true)}>Delete my account…</Button>
            </div>
          ) : (
            <div className="delete-confirm">
              <TextField label="Type your e-mail to confirm" value={typed} onChange={(e) => setTyped(e.target.value)}
                autoComplete="off" spellCheck={false} hint={email} autoFocus />
              <label className="check-row" htmlFor={ids.deleteLocal}>
                <input id={ids.deleteLocal} type="checkbox" checked={deleteLocal} onChange={(e) => setDeleteLocal(e.target.checked)} />
                <span>Also delete my practice data on this computer (the app restarts)</span>
              </label>
              {deleteError && <Notice tone="error" title={deleteError} />}
              <div className="settings-actions">
                <Button variant="quiet" disabled={deleting} onClick={() => { setConfirming(false); setTyped(''); setDeleteError(null); }}>Cancel</Button>
                <Button variant="secondary" className="btn-destructive" busy={deleting} disabled={!matches} onClick={() => void deleteAccount()}>
                  Delete my account
                </Button>
              </div>
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <section aria-labelledby="set-account">
      <h2 id="set-account">Account</h2>
      {body}
      {docs}
    </section>
  );
}
