import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChallengeGenerator } from '../../src/core/challenges/generator';
import { FeedbackEngine } from '../../src/core/feedback/engine';
import { newCard, rate } from '../../src/core/srs/srs';
import { MemoryStudyStore } from '../../src/core/testing/memory-store';
import { createFixtureProvider } from '../../src/main/llm/fake-fixtures';

const learner = { nativeLanguage: 'Portuguese', currentLevel: 'B1' as const, targetLevel: 'B2' as const, explanationLanguage: 'Portuguese' };
const t0 = new Date('2026-10-13T12:00:00.000Z');
const clock = { now: () => t0 };
const tpl = (n: string) => readFileSync(join(__dirname, '../../prompts', n), 'utf8');
const signal = new AbortController().signal;

test('fixture provider satisfies the generator and the engine, echoing required expressions', async () => {
  const store = new MemoryStudyStore();
  const provider = createFixtureProvider();
  const first = await new FeedbackEngine({ provider, store, clock, coachTemplate: tpl('coach.md') })
    .review({ text: 'I have fixed it.', source: 'typed', context: { kind: 'free' }, learner }, signal);
  for (const { expression } of first.newExpressions) {
    const r = rate(newCard(new Date(t0.getTime() - 86_400_000)), 'good', new Date(t0.getTime() - 86_400_000));
    store.saveReview(expression.id, r.card, r.log);
  }
  const challenge = await new ChallengeGenerator({ provider, store, clock, challengeTemplate: tpl('challenge.md'), rng: () => 0 })
    .next(learner, signal);
  expect(challenge.required).toHaveLength(2);
  const fb = await new FeedbackEngine({ provider, store, clock, coachTemplate: tpl('coach.md') })
    .review({ text: 'x', source: 'typed', context: { kind: 'challenge', challenge }, learner }, signal);
  expect(fb.requiredChecks).toHaveLength(2);
  expect(provider.id).toBe('fake');
});
