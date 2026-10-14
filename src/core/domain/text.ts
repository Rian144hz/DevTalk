const EDGE_PUNCTUATION = /^[\s"'“”‘’.,;:!?()[\]{}]+|[\s"'“”‘’.,;:!?()[\]{}]+$/g;

/** Canonical form used to detect the same expression written differently. */
export function normalizeExpression(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').replace(EDGE_PUNCTUATION, '');
}

const ABBREVIATIONS = ['e.g.', 'i.e.', 'etc.', 'vs.'];

/** Rough sentence count for the "3 to 5 sentences" hint; not linguistically exact. */
export function countSentences(text: string): number {
  let masked = text.trim();
  if (!masked) return 0;
  for (const abbr of ABBREVIATIONS) masked = masked.split(abbr).join(abbr.replace(/\./g, '_'));
  masked = masked.replace(/(\d)\.(\d)/g, '$1_$2');
  return masked.split(/[.!?]+(?:\s+|$)/).filter((s) => s.trim().length > 0).length;
}
