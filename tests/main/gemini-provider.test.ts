import { ApiError } from '@google/genai';
import { z } from 'zod';
import type { LLMRequest } from '../../src/core/llm/provider';
import { createGeminiProvider, type GeminiClient } from '../../src/main/llm/gemini-provider';

type Params = Parameters<GeminiClient['models']['generateContent']>[0];

function fakeClient(respond: (p: Params) => unknown) {
  const calls: Params[] = [];
  const client: GeminiClient = {
    models: {
      generateContent: async (p) => {
        calls.push(p);
        return respond(p) as Awaited<ReturnType<GeminiClient['models']['generateContent']>>;
      },
    },
  };
  return { client, calls };
}

const req = (signal = new AbortController().signal): LLMRequest => ({
  system: 'SYS',
  user: 'USER',
  schema: z.object({ n: z.number(), kind: z.enum(['a', 'b']) }),
  schemaName: 'test',
  signal,
});
const ok = (text = '{"n":1,"kind":"a"}') => ({ text, candidates: [{ finishReason: 'STOP' }] });

test('sends system instruction, user text, JSON schema and the abort signal', async () => {
  const { client, calls } = fakeClient(() => ok());
  const provider = createGeminiProvider({ apiKey: 'k', model: 'gemini-flash-latest', client });
  const r = req();
  expect(await provider.generateJson(r)).toBe('{"n":1,"kind":"a"}');
  const p = calls[0]!;
  expect(p.model).toBe('gemini-flash-latest');
  expect(p.contents).toBe('USER');
  expect(p.config).toMatchObject({ systemInstruction: 'SYS', responseMimeType: 'application/json' });
  expect(p.config?.abortSignal).toBe(r.signal);
  const schema = p.config?.responseJsonSchema as Record<string, unknown>;
  expect(schema).not.toHaveProperty('$schema');
  expect(schema).toMatchObject({ type: 'object', properties: { kind: { enum: ['a', 'b'] } } });
  expect(provider).toMatchObject({ id: 'gemini', model: 'gemini-flash-latest' });
});

test.each([
  ['MAX_TOKENS', 'truncated'],
  ['SAFETY', 'refusal'],
  ['PROHIBITED_CONTENT', 'refusal'],
])('finishReason %s → %s', async (finishReason, kind) => {
  const { client } = fakeClient(() => ({ text: '{"n":', candidates: [{ finishReason }] }));
  await expect(createGeminiProvider({ apiKey: 'k', model: 'm', client }).generateJson(req())).rejects.toMatchObject({ kind });
});

test('blocked prompt → refusal', async () => {
  const { client } = fakeClient(() => ({ text: undefined, candidates: [], promptFeedback: { blockReason: 'SAFETY' } }));
  await expect(createGeminiProvider({ apiKey: 'k', model: 'm', client }).generateJson(req())).rejects.toMatchObject({ kind: 'refusal' });
});

test('empty reply → invalid_output', async () => {
  const { client } = fakeClient(() => ({ text: undefined, candidates: [{ finishReason: 'STOP' }] }));
  await expect(createGeminiProvider({ apiKey: 'k', model: 'm', client }).generateJson(req())).rejects.toMatchObject({ kind: 'invalid_output' });
});

test.each([
  [429, 'Resource has been exhausted (e.g. check quota).', 'rate_limited'],
  [400, 'API key not valid. Please pass a valid API key.', 'auth'],
  [401, 'Unauthorized', 'auth'],
  [403, 'Permission denied', 'auth'],
  [404, 'models/gemini-nope is not found', 'config'],
  [400, 'Invalid JSON payload received.', 'config'],
  [500, 'Internal error', 'unavailable'],
  [503, 'The model is overloaded.', 'unavailable'],
])('ApiError %i (%s) → %s', async (status, message, kind) => {
  const { client } = fakeClient(() => {
    throw new ApiError({ status, message });
  });
  await expect(createGeminiProvider({ apiKey: 'k', model: 'm', client }).generateJson(req())).rejects.toMatchObject({ kind });
});

test('an aborted request → cancelled, whatever the SDK throws', async () => {
  const ac = new AbortController();
  const { client } = fakeClient(() => {
    ac.abort();
    throw new Error('This operation was aborted');
  });
  await expect(createGeminiProvider({ apiKey: 'k', model: 'm', client }).generateJson(req(ac.signal))).rejects.toMatchObject({ kind: 'cancelled' });
});

test('network failures → unavailable', async () => {
  const { client } = fakeClient(() => {
    throw new TypeError('fetch failed');
  });
  await expect(createGeminiProvider({ apiKey: 'k', model: 'm', client }).generateJson(req())).rejects.toMatchObject({ kind: 'unavailable' });
});
