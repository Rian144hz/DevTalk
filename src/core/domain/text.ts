const EDGE_PUNCTUATION = /^[\s"'“”‘’.,;:!?()[\]{}]+|[\s"'“”‘’.,;:!?()[\]{}]+$/g;

/** Canonical form used to detect the same expression written differently. */
export function normalizeExpression(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').replace(EDGE_PUNCTUATION, '');
}

const ABBREVIATIONS = ['e.g.', 'i.e.', 'etc.', 'vs.'];

/** Same length as the input, with dots that do not end a sentence replaced. */
function maskNonTerminalDots(text: string): string {
  let masked = text;
  for (const abbr of ABBREVIATIONS) masked = masked.split(abbr).join(abbr.replace(/\./g, '_'));
  return masked.replace(/(\d)\.(\d)/g, '$1_$2');
}

/** Rough sentence count for the "3 to 5 sentences" hint; not linguistically exact. */
export function countSentences(text: string): number {
  return splitSentences(text).length;
}

/**
 * Sentence spans that together cover the whole text (each span keeps its trailing spaces),
 * so concatenating them reproduces the input. Whitespace-only text has no sentences.
 */
export function splitSentences(text: string): { start: number; end: number }[] {
  if (!text.trim()) return [];
  const masked = maskNonTerminalDots(text);
  const spans: { start: number; end: number }[] = [];
  let start = 0;
  for (const m of masked.matchAll(/[.!?]+(?:\s+|$)/g)) {
    const end = m.index + m[0].length;
    if (text.slice(start, end).trim()) spans.push({ start, end });
    else if (spans.length) spans[spans.length - 1]!.end = end;
    start = end;
  }
  if (start < text.length) {
    if (text.slice(start).trim()) spans.push({ start, end: text.length });
    else if (spans.length) spans[spans.length - 1]!.end = text.length;
  }
  return spans;
}
