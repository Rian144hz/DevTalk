import { z } from 'zod';
import type { LLMRequest } from '../../src/core/llm/provider';
import { checkOllama, createOllamaProvider } from '../../src/main/llm/ollama-provider';

type Call = { url: string; init: RequestInit };
function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(String(url), init ?? {});
  }) as typeof fetch;
  return { f, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const req = (signal = new AbortController().signal): LLMRequest => ({
  system: 'SYS', user: 'USER', schema: z.object({ n: z.number() }), schemaName: 'test', signal,
});

test('posts a non-streaming chat with the JSON schema as format and the abort signal', async () => {
  const { f, calls } = fakeFetch(() => json({ message: { role: 'assistant', content: '{"n":1}' } }));
  const provider = createOllamaProvider({ model: 'qwen3:4b', fetch: f });
  const r = req();
  expect(await provider.generateJson(r)).toBe('{"n":1}');
  expect(calls[0]!.url).toBe('http://127.0.0.1:11434/api/chat');
  expect(calls[0]!.init.method).toBe('POST');
  expect(calls[0]!.init.signal).toBe(r.signal);
  const body = JSON.parse(String(calls[0]!.init.body));
  expect(body).toMatchObject({
    model: 'qwen3:4b', stream: false,
    messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USER' }],
    format: { type: 'object', properties: { n: { type: 'number' } } },
  });
  expect(body.format).not.toHaveProperty('$schema');
  expect(provider).toMatchObject({ id: 'ollama', model: 'qwen3:4b' });
});

test('connection refused → unavailable with a hint to start Ollama', async () => {
  const { f } = fakeFetch(() => { throw new TypeError('fetch failed'); });
  await expect(createOllamaProvider({ model: 'm', fetch: f }).generateJson(req())).rejects.toMatchObject({ kind: 'unavailable', message: expect.stringContaining('Ollama is not running') });
});

test('unknown model → config with the pull command', async () => {
  const { f } = fakeFetch(() => json({ error: "model 'm' not found" }, 404));
  await expect(createOllamaProvider({ model: 'm', fetch: f }).generateJson(req())).rejects.toMatchObject({ kind: 'config', message: expect.stringContaining('ollama pull m') });
});

test('abort → cancelled', async () => {
  const ac = new AbortController();
  const { f } = fakeFetch(() => { ac.abort(); throw new DOMException('aborted', 'AbortError'); });
  await expect(createOllamaProvider({ model: 'm', fetch: f }).generateJson(req(ac.signal))).rejects.toMatchObject({ kind: 'cancelled' });
});

test('empty content → invalid_output; other HTTP errors → unavailable', async () => {
  await expect(createOllamaProvider({ model: 'm', fetch: fakeFetch(() => json({ message: { content: '' } })).f }).generateJson(req()))
    .rejects.toMatchObject({ kind: 'invalid_output' });
  await expect(createOllamaProvider({ model: 'm', fetch: fakeFetch(() => json({ error: 'boom' }, 500)).f }).generateJson(req()))
    .rejects.toMatchObject({ kind: 'unavailable' });
});

test('checkOllama lists local models or explains why it cannot', async () => {
  expect(await checkOllama({ model: 'qwen3:4b', fetch: fakeFetch(() => json({ models: [{ name: 'qwen3:4b' }, { name: 'llama3.2:3b' }] })).f }))
    .toEqual({ ok: true, detail: 'Ollama is running. qwen3:4b is installed.' });
  expect(await checkOllama({ model: 'gemma3:4b', fetch: fakeFetch(() => json({ models: [{ name: 'qwen3:4b' }] })).f }))
    .toEqual({ ok: false, detail: 'Ollama is running, but gemma3:4b is not installed. Run: ollama pull gemma3:4b' });
  expect(await checkOllama({ model: 'm', fetch: fakeFetch(() => { throw new TypeError('fetch failed'); }).f }))
    .toEqual({ ok: false, detail: 'Ollama is not running. Start it, then check again.' });
});
