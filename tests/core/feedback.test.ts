import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Challenge, Expression, LearnerProfile } from '../../src/core/domain/types';
import { FeedbackEngine, type FeedbackInput } from '../../src/core/feedback/engine';
import { FakeProvider } from '../../src/core/llm/fake-provider';
import { newCard, rate } from '../../src/core/srs/srs';
import { MemoryStudyStore } from '../../src/core/testing/memory-store';

const coachTemplate = readFileSync(join(__dirname, '../../prompts/coach.md'), 'utf8');
const learner: LearnerProfile = { nativeLanguage: 'Portuguese', currentLevel: 'B1', targetLevel: 'B2', explanationLanguage: 'Portuguese' };
const t0 = new Date('2026-10-13T12:00:00.000Z');
const clock = { now: () => t0 };
const signal = new AbortController().signal;

type Check = { expression: string; used: boolean; used_correctly: boolean; note: string };
function reply(over: { expressions?: string[]; checks?: Check[]; category?: string } = {}): string {
  return JSON.stringify({
    corrections: [{ original: 'have fixed', corrected: 'fixed', explanation: 'passado simples com "yesterday"', category: over.category ?? 'verb_tense' }],
    natural_rewrite: 'I fixed the bug yesterday and pushed the patch.',
    new_expressions: (over.expressions ?? ['push the patch', 'track down']).map((e) => ({
      expression: e, type: 'collocation', meaning: 'significado', example: `We need to ${e}.`,
    })),
    required_expressions_check: over.checks ?? [],
  });
}

function setup(responses: ConstructorParameters<typeof FakeProvider>[0]) {
  const store = new MemoryStudyStore();
  const provider = new FakeProvider(responses);
  const engine = new FeedbackEngine({ provider, store, clock, coachTemplate });
  return { store, provider, engine };
}

const freeInput = (text = 'I have fixed the bug yesterday.'): FeedbackInput => ({ text, source: 'typed', context: { kind: 'free' }, learner });

function challengeRequiring(store: MemoryStudyStore, texts: string[]): Challenge {
  const saved = store.saveFeedback({
    attempt: { challengeId: null, text: 'seed', source: 'typed' },
    feedback: { naturalRewrite: 'seed', provider: 'fake', model: 'fake', latencyMs: 0, rawJson: '{}' },
    corrections: [],
    newExpressions: texts.map((t) => ({ text: t, normalizedText: t.toLowerCase(), type: 'chunk' as const, meaning: 'm', example: 'e' })),
    checks: [],
    initialCard: newCard(t0),
    now: t0,
  });
  const exprs: Expression[] = saved.expressions.map((e) => e.expression);
  for (const e of exprs) {
    const r = rate(store.getCard(e.id)!, 'good', t0);
    store.saveReview(e.id, r.card, r.log);
  }
  return store.saveChallenge(
    { category: 'bug_explanation', situation: 's', interlocutor: 'i', task: 't', summary: 'x', required: exprs.map((e) => ({ expressionId: e.id, hint: 'h' })) },
    t0,
  );
}

test('happy path persists and returns feedback', async () => {
  const { engine, store } = setup([reply()]);
  const fb = await engine.review(freeInput(), signal);
  expect(fb.corrections[0]).toMatchObject({ category: 'verb_tense', corrected: 'fixed' });
  expect(fb.naturalRewrite).toContain('pushed the patch');
  expect(fb.newExpressions.map((e) => [e.expression.text, e.isNew])).toEqual([['push the patch', true], ['track down', true]]);
  expect(fb.requiredChecks).toEqual([]);
  expect(store.expressionCount()).toBe(2);
  expect(store.history({ before: null, limit: 5 })).toEqual([
    expect.objectContaining({ feedbackId: fb.feedbackId, attemptId: fb.attemptId, category: null, correctionCount: 1 }),
  ]);
});

test('system prompt is the rendered coach template', async () => {
  const { engine, provider } = setup([reply()]);
  await engine.review(freeInput(), signal);
  expect(provider.calls[0]!.system).toContain('direct, practical English coach');
  expect(provider.calls[0]!.system).not.toMatch(/\{[a-z_]+\}/);
  expect(provider.calls[0]!.user).toContain('I have fixed the bug yesterday.');
  expect(provider.calls[0]!.schemaName).toBe('feedback');
});

test('duplicate expression (case/punctuation differ) is not created twice', async () => {
  const { engine, store } = setup([reply({ expressions: ['Push back on', 'track down'] }), reply({ expressions: ['push back on.', 'zero in on'] })]);
  await engine.review(freeInput(), signal);
  const second = await engine.review(freeInput(), signal);
  expect(second.newExpressions.map((e) => e.isNew)).toEqual([false, true]);
  expect(store.expressionCount()).toBe(3);
});

test('duplicates inside one reply are collapsed', async () => {
  const { engine, store } = setup([reply({ expressions: ['track down', 'Track down!', 'zero in on'] })]);
  const fb = await engine.review(freeInput(), signal);
  expect(fb.newExpressions).toHaveLength(2);
  expect(store.expressionCount()).toBe(2);
});

test('required checks are matched by normalized text and persisted', async () => {
  const store = new MemoryStudyStore();
  const challenge = challengeRequiring(store, ['root cause']);
  const provider = new FakeProvider([reply({ checks: [{ expression: 'Root cause', used: true, used_correctly: true, note: 'ok' }] })]);
  const engine = new FeedbackEngine({ provider, store, clock, coachTemplate });
  const fb = await engine.review({ text: 'The root cause was a race.', source: 'typed', context: { kind: 'challenge', challenge }, learner }, signal);
  expect(fb.requiredChecks).toEqual([{ expression: challenge.required[0]!.expression, used: true, usedCorrectly: true, note: 'ok' }]);
  expect(store.reusedExpressionCount()).toBe(1);
  expect(provider.calls[0]!.user).toContain('Required expressions: root cause');
  expect(store.history({ before: null, limit: 1 })[0]).toMatchObject({ category: 'bug_explanation' });
});

test('used_correctly without used is not counted as a correct use', async () => {
  const store = new MemoryStudyStore();
  const challenge = challengeRequiring(store, ['root cause']);
  const p = new FakeProvider([reply({ checks: [{ expression: 'root cause', used: false, used_correctly: true, note: '' }] })]);
  const fb = await new FeedbackEngine({ provider: p, store, clock, coachTemplate })
    .review({ text: 'x', source: 'typed', context: { kind: 'challenge', challenge }, learner }, signal);
  expect(fb.requiredChecks[0]).toMatchObject({ used: false, usedCorrectly: false });
  expect(store.reusedExpressionCount()).toBe(0);
});

test('missing required check → retry; extra checks ignored', async () => {
  const store = new MemoryStudyStore();
  const challenge = challengeRequiring(store, ['root cause']);
  const p = new FakeProvider([
    reply({ checks: [] }),
    reply({ checks: [
      { expression: 'root cause', used: true, used_correctly: false, note: 'wrong article' },
      { expression: 'something else', used: true, used_correctly: true, note: '' },
    ] }),
  ]);
  const fb = await new FeedbackEngine({ provider: p, store, clock, coachTemplate })
    .review({ text: 'x', source: 'typed', context: { kind: 'challenge', challenge }, learner }, signal);
  expect(p.calls).toHaveLength(2);
  expect(p.calls[1]!.user).toContain('root cause');
  expect(fb.requiredChecks).toHaveLength(1);
  expect(fb.requiredChecks[0]).toMatchObject({ usedCorrectly: false, note: 'wrong article' });
});

test('unknown mistake category → retry, then invalid_output; store untouched', async () => {
  const { engine, store } = setup([reply({ category: 'spelling' }), reply({ category: 'spelling' })]);
  await expect(engine.review(freeInput(), signal)).rejects.toMatchObject({ kind: 'invalid_output' });
  expect(store.history({ before: null, limit: 5 })).toEqual([]);
});

test('fewer than 2 new expressions is invalid', async () => {
  const { engine } = setup([reply({ expressions: ['only one'] }), reply({ expressions: ['only one'] })]);
  await expect(engine.review(freeInput(), signal)).rejects.toMatchObject({ kind: 'invalid_output' });
});

test('source is stored but does not change the prompt', async () => {
  const { engine, provider } = setup([reply(), reply()]);
  await engine.review(freeInput('Same text.'), signal);
  await engine.review({ ...freeInput('Same text.'), source: 'transcript' }, signal);
  expect(provider.calls[0]!.user).toBe(provider.calls[1]!.user);
  expect(provider.calls[0]!.system).toBe(provider.calls[1]!.system);
});

test('latency is measured with the clock', async () => {
  const store = new MemoryStudyStore();
  let ms = 0;
  const tick = { now: () => new Date(t0.getTime() + (ms += 1500) - 1500) };
  const p = new FakeProvider([reply()]);
  const fb = await new FeedbackEngine({ provider: p, store, clock: tick, coachTemplate }).review(freeInput(), signal);
  expect(fb.latencyMs).toBe(1500);
});
