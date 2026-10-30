import { ensureContrast } from './colour';
import { STACK_ALIASES, STACK_ALIAS_LABELS, STACK_ICONS } from './stack-icons.generated';

export interface StackIcon {
  /** The logo's own name (Simple Icons title). */
  title: string;
  path: string;
  /** Brand colour (RRGGBB) or null for black and grey brands. */
  hex: string | null;
  /** What the profile shows: the technology the person means. */
  label: string;
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

const LOOKUP = new Map<string, string>();
for (const [slug, icon] of Object.entries(STACK_ICONS)) {
  LOOKUP.set(slug, slug);
  LOOKUP.set(norm(icon.title), slug);
}
for (const [alias, slug] of Object.entries(STACK_ALIASES)) LOOKUP.set(norm(alias), slug);

/** The logo for a stack tag (by name, slug or common alias), or null when there is none. */
export function stackIconFor(tag: string): StackIcon | null {
  const key = norm(tag);
  const slug = LOOKUP.get(key);
  const icon = slug ? STACK_ICONS[slug] : undefined;
  return icon ? { ...icon, label: STACK_ALIAS_LABELS[key] ?? icon.title } : null;
}

/** Only technologies with a known logo can be a main technology (a badge), so a tag like "moderator" cannot pose as one. */
export const canBeMain = (tag: string): boolean => stackIconFor(tag) !== null;

/** Display names offered while typing a stack tag. */
export const KNOWN_STACKS: string[] = [
  ...new Set([...Object.values(STACK_ICONS).map((i) => i.title), ...Object.values(STACK_ALIAS_LABELS)]),
].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));

/** The grounds a badge sits on in each theme (--bg and --sheet in tokens.css). */
export const THEME_GROUNDS = { dark: ['#0f1726', '#162033'], light: ['#f5f9ff', '#ffffff'] } as const;
/** --ink-2 in each theme: badges without a brand colour. */
const NEUTRAL = { dark: '#AFC0D8', light: '#3A5274' } as const;

/** The brand colour of a stack tag, adjusted to read at 3:1 on both grounds of the theme; neutral when it has none. */
export function languageColour(tag: string, theme: 'dark' | 'light'): string {
  const hex = stackIconFor(tag)?.hex;
  if (!hex) return NEUTRAL[theme];
  // Adjusting against the harder ground first also satisfies the easier one (the mix only moves away from both).
  const [a, b] = THEME_GROUNDS[theme];
  const hardest = theme === 'dark' ? b : a;
  const easiest = theme === 'dark' ? a : b;
  return ensureContrast(ensureContrast(`#${hex}`, hardest), easiest);
}
