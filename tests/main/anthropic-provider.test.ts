import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { LLMError } from '../../src/core/llm/errors';
import type { LLMRequest } from '../../src/core/llm/provider';
import { createAnthropicProvider } from '../../src/main/llm/anthropic-provider';

type Captured = { params: Record<string, unknown>; options: { signal?: AbortSignal } };

function fakeClient(respond: () => unknown) {
  const captured: Captured[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: Record<string, unknown>, options: { signal?: AbortSignal }) => {
          captured.push({ params, options });
          return respond();
        },
      },
    },
  };
  return { client: client as unknown as Pick<Anthropic, 'beta'>, captured };
}

const message = (over: Record<string, unknown> = {}) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"n":1}' }],
  ...over,
});

const req = (): LLMRequest => ({
  system: 'SYS',
  user: 'USER',
  schema: z.object({ n: z.number() }),
  schemaName: 'test',
  signal: new AbortController().signal,
});

test('sends system, user, structured format, effort, fallbacks and the abort signal', async () => {
  const { client, captured } = fakeClient(() => message());
  const provider = createAnthropicProvider({ apiKey: 'k', model: 'claude-opus-5-5', client });
  const r = req();
  await provider.generateJson(r);
  const { params, options } = captured[0]!;
  expect(params).toMatchObject({
    model: 'claude-opus-5-5',
    system: 'SYS',
    messages: [{ role: 'user', content: 'USER' }],
    output_config: { effort: 'medium', format: { type: 'json_schema' } },
    fallbacks: 'default',
    betas: ['server-side-fallback-2026-07-01'],
  });
  expect((params['output_config'] as { format: { schema: { properties: object } } }).format.schema.properties).toHaveProperty('n');
  expect(params).not.toHaveProperty('thinking');
  expect(options.signal).toBe(r.signal);
  expect(provider).toMatchObject({ id: 'anthropic', model: 'claude-opus-5-5' });
});

test('effort is configurable', async () => {
  const { client, captured } = fakeClient(() => message());
  await createAnthropicProvider({ apiKey: 'k', model: 'm', effort: 'high', client }).generateJson(req());
  expect(captured[0]!.params).toMatchObject({ output_config: { effort: 'high' } });
});

test('returns the first text block', async () => {
  const { client } = fakeClient(() => message());
  expect(await createAnthropicProvider({ apiKey: 'k', model: 'm', client }).generateJson(req())).toBe('{"n":1}');
});

test('after a server-side fallback, reads the fallback model’s text', async () => {
  const { client } = fakeClient(() =>
    message({
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: '{"par' },
        { type: 'fallback', model: 'claude-opus-4-8' },
        { type: 'text', text: '{"n":2}' },
      ],
    }),
  );
  expect(await createAnthropicProvider({ apiKey: 'k', model: 'm', client }).generateJson(req())).toBe('{"n":2}');
});

test('no text block → invalid_output', async () => {
  const { client } = fakeClient(() => message({ content: [] }));
  await expect(createAnthropicProvider({ apiKey: 'k', model: 'm', client }).generateJson(req())).rejects.toMatchObject({ kind: 'invalid_output' });
});

test.each([
  ['refusal', 'refusal'],
  ['max_tokens', 'truncated'],
])('stop_reason %s → LLMError %s', async (stop, kind) => {
  const { client } = fakeClient(() => message({ stop_reason: stop }));
  const err = await createAnthropicProvider({ apiKey: 'k', model: 'm', client }).generateJson(req()).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(LLMError);
  expect(err).toMatchObject({ kind });
});

test.each([
  ['AuthenticationError', 'auth'],
  ['PermissionDeniedError', 'auth'],
  ['RateLimitError', 'rate_limited'],
  ['InternalServerError', 'unavailable'],
  ['APIConnectionError', 'unavailable'],
  ['APIConnectionTimeoutError', 'unavailable'],
  ['APIUserAbortError', 'cancelled'],
  ['BadRequestError', 'config'],
  ['NotFoundError', 'config'],
  ['UnprocessableEntityError', 'config'],
] as const)('%s → %s', async (cls, kind) => {
  const { client } = fakeClient(() => {
    throw Object.create(Anthropic[cls].prototype);
  });
  await expect(createAnthropicProvider({ apiKey: 'k', model: 'm', client }).generateJson(req())).rejects.toMatchObject({ kind });
});

test('unknown errors → unavailable with cause', async () => {
  const boom = new Error('boom');
  const { client } = fakeClient(() => {
    throw boom;
  });
  const err = (await createAnthropicProvider({ apiKey: 'k', model: 'm', client }).generateJson(req()).catch((e: unknown) => e)) as LLMError;
  expect(err.kind).toBe('unavailable');
  expect(err.cause).toBe(boom);
});
