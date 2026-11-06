import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChallengeGenerator } from '../../src/core/challenges/generator';
import { TextChecker } from '../../src/core/check/checker';
import { CheckSchema } from '../../src/core/check/schema';
import { CHECK_TYPES, CHECK_TYPE_LABELS } from '../../src/core/check/types';
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

test('the check reply passes CheckSchema, opens with "Hey" for Slack and "Hello" for E-mail, and fails with rate_limited for text that says "rate limit"', async () => {
  const provider = createFixtureProvider();
  const checker = new TextChecker({ provider, template: tpl('check.md') });
  const text = 'Yesterday I have fixed the flaky test. We need to discuss about the shared row.';

  const slack = await checker.check({ type: 'slack', text, learner }, signal);
  const email = await checker.check({ type: 'email', text, learner }, signal);
  expect(slack.naturalRewrite).toMatch(/^Hey\b/);
  expect(email.naturalRewrite).toMatch(/^Hello\b/);
  // Both marks land in the text (the screen shows two edits) and the coach offers two expressions.
  for (const result of [slack, email]) {
    expect(result.corrections.map((c) => c.original)).toEqual(['have fixed', 'discuss about']);
    for (const c of result.corrections) expect(text).toContain(c.original);
    expect(result.expressions).toHaveLength(2);
  }
  // Every type gets a reply that passes the schema; only Slack and E-mail open with a greeting.
  for (const type of CHECK_TYPES) {
    const raw = await provider.generateJson({
      system: '', user: `Text type: ${CHECK_TYPE_LABELS[type]}\n\n"""\n${text}\n"""`, schema: CheckSchema, schemaName: 'check', signal,
    });
    const parsed = CheckSchema.safeParse(JSON.parse(raw));
    expect(parsed.success, type).toBe(true);
    if (type !== 'slack' && type !== 'email') expect(parsed.data!.natural_rewrite, type).not.toMatch(/^(Hey|Hello)\b/);
  }

  // The same trigger as the feedback fixture: a text about a "rate limit" behaves like a provider out of quota.
  await expect(checker.check({ type: 'slack', text: 'I hit the rate limit on staging.', learner }, signal)).rejects.toMatchObject({ kind: 'rate_limited' });
  await expect(checker.check({ type: 'email', text: 'The Rate Limit is too low.', learner }, signal)).rejects.toMatchObject({ kind: 'rate_limited' });
});
