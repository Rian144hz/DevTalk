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
    const span = correction.category === 'off_task' ? null : locate(text, correction.original, cursor, found);
    if (!span) {
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

const WORD = /[\p{L}\p{N}_']/u;

/**
 * Finds `original` as whole words (an edit of "a" must not land inside "have"), skipping spans
 * already taken. Prefers matches after the previous edit, then anywhere; exact case first.
 */
function locate(
  text: string,
  original: string,
  from: number,
  taken: { start: number; end: number }[],
): { start: number; end: number } | null {
  if (!original.trim() || original.length >= text.length * WHOLE_ANSWER_RATIO) return null;
  const boundedStart = WORD.test(original[0]!);
  const boundedEnd = WORD.test(original[original.length - 1]!);
  const ok = (start: number) => {
    const end = start + original.length;
    if (boundedStart && start > 0 && WORD.test(text[start - 1]!)) return false;
    if (boundedEnd && end < text.length && WORD.test(text[end]!)) return false;
    return !taken.some((t) => start < t.end && t.start < end);
  };
  for (const [hay, needle] of [[text, original], [text.toLowerCase(), original.toLowerCase()]] as const) {
    for (const begin of [from, 0]) {
      for (let i = hay.indexOf(needle, begin); i >= 0; i = hay.indexOf(needle, i + 1)) {
        if (ok(i)) return { start: i, end: i + original.length };
      }
    }
  }
  return null;
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
