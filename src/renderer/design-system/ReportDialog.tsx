import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { REPORT_REASONS, PROFILE_LIMITS, type ReportReason } from '../../core/social/types';
import { Button } from './Button';
import { TextArea } from './Field';

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  harassment: 'Harassment or bullying',
  hate: 'Hate or discrimination',
  sexual: 'Sexual content',
  spam: 'Spam or scams',
  impersonation: 'Pretending to be someone else',
  minor: 'May be under 18',
  other: 'Something else',
};

/**
 * Sends a report to the moderators. A modal on purpose: it needs protected focus while the person
 * describes what happened. `onSubmit` resolves to an error message, or null when the report was sent.
 */
export function ReportDialog({
  open,
  targetName,
  onSubmit,
  onClose,
}: {
  open: boolean;
  targetName: string;
  onSubmit(input: { reason: ReportReason; details: string }): Promise<string | null>;
  onClose(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      setReason(null);
      setDetails('');
      setError(null);
      setSent(false);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleClose = () => {
    if (opener.current instanceof HTMLElement) opener.current.focus();
    onClose();
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason || busy) return;
    setBusy(true);
    setError(null);
    const failure = await onSubmit({ reason, details: details.trim() });
    setBusy(false);
    if (failure) setError(failure);
    else setSent(true);
  }

  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onClose={handleClose}>
      {sent ? (
        <div className="dialog-body" role="status">
          <h2 id={titleId}>Report sent</h2>
          <p className="dialog-lede">Thank you. A moderator will look at it. {targetName} is not told who reported them.</p>
          <div className="dialog-actions">
            <Button variant="primary" onClick={() => ref.current?.close()} autoFocus>Close</Button>
          </div>
        </div>
      ) : (
        <form className="dialog-body" onSubmit={submit}>
          <h2 id={titleId}>Report {targetName}</h2>
          <p className="dialog-lede">Reports go to the moderators. {targetName} is not told who reported them.</p>
          <fieldset className="radio-list">
            <legend className="field-label">What is happening?</legend>
            {REPORT_REASONS.map((r) => (
              <label key={r} className="radio-row">
                <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
                <span>{REPORT_REASON_LABELS[r]}</span>
              </label>
            ))}
          </fieldset>
          <TextArea
            label="Details (optional)"
            className="textarea-short"
            rows={4}
            maxLength={PROFILE_LIMITS.reportDetails}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            hint={`What happened, and where. ${details.length} of ${PROFILE_LIMITS.reportDetails} characters.`}
          />
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <Button variant="quiet" onClick={() => ref.current?.close()}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={!reason} busy={busy}>Send report</Button>
          </div>
        </form>
      )}
    </dialog>
  );
}
