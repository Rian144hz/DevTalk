import { z } from 'zod';
import { LLMError } from '../../src/core/llm/errors';
import { FakeProvider } from '../../src/core/llm/fake-provider';
import { generateStructured, type ProgressStage } from '../../src/core/llm/structured';

const S = z.object({ n: z.number() });
const args = (signal = new AbortController().signal) => ({ system: 'SYS', user: 'USER', schema: S, schemaName: 'test', signal });

test('valid on first try', async () => {
  const r = await generateStructured(new FakeProvider(['{"n":1}']), args());
  expect(r).toMatchObject({ value: { n: 1 }, attempts: 1, raw: '{"n":1}' });
});

test('passes system, user, schema and signal to the provider', async () => {
  const p = new FakeProvider(['{"n":1}']);
  const a = args();
  await generateStructured(p, a);
  expect(p.calls[0]).toMatchObject({ system: 'SYS', user: 'USER', schemaName: 'test' });
  expect(p.calls[0]!.signal).toBe(a.signal);
  expect(p.calls[0]!.schema).toBe(S);
});

test('invalid then valid → retries once with the validation error appended', async () => {
  const p = new FakeProvider(['not json', '{"n":2}']);
  const r = await generateStructured(p, args());
  expect(r.attempts).toBe(2);
  expect(r.value).toEqual({ n: 2 });
  expect(p.calls[1]!.user).toContain('USER');
  expect(p.calls[1]!.user).toContain('Your previous reply was invalid: not valid JSON');
});

test('schema issues are summarised in the retry prompt', async () => {
  const p = new FakeProvider(['{"n":"x"}', '{"n":2}']);
  await generateStructured(p, args());
  expect(p.calls[1]!.user).toMatch(/Your previous reply was invalid: n: /);
});

test('invalid twice → LLMError invalid_output', async () => {
  const err = await generateStructured(new FakeProvider(['{}', '{}']), args()).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(LLMError);
  expect(err).toMatchObject({ kind: 'invalid_output' });
});

test('refine failure counts as invalid', async () => {
  const p = new FakeProvider(['{"n":1}', '{"n":5}']);
  const r = await generateStructured(p, { ...args(), refine: (v: { n: number }) => (v.n < 3 ? 'n too small' : null) });
  expect(r.value.n).toBe(5);
  expect(p.calls[1]!.user).toContain('n too small');
});

test('aborted signal → cancelled, no call', async () => {
  const ac = new AbortController();
  ac.abort();
  const p = new FakeProvider(['{"n":1}']);
  await expect(generateStructured(p, args(ac.signal))).rejects.toMatchObject({ kind: 'cancelled' });
  expect(p.calls).toHaveLength(0);
});

test('abort between attempts → cancelled, no retry', async () => {
  const ac = new AbortController();
  const p = new FakeProvider([() => { ac.abort(); return 'bad'; }, '{"n":1}']);
  await expect(generateStructured(p, args(ac.signal))).rejects.toMatchObject({ kind: 'cancelled' });
  expect(p.calls).toHaveLength(1);
});

test('provider LLMError other than invalid_output propagates without retry', async () => {
  const p = new FakeProvider([() => { throw new LLMError('auth', 'bad key'); }, '{"n":1}']);
  await expect(generateStructured(p, args())).rejects.toMatchObject({ kind: 'auth' });
  expect(p.calls).toHaveLength(1);
});

test('progress stages', async () => {
  const stages: ProgressStage[] = [];
  await generateStructured(new FakeProvider(['nope', '{"n":1}']), { ...args(), onProgress: (s) => stages.push(s) });
  expect(stages).toEqual(['sending', 'waiting', 'validating', 'retrying', 'sending', 'waiting', 'validating']);
});

test('FakeProvider throws when it runs out of responses', async () => {
  await expect(new FakeProvider([]).generateJson(args())).rejects.toThrow('FakeProvider: no response left');
});
