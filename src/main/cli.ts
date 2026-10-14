import { createInterface } from 'node:readline/promises';
import { DEFAULT_MODELS, DEFAULT_PROVIDER, PROVIDERS, PROVIDER_LABELS, type ProviderId } from '../shared/providers';
import type { AppContext } from './app-context';

export const CLI_FLAGS = ['--set-key', '--smoke'] as const;
export const isCliMode = (argv: string[]) => CLI_FLAGS.some((f) => argv.includes(f));

const DEFAULT_PROFILE = {
  nativeLanguage: 'Portuguese',
  currentLevel: 'B1',
  targetLevel: 'B2',
  explanationLanguage: 'Portuguese',
  provider: DEFAULT_PROVIDER,
  model: DEFAULT_MODELS[DEFAULT_PROVIDER],
  theme: 'system',
} as const;

const SAMPLE_ANSWER =
  'Yesterday I have worked on the bug in the login. The problem was that the token expire too fast. ' +
  'I changed the configuration and now it works good. Today I will write tests for this.';

const print = (label: string, value: unknown) => process.stdout.write(`\n=== ${label} ===\n${JSON.stringify(value, null, 2)}\n`);

/** Terminal entry points used before the UI exists. Returns the process exit code. */
export async function runCli(argv: string[], ctx: AppContext): Promise<number> {
  const h = ctx.handlers;

  if (argv.includes('--set-key')) {
    const provider = providerArg(argv);
    if (!provider) return fail('set-key', { kind: 'validation', message: `--provider must be one of: ${PROVIDERS.join(', ')}` });
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const key = await rl.question(`Paste your ${PROVIDER_LABELS[provider]} API key and press Enter: `);
    rl.close();
    const r = await h['keys:set']({ key, provider });
    if (!r.ok) return fail('set-key', r.error);
    // Saving a key for a provider also makes it the one the coach uses.
    const profile = await h['profile:get']({});
    if (profile.ok && !profile.data) await h['profile:save']({ ...DEFAULT_PROFILE, provider, model: DEFAULT_MODELS[provider] });
    else if (profile.ok && profile.data?.provider !== provider) await h['settings:set']({ provider, model: DEFAULT_MODELS[provider] });
    process.stdout.write(`\nKey saved. The coach now uses ${PROVIDER_LABELS[provider]} (${DEFAULT_MODELS[provider]}).\n`);
    return 0;
  }

  // --smoke: one real challenge → feedback round trip through the same handlers the UI uses.
  const profile = await h['profile:get']({});
  if (profile.ok && !profile.data) await h['profile:save'](DEFAULT_PROFILE);

  const challenge = await h['challenges:next']({ requestId: 'smoke-challenge' });
  if (!challenge.ok) return fail('challenge', challenge.error);
  print('challenge', challenge.data);

  const feedback = await h['feedback:submit']({ requestId: 'smoke-feedback', challengeId: challenge.data.id, text: SAMPLE_ANSWER });
  if (!feedback.ok) return fail('feedback', feedback.error);
  print('answer', SAMPLE_ANSWER);
  print('feedback', feedback.data);
  return 0;
}

/** `--provider <id>`; defaults to the app's default provider. Returns null when the value is unknown. */
function providerArg(argv: string[]): ProviderId | null {
  const i = argv.indexOf('--provider');
  if (i === -1) return DEFAULT_PROVIDER;
  const value = argv[i + 1];
  return (PROVIDERS as readonly string[]).includes(value ?? '') ? (value as ProviderId) : null;
}

function fail(step: string, error: { kind: string; message: string }): number {
  process.stderr.write(`\nSmoke failed at ${step}: [${error.kind}] ${error.message}\n`);
  return 1;
}
