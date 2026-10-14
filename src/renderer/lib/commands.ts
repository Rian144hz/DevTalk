export interface Command {
  id: string;
  label: string;
  keywords: string[];
  shortcut?: string;
  run(): void;
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}

/** 0: label starts with the query; 1: a word does; 2: a keyword does; 3: word initials ("gtp"); -1: no match. */
function rank(c: Command, q: string): number {
  const label = c.label.toLowerCase();
  if (label.startsWith(q)) return 0;
  if (label.split(/\s+/).some((w) => w.startsWith(q))) return 1;
  if (c.keywords.some((k) => k.toLowerCase().startsWith(q))) return 2;
  if (isSubsequence(q, label.split(/\s+/).map((w) => w[0]).join(''))) return 3;
  return -1;
}

export function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands
    .map((c, i) => ({ c, i, r: rank(c, q) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.c);
}
