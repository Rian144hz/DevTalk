import { findSecret, SECRET_MESSAGE } from '../../src/core/check/secrets';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
/** `n` letters and digits, always the same ones. */
const fill = (n: number) => Array.from({ length: n }, (_, i) => ALPHABET[(i * 7 + 3) % ALPHABET.length]).join('');

/** One sample of every shape the spec lists, as a person might paste it. */
const SAMPLES: [name: string, secret: string][] = [
  ['an sk- key', `sk-${fill(24)}`],
  ['an Anthropic key', `sk-ant-api03-${fill(40)}`],
  ['a Google API key', `AIza${fill(35)}`],
  ['a GitHub personal token', `ghp_${fill(36)}`],
  ['a GitHub OAuth token', `gho_${fill(36)}`],
  ['a GitHub fine-grained token', `github_pat_${fill(30)}`],
  ['a Slack token', 'xoxb-1234567890-abcdefghij'],
  ['an AWS access key', 'AKIAABCDEFGHIJKLMNOP'],
  ['a private key header', '-----BEGIN RSA PRIVATE KEY-----'],
  ['a Supabase secret key', `sb_secret_${fill(24)}`],
  ['a JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'],
  ['a password', 'password=hunter2'],
  ['a quoted passwd', "PASSWD = 'hunter2'"],
  ['a secret', 'secret=abc123'],
  ['a token', 'token=ghr7k2'],
];

test('the message is the one the spec gives', () => {
  expect(SECRET_MESSAGE).toBe('This looks like a password or key. Remove it before you check the text.');
});

describe('finds every key shape the spec lists', () => {
  test.each(SAMPLES)('%s', (_name, secret) => {
    const text = `Here it is: ${secret} and then some more words.`;
    const found = findSecret(text);
    expect(found).not.toBeNull();
    expect(found!.kind).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(text.slice(found!.start, found!.end)).toBe(secret);
    // On its own, the whole text is the secret.
    expect(findSecret(secret)).toMatchObject({ start: 0, end: secret.length });
  });

  test('the assignment words match in any case', () => {
    for (const secret of ['Password=hunter2', 'TOKEN=abc123', 'Secret = "abc123"', 'PASSWD=hunter2']) {
      const text = `Use ${secret} here`;
      const found = findSecret(text);
      expect(text.slice(found!.start, found!.end), secret).toBe(secret);
    }
  });
});

test('finds a key at the end of the text, in quotes, in parentheses and on the second line', () => {
  const key = `sk-ant-api03-${fill(40)}`;
  const aws = 'AKIAABCDEFGHIJKLMNOP';
  const cases: [string, string][] = [
    [`My key is ${key}`, key],
    [`const key = "${key}";`, key],
    [`const key = '${key}'`, key],
    [`(${key})`, key],
    [`(see ${aws}),`, aws],
    [`First line.\nSecond line with ${key}`, key],
    [`First line.\r\nSecond line with ${aws}.`, aws],
    [`Use ${key} here.`, key],
  ];
  for (const [text, secret] of cases) {
    const found = findSecret(text);
    expect(found, text).not.toBeNull();
    expect(text.slice(found!.start, found!.end), text).toBe(secret);
  }
  // At the very end, the passage ends where the text ends.
  expect(findSecret(`My key is ${key}`)!.end).toBe(`My key is ${key}`.length);
});

test('returns the earlier of two secrets', () => {
  const github = `ghp_${fill(36)}`;
  const openai = `sk-${fill(24)}`;
  // sk- is the first row of the table, so the position, not the table, must decide.
  for (const [text, first] of [
    [`${github} and later ${openai}`, github],
    [`${openai} and later ${github}`, openai],
    [`token=abc123 and later ${openai}`, 'token=abc123'],
    [`${openai} and later token=abc123`, openai],
  ] as const) {
    const found = findSecret(text)!;
    expect(text.slice(found.start, found.end), text).toBe(first);
  }
});

test('lets ordinary prose through', () => {
  for (const text of [
    'A risk-free, task-based plan for the desk-top and disk-bound jobs.',
    'Reset your password and rotate the token before Friday.',
    'Set password= the way the docs say.',
    'Use `token=` in the URL.',
    'My sk-learn notes.',
    'ghp_ is the prefix of a GitHub token.',
  ]) {
    expect(findSecret(text), text).toBeNull();
  }
});

test('lets longer ordinary text through too', () => {
  const email = [
    'Hello Maya,',
    '',
    'I fixed the flaky payments test. The cause was a shared database row, so I gave each test its own fixture.',
    'Could you review the pull request (https://example.com/acme/payments/pull/412) before Friday? The task-based',
    'plan is in the ticket, and the risk-free option is to ship it behind a flag. Please do not share the password',
    'or the API token in the channel; ask me and I will send a one-time link.',
    '',
    'Kind regards,',
    'Rian',
  ].join('\n');
  expect(findSecret(email)).toBeNull();
  expect(findSecret('')).toBeNull();
});

test('a short look-alike is not a key', () => {
  for (const text of ['sk-abc', 'AKIA123', 'eyJhbGci.x.y', 'password=ab']) {
    expect(findSecret(text), text).toBeNull();
  }
});
