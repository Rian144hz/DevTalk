import { useEffect, useId, useRef, useState } from 'react';
import { filterCommands, type Command } from '../lib/commands';
import { Kbd } from '../design-system';

/** Ctrl+K palette. Opens and closes instantly: it is used too often to animate. */
export function CommandPalette({ open, onClose, commands }: { open: boolean; onClose(): void; commands: Command[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const titleId = useId();
  const results = filterCommands(commands, query);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQuery('');
      setActive(0);
      d.showModal();
      input.current?.focus();
    } else if (!open && d.open) {
      d.close();
      opener.current?.focus();
    }
  }, [open]);

  const runAt = (i: number) => {
    const c = results[i];
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <dialog ref={dialog} className="palette" aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === dialog.current) onClose(); }}>
      <h2 id={titleId} className="visually-hidden">Search or jump to</h2>
      <input ref={input} className="palette-input" role="combobox" aria-expanded="true" aria-controls={listId}
        aria-activedescendant={results[active] ? `${listId}-${active}` : undefined} aria-label="Search or jump to"
        placeholder="Type a command or a screen" value={query}
        onChange={(e) => { setQuery(e.target.value); setActive(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); runAt(active); }
        }} />
      <ul className="palette-list" role="listbox" id={listId} aria-label="Commands">
        {results.map((c, i) => (
          <li key={c.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
            onMouseMove={() => setActive(i)} onClick={() => runAt(i)}>
            <span>{c.label}</span>
            {c.shortcut && <Kbd>{c.shortcut}</Kbd>}
          </li>
        ))}
        {results.length === 0 && <li className="palette-empty" role="option" aria-selected={false} aria-disabled="true">No matching command</li>}
      </ul>
    </dialog>
  );
}
