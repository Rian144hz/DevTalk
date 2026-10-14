import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LLMError } from '../../src/core/llm/errors';
import { FakeProvider } from '../../src/core/llm/fake-provider';
import type { LLMProvider, LLMRequest } from '../../src/core/llm/provider';
import type { ProgressStage } from '../../src/core/llm/structured';
import { MemoryStudyStore } from '../../src/core/testing/memory-store';
import { createHandlers } from '../../src/main/ipc/handlers';
import type { KeyVault } from '../../src/main/vault/key-vault';

const templates = () => ({
  coach: readFileSync(join(__dirname, '../../prompts/coach.md'), 'utf8'),
  challenge: readFileSync(join(__dirname, '../../prompts/challenge.md'), 'utf8'),
});
const t0 = new Date('2026-10-13T12:00:00.000Z');
const profile = {
  nativeLanguage: 'Portuguese', currentLevel: 'B1' as const, targetLevel: 'B2' as const, explanationLanguage: 'Portuguese',
  provider: 'anthropic', model: 'claude-opus-5-5', theme: 'system' as const,
};

const feedbackReply = JSON.stringify({
  corrections: [{ original: 'have fixed', corrected: 'fixed', explanation: 'x', category: 'verb_tense' }],
  natural_rewrite: 'I fixed it.',
  new_expressions: [
    { expression: 'track down', type: 'phrasal_verb', meaning: 'm', example: 'e' },
    { expression: 'root cause', type: 'collocation', meaning: 'm', example: 'e' },
  ],
  required_expressions_check: [],
});
/** Echoes the category the generator asked for (it is picked at random). */
const challengeReply = (req: LLMRequest) =>
  JSON.stringify({
    category: /for the category "(\w+)"/.exec(req.system)![1],
    situation: 's', interlocutor: 'i', task: 't', required_expressions: [], summary: 'sum',
  });

function memoryVault(initial: string | null = 'sk-ant-test'): KeyVault {
  let key = initial;
  return { has: () => key !== null, get: () => key, set: (k) => { key = k.trim(); }, clear: () => { key = null; } };
}

function setup(opts: { provider?: LLMProvider; vault?: KeyVault; vaults?: Record<string, KeyVault>; onboarded?: boolean } = {}) {
  const store = new MemoryStudyStore();
  if (opts.onboarded !== false) store.saveProfile(profile, t0);
  const provider = opts.provider ?? new FakeProvider([]);
  const progress: [string, ProgressStage][] = [];
  const h = createHandlers({
    store,
    vaults: (p) => opts.vaults?.[p] ?? (p === profile.provider ? (opts.vault ?? memoryVault()) : memoryVault(null)),
    clock: { now: () => t0 },
    makeProvider: (apiKey) => {
      if (!apiKey) throw new LLMError('no_key', 'no key');
      return provider;
    },
    templates,
    emitProgress: (requestId, stage) => progress.push([requestId, stage]),
  });
  return { h, store, provider, progress };
}

test('invalid input → validation error, no provider call', async () => {
  const provider = new FakeProvider([]);
  const { h } = setup({ provider });
  expect(await h['feedback:submit']({ requestId: 'r1', challengeId: null, text: '   ' })).toMatchObject({ ok: false, error: { kind: 'validation' } });
  expect(await h['feedback:submit']({ requestId: 'r1', challengeId: null, text: 'a'.repeat(4001) })).toMatchObject({ ok: false, error: { kind: 'validation' } });
  expect(await h['feedback:submit']({ requestId: '', challengeId: null, text: 'ok' })).toMatchObject({ ok: false, error: { kind: 'validation' } });
  expect(await h['review:rate']({ expressionId: 1, rating: 'perfect' })).toMatchObject({ ok: false, error: { kind: 'validation' } });
  expect(provider.calls).toHaveLength(0);
});

test('no key → no_key error with friendly copy', async () => {
  const { h } = setup({ vault: memoryVault(null) });
  const r = await h['challenges:next']({ requestId: 'r1' });
  expect(r).toMatchObject({ ok: false, error: { kind: 'no_key', message: 'Add your API key in Settings to use the coach.' } });
});

test('not onboarded → not_found', async () => {
  const { h } = setup({ onboarded: false });
  expect(await h['challenges:next']({ requestId: 'r1' })).toMatchObject({ ok: false, error: { kind: 'not_found' } });
});

test('challenge then feedback happy path, with progress events', async () => {
  const { h, progress, store } = setup({ provider: new FakeProvider([challengeReply, feedbackReply]) });
  const ch = await h['challenges:next']({ requestId: 'c1' });
  expect(ch).toMatchObject({ ok: true, data: { summary: 'sum' } });
  const challengeId = (ch as { data: { id: number } }).data.id;
  const fb = await h['feedback:submit']({ requestId: 'f1', challengeId, text: '  I have fixed it.  ' });
  expect(fb).toMatchObject({ ok: true, data: { naturalRewrite: 'I fixed it.' } });
  expect(progress.filter(([id]) => id === 'f1').map(([, s]) => s)).toEqual(['sending', 'waiting', 'validating']);
  expect(store.history({ before: null, limit: 1 })[0]).toMatchObject({ text: 'I have fixed it.', category: (ch as { data: { category: string } }).data.category });
});

test('feedback for an unknown challenge → not_found', async () => {
  const { h } = setup({ provider: new FakeProvider([feedbackReply]) });
  expect(await h['feedback:submit']({ requestId: 'f1', challengeId: 999, text: 'hi' })).toMatchObject({ ok: false, error: { kind: 'not_found' } });
});

test('cancel aborts an in-flight request → cancelled', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const provider = new FakeProvider([async () => { await gate; return feedbackReply; }]);
  const { h } = setup({ provider });
  const pending = h['feedback:submit']({ requestId: 'f1', challengeId: null, text: 'hello' });
  await Promise.resolve();
  expect(await h['feedback:cancel']({ requestId: 'f1' })).toEqual({ ok: true, data: null });
  release();
  expect(await pending).toMatchObject({ ok: false, error: { kind: 'cancelled' } });
  expect(provider.calls[0]!.signal.aborted).toBe(true);
});

test('duplicate requestId in flight → busy; unknown cancel → ok no-op', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { h } = setup({ provider: new FakeProvider([async () => { await gate; return feedbackReply; }, feedbackReply]) });
  const first = h['feedback:submit']({ requestId: 'same', challengeId: null, text: 'hello' });
  expect(await h['feedback:submit']({ requestId: 'same', challengeId: null, text: 'hello' })).toMatchObject({ ok: false, error: { kind: 'busy' } });
  expect(await h['challenges:cancel']({ requestId: 'nope' })).toEqual({ ok: true, data: null });
  release();
  expect(await first).toMatchObject({ ok: true });
  // the id is free again once finished
  expect(await h['feedback:submit']({ requestId: 'same', challengeId: null, text: 'again' })).toMatchObject({ ok: true });
});

test('keys:status never returns the key; set and clear work', async () => {
  const vault = memoryVault(null);
  const { h } = setup({ vault });
  expect(await h['keys:status']({})).toEqual({ ok: true, data: { hasKey: false } });
  expect(await h['keys:set']({ key: ' sk-ant-xyz ' })).toEqual({ ok: true, data: { hasKey: true } });
  expect(vault.get()).toBe('sk-ant-xyz');
  expect(JSON.stringify(await h['keys:status']({}))).not.toContain('sk-ant');
  expect(await h['keys:clear']({})).toEqual({ ok: true, data: { hasKey: false } });
});

test('profile and settings round-trip', async () => {
  const { h } = setup({ onboarded: false });
  expect(await h['profile:get']({})).toEqual({ ok: true, data: null });
  expect(await h['settings:set']({ theme: 'dark' })).toMatchObject({ ok: false, error: { kind: 'not_found' } });
  expect(await h['profile:save'](profile)).toMatchObject({ ok: true, data: { theme: 'system', onboardedAt: t0.toISOString() } });
  expect(await h['settings:set']({ theme: 'dark', model: 'claude-haiku-5-5' })).toEqual({
    ok: true, data: { provider: 'anthropic', model: 'claude-haiku-5-5', theme: 'dark' },
  });
  expect(await h['settings:get']({})).toEqual({ ok: true, data: { provider: 'anthropic', model: 'claude-haiku-5-5', theme: 'dark' } });
  expect(await h['profile:get']({})).toMatchObject({ ok: true, data: { nativeLanguage: 'Portuguese', theme: 'dark' } });
});

test('review:rate moves the card and review:queue no longer returns it', async () => {
  const { h } = setup({ provider: new FakeProvider([feedbackReply]) });
  await h['feedback:submit']({ requestId: 'f1', challengeId: null, text: 'hello' });
  const queue = await h['review:queue']({});
  expect(queue.ok && queue.data).toHaveLength(2);
  const item = (queue as { data: { expression: { id: number }; preview: Record<string, string> }[] }).data[0]!;
  expect(Object.keys(item.preview)).toEqual(['again', 'hard', 'good', 'easy']);
  expect(await h['review:rate']({ expressionId: item.expression.id, rating: 'easy' })).toMatchObject({ ok: true });
  const after = await h['review:queue']({});
  expect((after as { data: { expression: { id: number } }[] }).data.map((d) => d.expression.id)).not.toContain(item.expression.id);
  expect(await h['review:rate']({ expressionId: 9999, rating: 'good' })).toMatchObject({ ok: false, error: { kind: 'not_found' } });
});

test('progress summary and history', async () => {
  const { h } = setup({ provider: new FakeProvider([feedbackReply]) });
  await h['feedback:submit']({ requestId: 'f1', challengeId: null, text: 'hello' });
  expect(await h['progress:summary']({})).toMatchObject({ ok: true, data: { totalExpressions: 2, mistakes: [{ category: 'verb_tense', total: 1 }] } });
  expect(await h['progress:history']({ before: null })).toMatchObject({ ok: true, data: [{ text: 'hello', correctionCount: 1 }] });
});

test('keys are stored per provider; status follows the profile provider by default', async () => {
  const gemini = memoryVault(null);
  const anthropic = memoryVault(null);
  const { h } = setup({ vaults: { gemini, anthropic } });
  expect(await h['keys:set']({ key: 'g-key', provider: 'gemini' })).toEqual({ ok: true, data: { hasKey: true } });
  expect(gemini.get()).toBe('g-key');
  expect(anthropic.get()).toBeNull();
  // profile uses anthropic, which has no key yet
  expect(await h['keys:status']({})).toEqual({ ok: true, data: { hasKey: false } });
  expect(await h['keys:status']({ provider: 'gemini' })).toEqual({ ok: true, data: { hasKey: true } });
  expect(await h['keys:clear']({ provider: 'gemini' })).toEqual({ ok: true, data: { hasKey: false } });
});

test('the provider for a request uses that provider\'s key', async () => {
  const keys: (string | null)[] = [];
  const store = new MemoryStudyStore();
  store.saveProfile({ ...profile, provider: 'gemini', model: 'gemini-flash-latest' }, t0);
  const h = createHandlers({
    store,
    vaults: (p) => (p === 'gemini' ? memoryVault('g-key') : memoryVault('a-key')),
    clock: { now: () => t0 },
    makeProvider: (apiKey) => {
      keys.push(apiKey);
      return new FakeProvider([challengeReply]);
    },
    templates,
    emitProgress: () => {},
  });
  await h['challenges:next']({ requestId: 'c1' });
  expect(keys).toEqual(['g-key']);
});

test('rate_limited has friendly copy', async () => {
  const { h } = setup({ provider: new FakeProvider([() => { throw new LLMError('rate_limited', 'quota'); }]) });
  expect(await h['challenges:next']({ requestId: 'c1' })).toMatchObject({
    ok: false,
    error: { kind: 'rate_limited', message: expect.stringContaining('limit') },
  });
});

test('settings accept gemini as provider', async () => {
  const { h } = setup();
  expect(await h['settings:set']({ provider: 'gemini', model: 'gemini-flash-latest' })).toMatchObject({ ok: true, data: { provider: 'gemini' } });
});
