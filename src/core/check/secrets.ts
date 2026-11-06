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
 * Secrets found by what they look like. Every row needs a minimum tail after its prefix, and the prefixes start at a word
 * boundary, so ordinary words never match: "risk-free", "task-based" and "desk-top" have no boundary before their "sk-",
 * and "sk-learn" is far too short to be a key. None of these has the `g` flag, so `exec` keeps no state.
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
];

// Secrets found by what they are called: `password=hunter2`, `client_secret=…`, `db.password = '…'`, `"apiKey": "…"`,
// `Token: 4f9a-11ee`. A name that says what it holds, a sign, and a value that is long enough (and, after a colon, that
// looks like a credential). Plain words around them stay prose: "reset your password", "secret sauce", "token-based auth",
// "the token: we refresh it daily".

/** What a name has to hold. `api` and `key` side by side count too (api_key, api-key, apiKey, X-API-Key). */
const SECRET_WORDS = ['password', 'passwd', 'pwd', 'secret', 'token', 'apikey'] as const;

/** The words of a name: "clientSecret", "CLIENT_SECRET", "client.secret" and "client-secret" are all client, secret. */
function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // accessToken → access Token
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // APIKey → API Key
    .replace(/([A-Za-z])([0-9])/g, '$1 $2') // password1 → password 1
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

/**
 * A name holds a secret when one of its words is, or ends in, a secret word ("secret", "client_secret", "PGPASSWORD",
 * "db.password", "password_hash") or its words are api, key. Words that merely start with one are not: "max_tokens",
 * "tokenizer" and "secretary" are not secrets.
 */
function isSecretName(name: string): boolean {
  const words = nameWords(name);
  return words.some((word, i) => SECRET_WORDS.some((secret) => word.endsWith(secret)) || (word === 'api' && words[i + 1] === 'key'));
}

/**
 * A name (bare, or in quotes like a JSON key), a sign (= or :) and the spaces after it, on one line. A bare name starts
 * where a run of name characters starts, so a long run is tried once and the search stays linear.
 * Groups: 1 the quote, 2 the quoted name, 3 the bare name, 4 the sign.
 */
const NAME_AND_SIGN = /(?:(["'`])([\w.-]+)\1|(?<![\w.-])([\w.-]+))[^\S\r\n]*([=:])[^\S\r\n]*/g;

/**
 * A value without quotes or spaces. It is read up to 4 096 characters (no credential is longer, and a text over 2 000
 * characters cannot be sent anyway), so a long run of `token:token:…` is not read again from every name inside it.
 */
const BARE_VALUE = /[^\s"'`]{1,4096}/y;

/** What closes a sentence or a bracket after a value is not part of it: "password: hunter2." */
const SENTENCE_END = /[.,;:)\]}>]+$/;

/** What makes a value after a colon look like a credential, next to its length: a digit or one of these symbols. */
const CREDENTIAL_CHAR = /[0-9!@#$%^&*_\-./+=]/;

/** The next `quote` on this line, or -1. */
function closingQuote(text: string, quote: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === quote) return i;
    if (c === '\n' || c === '\r') return -1;
  }
  return -1;
}

/**
 * The value that starts at `from`: a string in quotes on this line, or what runs up to a space or a quote. `text` is what
 * was read (to judge it), `end` is where the passage ends. A line break first means there is no value.
 * `before` is the character just before the name: a quote right after the sign that is the same as the one the name was
 * written in closes it ('password=') and does not open a value.
 */
function readValue(text: string, from: number, before: string | undefined): { text: string; end: number } | null {
  const first = text[from];
  if (first === undefined || first === '\n' || first === '\r') return null;
  let start = from;
  if (first === '"' || first === "'") {
    if (first === before) return null;
    const close = closingQuote(text, first, from + 1);
    if (close >= 0) return { text: text.slice(from + 1, close), end: close + 1 };
    start = from + 1; // never closed on this line: read what follows the quote
  }
  BARE_VALUE.lastIndex = start;
  const run = BARE_VALUE.exec(text)?.[0].replace(SENTENCE_END, '');
  return run ? { text: run, end: start + run.length } : null;
}

/** After `=`, 4 characters (spaces apart) are enough. After `:`, which prose uses a lot, the value has to look like a credential. */
function looksLikeValue(value: string, sign: string): boolean {
  if (sign === '=') return value.replace(/\s/g, '').length >= 4;
  const trimmed = value.trim();
  return trimmed.length >= 6 && CREDENTIAL_CHAR.test(trimmed);
}

/** The first name and value in the text that qualify. A name that does not, or a value that is too short, does not stop the search. */
function findNamedValue(text: string): FoundSecret | null {
  for (const match of text.matchAll(NAME_AND_SIGN)) {
    if (!isSecretName(match[2] ?? match[3] ?? '')) continue;
    const value = readValue(text, match.index + match[0].length, text[match.index - 1]);
    if (value && looksLikeValue(value.text, match[4]!)) return { kind: 'password', start: match.index, end: value.end };
  }
  return null;
}

/** The first secret by position (the earliest `start` wins, whatever its row), or null. */
export function findSecret(text: string): FoundSecret | null {
  let found: FoundSecret | null = findNamedValue(text);
  for (const { kind, pattern } of PATTERNS) {
    const match = pattern.exec(text);
    if (match && (found === null || match.index < found.start)) {
      found = { kind, start: match.index, end: match.index + match[0].length };
    }
  }
  return found;
}
