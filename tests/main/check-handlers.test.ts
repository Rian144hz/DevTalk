import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SECRET_MESSAGE } from '../../src/core/check/secrets';
import { LLMError } from '../../src/core/llm/errors';
import { FakeProvider } from '../../src/core/llm/fake-provider';
import type { LLMProvider } from '../../src/core/llm/provider';
import type { ProgressStage } from '../../src/core/llm/structured';
import { MemoryStudyStore } from '../../src/core/testing/memory-store';
import { createCheckHandlers } from '../../src/main/ipc/check-handlers';
import type { HandlerDeps } from '../../src/main/ipc/handlers';
import { createInFlight } from '../../src/main/ipc/in-flight';
import type { KeyVault } from '../../src/main/vault/key-vault';

const prompt = (name: string) => readFileSync(join(__dirname, '../../prompts', name), 'utf8');
const templates = () => ({ coach: prompt('coach.md'), challenge: prompt('challenge.md'), check: prompt('check.md') });
const t0 = new Date('2026-10-13T12:00:00.000Z');
const profile = {
  nativeLanguage: 'Portuguese', currentLevel: 'B1' as const, targetLevel: 'B2' as const, explanationLanguage: 'Portuguese',
  provider: 'anthropic', model: 'claude-opus-5-5', theme: 'system' as const,
};

const checkReply = JSON.stringify({
  corrections: [{ original: 'have fixed', corrected: 'fixed', explanation: 'x', category: 'verb_tense' }],
  natural_rewrite: 'Hey team, I fixed it.',
  new_expressions: [
    { expression: 'track down', type: 'phrasal_verb', meaning: 'm', example: 'e' },
    { expression: 'root cause', type: 'collocation', meaning: 'm', example: 'e' },
  ],
});

function memoryVault(initial: string | null = 'sk-ant-test'): KeyVault {
  let key = initial;
  return { has: () => key !== null, get: () => key, set: (k) => { key = k.trim(); }, clear: () => { key = null; } };
}

function setup(opts: { provider?: LLMProvider; vault?: KeyVault; onboarded?: boolean; activity?: string[] } = {}) {
  const store = new MemoryStudyStore();
  if (opts.onboarded !== false) store.saveProfile(profile, t0);
  const provider = opts.provider ?? new FakeProvider([]);
  const progress: [string, ProgressStage][] = [];
  const emitProgress = (requestId: string, stage: ProgressStage) => progress.push([requestId, stage]);
  const deps: HandlerDeps = {
    store,
    vaults: () => opts.vault ?? memoryVault(),
    clock: { now: () => t0 },
    makeProvider: (apiKey) => {
      if (!apiKey) throw new LLMError('no_key', 'no key');
      return provider;
    },
    checkProvider: async () => ({ ok: true, detail: 'ok' }),
    templates,
    emitProgress,
    onActivity: (kind) => opts.activity?.push(kind),
  };
  const h = createCheckHandlers({ ...deps, inFlight: createInFlight(emitProgress) });
  return { h, store, provider, progress };
}

const counts = (store: MemoryStudyStore) => ({
  history: store.history({ before: null, limit: 50 }).length,
  expressions: store.expressionCount(),
  due: store.countDue(new Date(t0.getTime() + 365 * 86_400_000)),
  mistakes: store.mistakeCounts(null),
});

test('check:run returns the result after one coach call and leaves the store empty (no history, expressionCount 0)', async () => {
  const provider = new FakeProvider([checkReply]);
  const activity: string[] = [];
  const { h, store, progress } = setup({ provider, activity });
  const r = await h['check:run']({ requestId: 'k1', type: 'slack', text: '  I have fixed the test.  ' });
  expect(r).toEqual({
    ok: true,
    data: {
      corrections: [{ original: 'have fixed', corrected: 'fixed', explanation: 'x', category: 'verb_tense' }],
      naturalRewrite: 'Hey team, I fixed it.',
      expressions: [
        { text: 'track down', type: 'phrasal_verb', meaning: 'm', example: 'e' },
        { text: 'root cause', type: 'collocation', meaning: 'm', example: 'e' },
      ],
    },
  });
  expect(provider.calls).toHaveLength(1);
  expect(provider.calls[0]!.schemaName).toBe('check');
  expect(provider.calls[0]!.user).toContain('Text type: Slack message');
  expect(provider.calls[0]!.user).toContain('I have fixed the test.');
  expect(progress.filter(([id]) => id === 'k1').map(([, s]) => s)).toEqual(['sending', 'waiting', 'validating']);
  // Nothing was written: no history, no expression, no card, no mistake count, and no practice activity.
  expect(store.history({ before: null, limit: 10 })).toEqual([]);
  expect(store.expressionCount()).toBe(0);
  expect(counts(store)).toEqual({ history: 0, expressions: 0, due: 0, mistakes: [] });
  expect(activity).toEqual([]);
});

test('every type reaches the coach with its label', async () => {
  const provider = new FakeProvider([checkReply, checkReply]);
  const { h } = setup({ provider });
  await h['check:run']({ requestId: 'a', type: 'email', text: 'Dear Maya,' });
  await h['check:run']({ requestId: 'b', type: 'commit_message', text: 'fix test' });
  expect(provider.calls.map((c) => /^Text type: (.*)$/m.exec(c.user)?.[1])).toEqual(['E-mail', 'Commit message']);
});

test('a key in the text and 2001 characters are validation errors and the coach is never called', async () => {
  const provider = new FakeProvider([checkReply]);
  const { h, store } = setup({ provider });
  const key = `sk-ant-api03-${'a1B2c3D4e5'.repeat(4)}`;
  // The key stops the check with the exact message, wherever it is.
  expect(await h['check:run']({ requestId: 'k1', type: 'slack', text: `Use ${key} here.` })).toEqual({
    ok: false, error: { kind: 'validation', message: SECRET_MESSAGE },
  });
  expect(await h['check:run']({ requestId: 'k2', type: 'slack', text: 'First line.\npassword=hunter2' })).toMatchObject({
    ok: false, error: { kind: 'validation', message: SECRET_MESSAGE },
  });
  expect(await h['check:run']({ requestId: 'k3', type: 'slack', text: 'a'.repeat(2001) })).toMatchObject({ ok: false, error: { kind: 'validation' } });
  expect(await h['check:run']({ requestId: 'k4', type: 'slack', text: '   ' })).toMatchObject({ ok: false, error: { kind: 'validation' } });
  expect(await h['check:run']({ requestId: 'k5', type: 'tweet', text: 'hi' })).toMatchObject({ ok: false, error: { kind: 'validation' } });
  expect(await h['check:run']({ requestId: '', type: 'slack', text: 'hi' })).toMatchObject({ ok: false, error: { kind: 'validation' } });
  expect(await h['check:run']({ requestId: 'k6', type: 'slack', text: 'hi', extra: 1 })).toMatchObject({ ok: false, error: { kind: 'validation' } });
  expect(provider.calls).toHaveLength(0);
  expect(counts(store)).toEqual({ history: 0, expressions: 0, due: 0, mistakes: [] });
  // 2000 characters of ordinary text is fine.
  expect(await h['check:run']({ requestId: 'k7', type: 'slack', text: 'a'.repeat(2000) })).toMatchObject({ ok: true });
  expect(provider.calls).toHaveLength(1);
});

test('a key is refused before the key vault or the provider is looked at', async () => {
  const provider = new FakeProvider([]);
  const { h } = setup({ provider, vault: memoryVault(null) });
  expect(await h['check:run']({ requestId: 'k1', type: 'slack', text: 'token=abc123' })).toMatchObject({
    ok: false, error: { kind: 'validation', message: SECRET_MESSAGE },
  });
  expect(provider.calls).toHaveLength(0);
});

test('no key → no_key; quota → rate_limited; check:cancel → cancelled; a repeated requestId → busy', async () => {
  const noKey = setup({ vault: memoryVault(null) });
  expect(await noKey.h['check:run']({ requestId: 'k1', type: 'slack', text: 'hi' })).toMatchObject({
    ok: false, error: { kind: 'no_key', message: 'Add your API key in Settings to use the coach.' },
  });

  const quota = setup({ provider: new FakeProvider([() => { throw new LLMError('rate_limited', 'quota'); }]) });
  expect(await quota.h['check:run']({ requestId: 'k1', type: 'slack', text: 'hi' })).toMatchObject({
    ok: false, error: { kind: 'rate_limited', message: expect.stringContaining('limit') },
  });

  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const provider = new FakeProvider([async () => { await gate; return checkReply; }, checkReply]);
  const { h } = setup({ provider });
  const pending = h['check:run']({ requestId: 'same', type: 'slack', text: 'hello' });
  // The same id again, while the first is running.
  expect(await h['check:run']({ requestId: 'same', type: 'slack', text: 'hello' })).toMatchObject({ ok: false, error: { kind: 'busy' } });
  expect(await h['check:cancel']({ requestId: 'same' })).toEqual({ ok: true, data: null });
  release();
  expect(await pending).toMatchObject({ ok: false, error: { kind: 'cancelled' } });
  expect(provider.calls).toHaveLength(1);
  expect(provider.calls[0]!.signal.aborted).toBe(true);
  // The id is free again once it has finished.
  expect(await h['check:run']({ requestId: 'same', type: 'slack', text: 'again' })).toMatchObject({ ok: true });
});

test('check:cancel of an unknown id is a no-op and its payload is validated', async () => {
  const { h } = setup();
  expect(await h['check:cancel']({ requestId: 'nope' })).toEqual({ ok: true, data: null });
  expect(await h['check:cancel']({ requestId: '' })).toMatchObject({ ok: false, error: { kind: 'validation' } });
  expect(await h['check:cancel']({})).toMatchObject({ ok: false, error: { kind: 'validation' } });
});

test('not onboarded → not_found, and a coach failure changes nothing', async () => {
  const notOnboarded = setup({ onboarded: false, provider: new FakeProvider([checkReply]) });
  expect(await notOnboarded.h['check:run']({ requestId: 'k1', type: 'slack', text: 'hi' })).toMatchObject({ ok: false, error: { kind: 'not_found' } });

  const down = setup({ provider: new FakeProvider([async () => { throw new LLMError('unavailable', 'down'); }]) });
  expect(await down.h['check:run']({ requestId: 'k1', type: 'slack', text: 'hello' })).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
  expect(counts(down.store)).toEqual({ history: 0, expressions: 0, due: 0, mistakes: [] });
});
