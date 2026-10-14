import { STACK_ALIASES, STACK_ALIAS_LABELS, STACK_ICONS } from './stack-icons.generated';

export interface StackIcon {
  /** The logo's own name (Simple Icons title). */
  title: string;
  path: string;
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

/** Display names offered while typing a stack tag. */
export const KNOWN_STACKS: string[] = [
  ...new Set([...Object.values(STACK_ICONS).map((i) => i.title), ...Object.values(STACK_ALIAS_LABELS)]),
].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
