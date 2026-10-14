import { useState } from 'react';
import { Button } from './Button';

/** Blocks a person after an inline confirmation. `onBlock` resolves to an error message, or null. */
export function BlockButton({ name, onBlock }: { name: string; onBlock(): Promise<string | null> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) return <p className="block-done" role="status">You blocked {name}. You will not see each other in DevTalk.</p>;
  if (!confirming) return <Button variant="secondary" onClick={() => setConfirming(true)}>Block {name}</Button>;

  async function block() {
    setBusy(true);
    setError(null);
    const failure = await onBlock();
    setBusy(false);
    if (failure) setError(failure);
    else setDone(true);
  }

  return (
    <div className="block-confirm" role="group" aria-label={`Block ${name}`}>
      <p>Block {name}? You will stop seeing each other in DevTalk, and {name} cannot contact you.</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="block-actions">
        <Button variant="secondary" onClick={block} busy={busy} autoFocus>Block</Button>
        <Button variant="quiet" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}
