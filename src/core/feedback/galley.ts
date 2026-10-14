import type { MistakeCategory } from '../domain/categories';
import { splitSentences } from '../domain/text';

export type GalleySegment = { kind: 'text' | 'del' | 'ins'; text: string } | { kind: 'mark'; n: number };
export interface GalleyNote {
  /** Mark number in the text, or null for a note about the whole answer. */
  n: number | null;
  category: MistakeCategory;
  explanation: string;
}
export interface Galley {
  rows: { segments: GalleySegment[]; notes: GalleyNote[] }[];
  general: GalleyNote[];
}

interface Correction {
  original: string;
  corrected: string;
  explanation: string;
  category: MistakeCategory;
}
interface Located {
  start: number;
  end: number;
  correction: Correction;
  n: number;
}

/** Edits that cover most of the answer are about the whole answer, not a phrase in it. */
const WHOLE_ANSWER_RATIO = 0.8;

/**
 * Lays the learner's text out as galley rows (one per sentence) with each coach edit marked
 * where it happened. Edits that cannot be pinned to one place become general notes.
 */
export function buildGalley(text: string, corrections: Correction[]): Galley {
  const general: GalleyNote[] = [];
  const found: Omit<Located, 'n'>[] = [];
  let cursor = 0;

  for (const correction of corrections) {
    const span = correction.category === 'off_task' ? null : locate(text, correction.original, cursor);
    if (!span || found.some((f) => span.start < f.end && f.start < span.end)) {
      general.push({ n: null, category: correction.category, explanation: correction.explanation });
      continue;
    }
    found.push({ ...span, correction });
    cursor = span.end;
  }

  const located: Located[] = found.sort((a, b) => a.start - b.start).map((f, i) => ({ ...f, n: i + 1 }));
  const rows = mergeCrossedSentences(splitSentences(text), located);

  return {
    general,
    rows: rows.map((row) => {
      const inRow = located.filter((l) => l.start >= row.start && l.start < row.end);
      const segments: GalleySegment[] = [];
      let at = row.start;
      for (const l of inRow) {
        if (l.start > at) segments.push({ kind: 'text', text: text.slice(at, l.start) });
        segments.push({ kind: 'del', text: text.slice(l.start, l.end) });
        if (l.correction.corrected) segments.push({ kind: 'ins', text: l.correction.corrected });
        segments.push({ kind: 'mark', n: l.n });
        at = l.end;
      }
      if (at < row.end) segments.push({ kind: 'text', text: text.slice(at, row.end) });
      return {
        segments,
        notes: inRow.map((l) => ({ n: l.n, category: l.correction.category, explanation: l.correction.explanation })),
      };
    }),
  };
}

function locate(text: string, original: string, from: number): { start: number; end: number } | null {
  if (!original.trim() || original.length >= text.length * WHOLE_ANSWER_RATIO) return null;
  const lower = text.toLowerCase();
  const needle = original.toLowerCase();
  const candidates = [text.indexOf(original, from), text.indexOf(original), lower.indexOf(needle, from), lower.indexOf(needle)];
  const start = candidates.find((i) => i >= 0);
  return start === undefined ? null : { start, end: start + original.length };
}

/** Sentences joined by an edit that crosses their boundary become one row. */
function mergeCrossedSentences(sentences: { start: number; end: number }[], located: Located[]) {
  const rows = sentences.map((s) => ({ ...s }));
  for (const l of located) {
    const hit = rows.filter((r) => r.start < l.end && l.start < r.end);
    if (hit.length > 1) {
      const merged = { start: hit[0]!.start, end: hit[hit.length - 1]!.end };
      rows.splice(rows.indexOf(hit[0]!), hit.length, merged);
    }
  }
  return rows;
}
