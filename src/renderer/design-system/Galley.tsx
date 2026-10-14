import type { ReactNode } from 'react';
import { MISTAKE_LABELS } from '../../core/domain/categories';
import type { Galley as GalleyModel, GalleyNote, GalleySegment } from '../../core/feedback/galley';

function Segment({ s }: { s: GalleySegment }) {
  switch (s.kind) {
    case 'text':
      return <>{s.text}</>;
    case 'del':
      return <del><span className="visually-hidden">removed: </span>{s.text}</del>;
    case 'ins':
      return <> <ins><span className="visually-hidden">added: </span>{s.text}</ins></>;
    case 'mark':
      return <span className="mark-n" aria-label={`edit ${s.n}`}>{s.n}</span>;
  }
}

function Note({ note }: { note: GalleyNote }) {
  return (
    <p>
      <span className="note-label">
        {note.n !== null && <><span className="mark-n" aria-hidden="true">{note.n}</span><span className="visually-hidden">Edit {note.n}, </span></>}
        {MISTAKE_LABELS[note.category]}
      </span>
      {note.explanation}
    </p>
  );
}

/** The learner's text marked like a proof: edits inline, notes in the margin beside their line. */
export function Galley({ galley, title, meta, head, marked = true }: {
  galley: GalleyModel;
  title: string;
  meta?: ReactNode;
  head?: ReactNode;
  /** False while the coach has not answered yet: the margin stays empty. */
  marked?: boolean;
}) {
  return (
    <article className="galley" aria-label={title}>
      {head ?? (
        <div className="galley-head">
          <h2>{title}</h2>
          {meta && <span className="muted small">{meta}</span>}
        </div>
      )}
      {galley.general.length > 0 && (
        <div className="galley-general">
          <h3>About the whole answer</h3>
          <ul>{galley.general.map((n, i) => <li key={i}><Note note={n} /></li>)}</ul>
        </div>
      )}
      <div className="galley-rows">
        {galley.rows.map((row, i) => (
          <div className="line" key={i}>
            <p className="line-text">{row.segments.map((s, j) => <Segment key={j} s={s} />)}</p>
            <div className="line-notes">
              {row.notes.length ? row.notes.map((n) => <Note key={n.n} note={n} />) : marked && <span className="muted">No edits.</span>}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
