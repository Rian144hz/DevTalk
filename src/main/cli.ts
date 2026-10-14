import { createInterface } from 'node:readline/promises';
import type { AppContext } from './app-context';

export const CLI_FLAGS = ['--set-key', '--smoke'] as const;
export const isCliMode = (argv: string[]) => CLI_FLAGS.some((f) => argv.includes(f));

const DEFAULT_PROFILE = {
  nativeLanguage: 'Portuguese',
  currentLevel: 'B1',
  targetLevel: 'B2',
  explanationLanguage: 'Portuguese',
  provider: 'anthropic',
  model: 'claude-opus-5-5',
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
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const key = await rl.question('Paste your Anthropic API key and press Enter: ');
    rl.close();
    const r = await h['keys:set']({ key });
    process.stdout.write(r.ok ? 'Key saved.\n' : `Could not save the key: ${r.error.message}\n`);
    return r.ok ? 0 : 1;
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

function fail(step: string, error: { kind: string; message: string }): number {
  process.stderr.write(`\nSmoke failed at ${step}: [${error.kind}] ${error.message}\n`);
  return 1;
}
