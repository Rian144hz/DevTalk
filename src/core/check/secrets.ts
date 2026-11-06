// A local detector for passwords and keys. It runs before anything is sent, in the window (to mark the passage) and in
// the main process (so a direct call cannot skip it). Pure: no network, no storage.

export const SECRET_MESSAGE = 'This looks like a password or key. Remove it before you check the text.';

/** The first secret in a text: what it looks like, and where it is as `[start, end)` in the text. */
export interface FoundSecret {
  kind: string;
  start: number;
  end: number;
}

/**
 * Every row needs a minimum tail after its prefix, and the prefixes start at a word boundary, so ordinary words never
 * match: "risk-free", "task-based" and "desk-top" have no boundary before their "sk-", "sk-learn" is far too short to be a
 * key, and "password=" with nothing after it (or a space) is prose. None of these has the `g` flag, so `exec` keeps no state.
 */
const PATTERNS: readonly { kind: string; pattern: RegExp }[] = [
  { kind: 'secret-key', pattern: /\bsk-[\w-]{20,}/ }, // OpenAI and Anthropic (sk-ant-…)
  { kind: 'google-api-key', pattern: /\bAIza[\w-]{35}/ },
  { kind: 'github-token', pattern: /\b(?:ghp|gho)_\w{36}/ },
  { kind: 'github-token', pattern: /\bgithub_pat_\w{22,}/ },
  { kind: 'slack-token', pattern: /\bxox[abposr]-[\w-]{10,}/ },
  { kind: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}/ },
  { kind: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: 'supabase-secret-key', pattern: /\bsb_secret_[\w-]{20,}/ },
  // A JSON web token: three dot-separated parts, the first two start with `eyJ` (a base64 `{"`).
  { kind: 'jwt', pattern: /eyJ[\w-]{7,}\.eyJ[\w-]{7,}\.[\w-]{10,}/ },
  // password = 'value' (spaces allowed around the sign, the value in quotes)
  { kind: 'password', pattern: /\b(?:password|passwd|secret|token)\s*=\s*["'][^"'\s]{3,}["']/i },
  // password=value (no spaces, so "Set password= the way the docs say." is prose)
  { kind: 'password', pattern: /\b(?:password|passwd|secret|token)=[^\s"'`]{3,}/i },
];

/** The first secret by position (the earliest `start` wins, whatever its row), or null. */
export function findSecret(text: string): FoundSecret | null {
  let found: FoundSecret | null = null;
  for (const { kind, pattern } of PATTERNS) {
    const match = pattern.exec(text);
    if (match && (found === null || match.index < found.start)) {
      found = { kind, start: match.index, end: match.index + match[0].length };
    }
  }
  return found;
}
