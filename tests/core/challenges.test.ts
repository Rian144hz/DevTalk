import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChallengeGenerator } from '../../src/core/challenges/generator';
import { pickCategory } from '../../src/core/challenges/select';
import type { LearnerProfile } from '../../src/core/domain/types';
import { FakeProvider } from '../../src/core/llm/fake-provider';
import { newCard, rate } from '../../src/core/srs/srs';
import { MemoryStudyStore } from '../../src/core/testing/memory-store';

const challengeTemplate = readFileSync(join(__dirname, '../../prompts/challenge.md'), 'utf8');
const learner: LearnerProfile = { nativeLanguage: 'Portuguese', currentLevel: 'B1', targetLevel: 'B2', explanationLanguage: 'Portuguese' };
const t0 = new Date('2026-10-13T12:00:00.000Z');
const day = 86_400_000;
const clock = { now: () => t0 };
const signal = new AbortController().signal;

function reply(category: string, required: string[] = []): string {
  return JSON.stringify({
    category,
    situation: 'The nightly build broke after a dependency bump. Your lead asks what happened.',
    interlocutor: 'Sam, your tech lead',
    task: 'Explain the cause and the fix.',
    required_expressions: required.map((expression) => ({ expression, hint: `dica para ${expression}` })),
    summary: 'nightly build broke after bump',
  });
}

/** Seeds expressions; `reviewedDaysAgo` null means never reviewed (state new). */
function seed(store: MemoryStudyStore, items: { text: string; reviewedDaysAgo: number | null }[]) {
  const saved = store.saveFeedback({
    attempt: { challengeId: null, text: 'seed', source: 'typed' },
    feedback: { naturalRewrite: 'seed', provider: 'fake', model: 'fake', latencyMs: 0, rawJson: '{}' },
    corrections: [],
    newExpressions: items.map((i) => ({ text: i.text, normalizedText: i.text, type: 'chunk' as const, meaning: `meaning of ${i.text}`, example: 'e' })),
    checks: [],
    initialCard: newCard(new Date(t0.getTime() - 60 * day)),
    now: new Date(t0.getTime() - 60 * day),
  });
  items.forEach((item, i) => {
    if (item.reviewedDaysAgo === null) return;
    const when = new Date(t0.getTime() - item.reviewedDaysAgo * day);
    const r = rate(newCard(when), 'good', when);
    store.saveReview(saved.expressions[i]!.expression.id, r.card, r.log);
  });
}

test('pickCategory prefers the least used in the window', () => {
  expect(pickCategory(['daily_update', 'code_review', 'daily_update', 'bug_explanation'], () => 0)).toBe('tech_interview');
});

test('pickCategory breaks ties with rng', () => {
  expect(pickCategory([], () => 0)).toBe('daily_update');
  expect(pickCategory([], () => 0.99)).toBe('tech_interview');
  expect(pickCategory(['daily_update', 'code_review'], () => 0.6)).toBe('tech_interview');
});

test('pickCategory only looks at the last 8', () => {
  const recent = [
    'code_review', 'bug_explanation', 'tech_interview', 'code_review', 'bug_explanation', 'tech_interview', 'code_review', 'bug_explanation',
    'daily_update', 'daily_update', 'daily_update',
  ] as const;
  expect(pickCategory([...recent], () => 0)).toBe('daily_update');
});

test('next() requires up to 2 reviewed due cards and saves hints', async () => {
  const store = new MemoryStudyStore();
  seed(store, [
    { text: 'second', reviewedDaysAgo: 20 },
    { text: 'most overdue', reviewedDaysAgo: 30 },
    { text: 'third', reviewedDaysAgo: 10 },
    { text: 'brand new', reviewedDaysAgo: null },
  ]);
  const provider = new FakeProvider([reply('daily_update', ['most overdue', 'Second'])]);
  const ch = await new ChallengeGenerator({ provider, store, clock, challengeTemplate, rng: () => 0 }).next(learner, signal);
  expect(ch.required.map((r) => r.expression.text)).toEqual(['most overdue', 'second']);
  expect(ch.required.map((r) => r.hint)).toEqual(['dica para most overdue', 'dica para Second']);
  expect(provider.calls[0]!.system).toContain('- most overdue (chunk): meaning of most overdue');
  expect(provider.calls[0]!.system).not.toContain('brand new');
  expect(provider.calls[0]!.user).toBe('Write the challenge now.');
  expect(provider.calls[0]!.schemaName).toBe('challenge');
  expect(store.getChallenge(ch.id)).toEqual(ch);
});

test('no eligible cards → prompt says none and required is empty', async () => {
  const store = new MemoryStudyStore();
  seed(store, [{ text: 'brand new', reviewedDaysAgo: null }]);
  const provider = new FakeProvider([reply('daily_update')]);
  const ch = await new ChallengeGenerator({ provider, store, clock, challengeTemplate, rng: () => 0 }).next(learner, signal);
  expect(ch.required).toEqual([]);
  expect(provider.calls[0]!.system).toContain('Required expressions: none.');
});

test('recent summaries are passed to the prompt (last 10)', async () => {
  const store = new MemoryStudyStore();
  for (let i = 0; i < 12; i++) {
    store.saveChallenge({ category: 'code_review', situation: 's', interlocutor: 'i', task: 't', summary: `summary ${i}`, required: [] }, new Date(t0.getTime() - (12 - i) * day));
  }
  const provider = new FakeProvider([reply('daily_update')]);
  await new ChallengeGenerator({ provider, store, clock, challengeTemplate, rng: () => 0 }).next(learner, signal);
  expect(provider.calls[0]!.system).toContain('summary 11; summary 10');
  expect(provider.calls[0]!.system).toContain('summary 2');
  expect(provider.calls[0]!.system).not.toContain('summary 1;');
});

test('category or expression mismatch → retry', async () => {
  const store = new MemoryStudyStore();
  seed(store, [{ text: 'root cause', reviewedDaysAgo: 5 }]);
  const provider = new FakeProvider([reply('code_review', ['root cause']), reply('daily_update', []), reply('daily_update', ['root cause'])]);
  const gen = new ChallengeGenerator({ provider, store, clock, challengeTemplate, rng: () => 0 });
  await expect(gen.next(learner, signal)).rejects.toMatchObject({ kind: 'invalid_output' });
  expect(provider.calls[1]!.user).toContain('category must be "daily_update"');
  const ok = await gen.next(learner, signal);
  expect(ok.required).toHaveLength(1);
});

describe('next() with a category override (the daily challenge)', () => {
  test('next({ category }) uses it instead of pickCategory and still rejects a reply with another category', async () => {
    // With an empty history and rng 0, pickCategory alone would choose daily_update.
    const rng = vi.fn(() => 0);
    const store = new MemoryStudyStore();
    const provider = new FakeProvider([reply('tech_interview')]);
    const gen = new ChallengeGenerator({ provider, store, clock, challengeTemplate, rng });
    const ch = await gen.next(learner, signal, undefined, { category: 'tech_interview' });
    expect(ch.category).toBe('tech_interview');
    expect(provider.calls[0]!.system).toContain('for the category "tech_interview"');
    // The override replaces the pick: the tie-breaker is not even asked.
    expect(rng).not.toHaveBeenCalled();
    expect(store.recentChallenges(5)).toEqual([{ category: 'tech_interview', summary: 'nightly build broke after bump' }]);

    // The model must still return it: the category pickCategory would have chosen is refused, twice, and nothing is saved.
    const other = new MemoryStudyStore();
    const wrong = new FakeProvider([reply('daily_update'), reply('daily_update')]);
    const strict = new ChallengeGenerator({ provider: wrong, store: other, clock, challengeTemplate, rng: () => 0 });
    await expect(strict.next(learner, signal, undefined, { category: 'tech_interview' })).rejects.toMatchObject({ kind: 'invalid_output' });
    expect(wrong.calls[1]!.user).toContain('category must be "tech_interview"');
    expect(other.recentChallenges(5)).toEqual([]);
  });

  test('without an override nothing changes: pickCategory still chooses', async () => {
    const rng = vi.fn(() => 0.99);
    const provider = new FakeProvider([reply('tech_interview')]);
    const gen = new ChallengeGenerator({ provider, store: new MemoryStudyStore(), clock, challengeTemplate, rng });
    expect((await gen.next(learner, signal)).category).toBe('tech_interview');
    expect(rng).toHaveBeenCalledTimes(1);
  });
});
