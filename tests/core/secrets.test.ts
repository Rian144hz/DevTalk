import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { FIELD_SCAN_MAX, findSecret, findSecretInField, SECRET_MESSAGE } from '../../src/core/check/secrets';

/**
 * The detector compiled from its own source and run in a vm that stops it after a limit. The timing tests below are about
 * regular expressions that, if they backtracked, would run for minutes (the old JWT row took 28 s on 200 000 characters),
 * and a vitest timeout cannot stop synchronous code. A vm timeout can, so a regression fails in a moment and does not hang
 * the suite.
 */
const realm = (() => {
  const source = readFileSync(join(__dirname, '../../src/core/check/secrets.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } });
  const sandbox = { module: { exports: {} }, exports: {}, text: '' };
  sandbox.exports = sandbox.module.exports;
  createContext(sandbox);
  runInContext(outputText, sandbox);
  return sandbox;
})();

/** Milliseconds `findSecret` (or `findSecretInField`) takes on `text`. Throws when it is still running after `limitMs`. */
function took(name: 'findSecret' | 'findSecretInField', text: string, limitMs = 2000): number {
  realm.text = text;
  const started = performance.now();
  try {
    runInContext(`module.exports.${name}(text)`, realm, { timeout: limitMs });
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      throw new Error(`${name} was still running after ${limitMs} ms on ${text.length} characters`);
    }
    throw error;
  }
  return performance.now() - started;
}

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

// A name that says what it holds (password, passwd, pwd, secret, token, api key), a sign, and a value.
describe('a name that holds a password, a secret or a token, with its value', () => {
  /** Each passage has to be found whole, on its own and wherever it sits in a text. */
  const NAMED = [
    'client_secret=abc123xyz',
    'access_token=ya29.a0Af',
    'API_TOKEN=9f8e7d6c',
    'db.password = s3cr3t!',
    '"apiKey": "AbC123dEf456"',
    "PASSWD='x9y8z7w6'",
    'password: hunter2',
    'Token: 4f9a-11ee',
    // a name in camelCase, with hyphens, in the middle of a longer name, run together, in other cases
    'accessToken: ya29.a0Af',
    "clientSecret = 'abc12345'",
    'X-API-Key: 7f3a9c21d4',
    'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG',
    'PGPASSWORD=hunter2',
    'Client_Secret=abc123xyz',
    "Api-Key = 'abcd1234'",
    'GITHUB_TOKEN=abcd1234',
    'db_pwd=passw0rd',
    '--password=hunter2',
    // the sign with or without spaces, the value with or without quotes, a colon with no space
    'pwd=abcd',
    'secret_key = abcd',
    'password:hunter2',
    'Password = "correct horse battery staple"',
    "'token': 'abc123'",
  ];

  test.each(NAMED)('%s', (passage) => {
    const places = [
      passage,
      `${passage} and more words`,
      `Some words and then ${passage}`,
      `Here it is: ${passage} and then some more words.`,
      `First line.\n${passage}\nLast line.`,
      `First line.\r\n${passage}\r\nLast line.`,
    ];
    for (const text of places) {
      const found = findSecret(text);
      expect(found, text).not.toBeNull();
      expect(found!.kind).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(text.slice(found!.start, found!.end), text).toBe(passage);
    }
  });

  test('the passage is just the name, the sign and the value, whatever is around them', () => {
    const cases: [text: string, passage: string][] = [
      ['mysql -u root --password=hunter2 -h db', '--password=hunter2'],
      ['export DB_PASSWORD=hunter2', 'DB_PASSWORD=hunter2'],
      ['{"password":"hunter2"}', '"password":"hunter2"'],
      ['{"apiKey": "AbC123dEf456", "user": "rian"}', '"apiKey": "AbC123dEf456"'],
      ["{'token': 'abc123'}", "'token': 'abc123'"],
      ['database:\n  password: hunter2\n  host: db.internal', 'password: hunter2'],
      ["the user's password: hunter2 was reset", 'password: hunter2'],
      ['db.password = s3cr3t! and db.host = localhost', 'db.password = s3cr3t!'],
      // A full stop, a comma or a bracket that closes the sentence is not part of the value.
      ['The password: hunter2.', 'password: hunter2'],
      ['Send token=abc123xyz, then wait.', 'token=abc123xyz'],
      ['(client_secret=abc123xyz)', 'client_secret=abc123xyz'],
      ['Use "client_secret=abc123xyz" in the file', 'client_secret=abc123xyz'],
      // A name that does not qualify, or a value that is too short, does not stop the search.
      ['token = "abc" is short but token = "abcd" is not', 'token = "abcd"'],
      ['host=db1 and then secret=abc12345', 'secret=abc12345'],
    ];
    for (const [text, passage] of cases) {
      const found = findSecret(text);
      expect(found, text).not.toBeNull();
      expect(text.slice(found!.start, found!.end), text).toBe(passage);
    }
  });

  test('a token in a link is found', () => {
    const text = 'Open https://example.com/cb?token=abc123def&state=xyz now';
    const found = findSecret(text)!;
    expect(text.slice(found.start, found.end)).toMatch(/^token=abc123def/);
  });

  test('an = needs 4 characters after it, quoted or not; a line break ends the search for them', () => {
    for (const text of [
      'secret=abc', 'secret = abc', 'secret="abc"', "secret = 'abc'", 'secret=ab', 'secret=""', "secret=''", 'secret = "   "', 'token = a b',
      'secret=abc.', // 3 characters and the full stop that ends the sentence
    ]) {
      expect(findSecret(text), text).toBeNull();
    }
    for (const text of ['secret=abcd', 'secret = abcd', 'secret="abcd"', "secret = 'abcd'", 'secret = "ab cd"']) {
      expect(findSecret(text), text).not.toBeNull();
    }
    expect(findSecret('password = \nnext line')).toBeNull();
    expect(findSecret('password = \r\nnext line')).toBeNull();
    expect(findSecret('password =\n  hunter2')).toBeNull();
  });

  test('a colon needs a value that looks like a credential: 6 characters with a digit or a symbol', () => {
    for (const text of [
      'password: abcdef', 'password: hunter', 'password: abc12', 'password: ab-cd', 'password: abcde', 'Token: yesterday',
      '"token": "abcdef"', '"token": "abc12"', 'password:', 'password: ', 'password: \nhunter2',
    ]) {
      expect(findSecret(text), text).toBeNull();
    }
    for (const text of ['password: abcde1', 'password: ab-cde', 'password: abcdef!', 'Token: 123456', '"token": "abc.def"', "'token': 'abcde1'"]) {
      expect(findSecret(text), text).not.toBeNull();
    }
    // Every symbol of the list counts, in the middle of the value.
    for (const symbol of '!@#$%^&*_-./+=') expect(findSecret(`password: abc${symbol}def`), symbol).not.toBeNull();
  });

  test('every name of the list counts, in any case, with underscores, dots or hyphens around it', () => {
    for (const name of [
      'password', 'passwd', 'pwd', 'secret', 'token', 'api_key', 'apikey', 'api-key', 'apiKey', 'API_KEY', 'APIKEY',
      'PASSWORD', 'Passwd', 'PWD', 'SECRET', 'Token', 'user.password', 'user_password', 'password_hash', 'my.secret.value', 'secret.key',
      'bearerToken', 'refresh_token', 'x-auth-token', 'db-pwd', 'password1', 'jwt.secret',
    ]) {
      expect(findSecret(`${name}=abcd1234`), `${name}=`).not.toBeNull();
      expect(findSecret(`${name}: abcd1234`), `${name}:`).not.toBeNull();
      expect(findSecret(`"${name}": "abcd1234"`), `"${name}":`).not.toBeNull();
    }
  });

  test('a name that only looks like one is not a name', () => {
    for (const name of ['key', 'user', 'host', 'max_tokens', 'tokens', 'tokenizer', 'secretary', 'secrets', 'passwords', 'pwds', 'compass', 'api', 'keyboard', 'username']) {
      expect(findSecret(`${name}=abcd1234`), `${name}=`).toBeNull();
      expect(findSecret(`${name}: abcd1234`), `${name}:`).toBeNull();
    }
  });

  test('a space that is not a plain space (pasted from a web page) is still a space', () => {
    for (const text of ['password:\u00a0hunter2', 'client_secret\u00a0=\u00a0abc123xyz', 'password\t=\thunter2']) {
      expect(findSecret(text), JSON.stringify(text)).not.toBeNull();
    }
    expect(findSecret('password =\u00a0\nhunter2')).toBeNull();
  });

  test('returns the earlier of a named value and a key', () => {
    const openai = `sk-${fill(24)}`;
    for (const [text, first] of [
      [`GITHUB_TOKEN=abcd1234 and later ${openai}`, 'GITHUB_TOKEN=abcd1234'],
      [`${openai} and later client_secret=abc123xyz`, openai],
    ] as const) {
      const found = findSecret(text)!;
      expect(text.slice(found.start, found.end), text).toBe(first);
    }
  });

  test('lets ordinary prose through, the new names included', () => {
    for (const text of [
      // the spec's examples of prose that must not be stopped
      'Password: please use the one I sent you',
      'the token: we refresh it daily',
      'reset your password',
      'password=',
      'Set the value of password=',
      'password = \nnext line',
      'password = \r\nnext line',
      'secret sauce',
      'token-based auth',
      'access token expired yesterday',
      // the ones from before
      'Set password= the way the docs say.',
      'Use `token=` in the URL.',
      // a name written inside quotes or code marks is not given a value
      'Set `token=` before `password=` goes live.',
      "Use 'password=' instead of 'something' here.",
      'Use "password=" or "token=" here, not "something".',
      // words that only contain a name
      'max_tokens=1000 and temperature=0.2',
      'tokenizer=bpe and secretary: Jane Doe',
      'Passwords: use a manager.',
      // a sentence that ends the value is not part of it
      'Token: expired.',
      'Password: simple.',
      'Rotate the secret: it was shared in chat.',
      'Do not commit your password: use the vault instead.',
      // short or plain values after a colon
      'Token: 5 minutes',
      'Password: 8+ characters',
      'Secret: 2FA required',
      'The ratio is 3:1 for secret:public keys',
      'Note: the token expires after one hour.',
      'See RFC 6750: the bearer token usage',
      // names that are not on the list
      'host: db.example.com',
      'user: admin12',
      'key=abcd1234',
      'username=rian144hz',
    ]) {
      expect(findSecret(text), text).toBeNull();
    }
  });

  test('a long run of names with no space between them is not read again from each name', () => {
    expect(took('findSecret', 'token:'.repeat(40_000), 3000)).toBeLessThan(3000);
    expect(took('findSecret', 'secret:'.repeat(40_000), 3000)).toBeLessThan(3000);
  });

  test('a long text without a space or a sign stays fast', () => {
    for (const text of ['a'.repeat(300_000), 'a-'.repeat(150_000), 'a.'.repeat(150_000), 'a='.repeat(150_000), '"a"'.repeat(100_000), ' '.repeat(300_000), 'token '.repeat(50_000)]) {
      expect(took('findSecret', text), text.slice(0, 12)).toBeLessThan(500);
    }
  });
});

// Code that reads a secret from somewhere, or holds a flag, is not a secret.
describe('code that reads a secret, or holds a flag, is not stopped', () => {
  test('lets code through', () => {
    for (const text of [
      // the ruling's list
      'const token = await getToken();',
      'password = process.env.DB_PASSWORD',
      'require_password=true',
      'token=None',
      'api_key = os.environ["API_KEY"]',
      'secret: ${{ secrets.TOKEN }}',
      // a function call
      'token = getToken()',
      'password = config.get("x")',
      'secret=vault.read("db/pass").secret',
      'api_key = Deno.env.get("API_KEY")',
      "password = os.getenv('DB_PASSWORD', 'dev')",
      'password = input("Password: ")',
      // code that makes a value
      'const secret = new Secret("a")',
      'const token = await fetchToken(user)',
      // the environment, in the languages that have one
      'api_key = env.API_KEY',
      'API_KEY = ENV["API_KEY"]',
      'password: ${DB_PASSWORD}',
      'password=${DB_PASSWORD:-changeme}',
      'secret: ${{secrets.TOKEN}}',
      'token=$GITHUB_TOKEN',
      'export DB_PASSWORD=$DB_PASSWORD',
      'password=$(cat /run/secrets/db)',
      'POSTGRES_PASSWORD=${DB_PASSWORD:-secret}',
      'POSTGRES_PASSWORD=${DB_PASSWORD:=secret1}',
      // a flag, in any case
      'token = null',
      'password = undefined',
      'password=False',
      'token = None  # no token yet',
      'use_token=TRUE',
      'allow_password: false',
      // a template in a config file, in quotes or not
      'password="${DB_PASSWORD}"',
      '"password": "${DB_PASSWORD}"',
      'password: "{{ .Values.db.password }}"',
      'token: {{ secrets.TOKEN }}',
      "token: '$GITHUB_TOKEN'",
      'password="null"',
    ]) {
      expect(findSecret(text), text).toBeNull();
    }
  });

  test('still stops a value that only looks like code', () => {
    for (const text of [
      'token=none1234',
      'password=true123',
      'password=new_hunter2',
      'password = envy1234',
      'password=process.environment1',
      'secret=await1234',
      'password=Summer2024(!)',
      'password: newer12345',
      'password="null1234"',
      'password = "hunter2"',
      'token: "abc.def.ghi"',
    ]) {
      expect(findSecret(text), text).not.toBeNull();
    }
  });

  test('a second name on the line is still looked at', () => {
    for (const [text, passage] of [
      ['const token = await getToken(); const password = "hunter2";', 'password = "hunter2"'],
      ['token=None and secret=abc12345', 'secret=abc12345'],
      ['api_key = os.environ["API_KEY"]\nclient_secret=abc123xyz', 'client_secret=abc123xyz'],
    ] as const) {
      const found = findSecret(text)!;
      expect(found, text).not.toBeNull();
      expect(text.slice(found.start, found.end), text).toBe(passage);
    }
  });

  test('the earlier blocked cases stay blocked', () => {
    for (const text of ['client_secret=abc123xyz', 'API_TOKEN=9f8e7d6c', 'password: hunter2', '"apiKey": "AbC123dEf456"', "PASSWD='x9y8z7w6'", 'db.password = s3cr3t!']) {
      expect(findSecret(text), text).not.toBeNull();
    }
  });
});

// It runs on every keystroke of a field with no length limit, and a text of more than 2 000 characters cannot be sent.
describe('a long paste does not make the window slow', () => {
  test('a 200 000 character run of eyJ is checked in under 100 ms, whatever its shape', () => {
    for (const [name, text] of [
      ['one long run', 'eyJ' + 'a'.repeat(200_000)],
      ['eyJ over and over', 'eyJ'.repeat(66_667)],
      ['eyJ with dots', 'eyJ.'.repeat(50_000)],
      ['two parts and a short end', 'eyJabcdefgh.eyJabcdefgh.abc '.repeat(7_000)],
      ['a token that is not closed', `eyJ${'a'.repeat(100_000)}.eyJ${'b'.repeat(100_000)}`],
      ['dashes in the run', 'eyJ-'.repeat(50_000)],
    ] as const) {
      expect(took('findSecret', text), name).toBeLessThan(100);
    }
  });

  test('a real token is still found, and a token that sits in a word is not', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    for (const text of [jwt, `Bearer ${jwt}`, `token=${jwt}`, `"${jwt}"`, `(${jwt})`, `${jwt}.`]) {
      expect(findSecret(text), text).not.toBeNull();
    }
    expect(findSecret(`abc${jwt}`)).toBeNull();
  });

  test('the window looks at the first 4 000 characters only', () => {
    expect(FIELD_SCAN_MAX).toBe(4000);
    const inside = `${'word '.repeat(700)}password=hunter2`;
    expect(findSecretInField(inside)).toEqual(findSecret(inside));
    expect(findSecretInField(inside)).toMatchObject({ start: 3500 });
    // after the limit it is not looked for (and a text that long cannot be sent), while findSecret still sees it
    const outside = `${'word '.repeat(900)}password=hunter2`;
    expect(findSecret(outside)).not.toBeNull();
    expect(findSecretInField(outside)).toBeNull();
    // a passage that starts inside and runs past the limit is found and ends at it
    const straddling = `${'a '.repeat(1990)}password=${'x'.repeat(100)}`;
    expect(findSecretInField(straddling)).toMatchObject({ start: 3980, end: 4000 });
    // a short text is read whole
    expect(findSecretInField('password=hunter2')).toEqual(findSecret('password=hunter2'));
    expect(findSecretInField('')).toBeNull();
  });

  test('a million characters in the window cost next to nothing', () => {
    expect(took('findSecretInField', 'eyJ'.repeat(333_334))).toBeLessThan(20);
    expect(took('findSecretInField', 'token:'.repeat(200_000))).toBeLessThan(100);
  });
});
