import { useId, useState } from 'react';
import { CHAT_TEXT_MAX, chatText } from '../../core/social/chat';
import { wordDiff } from '../../core/social/diff';
import { Button } from '../design-system';

/** Their text with what a correction removes and adds, in the galley's diff marks. */
export function DiffText({ before, after }: { before: string; after: string }) {
  return (
    <p className="chat-diff">
      {wordDiff(before, after).map((p, i) => {
        if (p.kind === 'same') return <span key={i}>{p.text}</span>;
        // The mark covers the words only; a trailing space stays plain so a removal does not look like a dash.
        const word = p.text.trimEnd();
        const space = p.text.slice(word.length);
        return (
          <span key={i}>
            {p.kind === 'del'
              ? <del><span className="visually-hidden">removed: </span>{word}</del>
              : <ins><span className="visually-hidden">added: </span>{word}</ins>}
            {space}
          </span>
        );
      })}
    </p>
  );
}

/** Edit someone's message the way you would write it; the diff shows what changes before you suggest it. */
export function CorrectionEditor({ original, name, onSubmit, onCancel }: {
  original: string;
  name: string;
  /** Resolves to an error message, or null when the correction was saved. */
  onSubmit(corrected: string): Promise<string | null>;
  onCancel(): void;
}) {
  const id = useId();
  const [text, setText] = useState(original);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const corrected = chatText(text);
  const changed = corrected !== null && corrected !== original.trim();

  async function submit() {
    if (!corrected || !changed || busy) return;
    setBusy(true);
    setError(null);
    const failure = await onSubmit(corrected);
    setBusy(false);
    if (failure) setError(failure);
  }

  return (
    <div className="chat-editor">
      <label className="visually-hidden" htmlFor={id}>Correction of {name}'s message</label>
      <textarea id={id} className="textarea chat-input" rows={2} value={text} maxLength={CHAT_TEXT_MAX * 2} autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }} />
      {changed && <DiffText before={original} after={corrected} />}
      <div className="row-actions">
        <Button variant="secondary" busy={busy} disabled={!changed} onClick={() => void submit()}>Suggest</Button>
        <Button variant="quiet" onClick={onCancel}>Cancel</Button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}
