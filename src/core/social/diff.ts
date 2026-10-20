// Word-level diffs for chat corrections: what a correction removed and added, shown with the galley's marks.

export interface DiffPart {
  kind: 'same' | 'del' | 'ins';
  text: string;
}

const tokens = (s: string) => s.match(/\s+|[^\s]+/g) ?? [];

/** The edits that turn `before` into `after`, word by word (spaces and newlines count as tokens). */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokens(before);
  const b = tokens(after);
  const w = b.length + 1;
  // lcs[i * w + j]: longest common run of a[i..] and b[j..]. Messages are at most 2 000 characters.
  const lcs = new Uint16Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    }
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = parts.at(-1);
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push('same', a[i]!);
      i++;
      j++;
    } else if (j >= b.length || (i < a.length && lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!)) {
      push('del', a[i++]!);
    } else {
      push('ins', b[j++]!);
    }
  }
  return parts;
}

/** The text with each correction's original replaced once, in order; corrections not found are skipped. */
export function applyCorrections(text: string, corrections: { original: string; corrected: string }[]): string {
  let out = text;
  let cursor = 0;
  for (const { original, corrected } of corrections) {
    if (!original) continue;
    let at = out.indexOf(original, cursor);
    if (at < 0) at = out.indexOf(original);
    if (at < 0) continue;
    out = out.slice(0, at) + corrected + out.slice(at + original.length);
    cursor = at + corrected.length;
  }
  return out;
}
