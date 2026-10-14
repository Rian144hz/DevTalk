import type { SaveFeedbackInput, StudyStore } from '../../src/core/ports';
import { newCard, rate } from '../../src/core/srs/srs';

const t0 = new Date('2026-10-13T12:00:00.000Z');
const at = (days: number) => new Date(t0.getTime() + days * 86_400_000);

const profile = {
  nativeLanguage: 'Portuguese', currentLevel: 'B1' as const, targetLevel: 'B2' as const,
  explanationLanguage: 'Portuguese', provider: 'anthropic', model: 'claude-opus-5-5', theme: 'system' as const,
};

function feedbackInput(over: Partial<SaveFeedbackInput> = {}): SaveFeedbackInput {
  return {
    attempt: { challengeId: null, text: 'I have fixed the bug yesterday.', source: 'typed' },
    feedback: { naturalRewrite: 'I fixed the bug yesterday.', provider: 'fake', model: 'fake', latencyMs: 10, rawJson: '{}' },
    corrections: [{ original: 'have fixed', corrected: 'fixed', explanation: 'past', category: 'verb_tense' }],
    newExpressions: [
      { text: 'Push back on', normalizedText: 'push back on', type: 'phrasal_verb', meaning: 'm', example: 'e' },
      { text: 'root cause', normalizedText: 'root cause', type: 'collocation', meaning: 'm', example: 'e' },
    ],
    checks: [],
    initialCard: newCard(t0),
    now: t0,
    ...over,
  };
}

export function runStudyStoreContract(name: string, makeStore: () => StudyStore): void {
  describe(`StudyStore contract: ${name}`, () => {
    let store: StudyStore;
    beforeEach(() => {
      store = makeStore();
    });

    test('profile round-trip; onboardedAt kept on later saves', () => {
      expect(store.getProfile()).toBeNull();
      store.saveProfile(profile, t0);
      expect(store.getProfile()).toEqual({ ...profile, onboardedAt: t0.toISOString() });
      store.saveProfile({ ...profile, theme: 'dark' }, at(1));
      expect(store.getProfile()).toMatchObject({ theme: 'dark', onboardedAt: t0.toISOString() });
    });

    test('challenges with required expressions; recent newest first', () => {
      const saved = store.saveFeedback(feedbackInput());
      const exprId = saved.expressions[0]!.expression.id;
      const c1 = store.saveChallenge(
        { category: 'daily_update', situation: 's1', interlocutor: 'i', task: 't', summary: 'one', required: [{ expressionId: exprId, hint: 'h' }] },
        t0,
      );
      store.saveChallenge({ category: 'code_review', situation: 's2', interlocutor: 'i', task: 't', summary: 'two', required: [] }, at(1));
      expect(c1.required).toEqual([{ expression: saved.expressions[0]!.expression, hint: 'h' }]);
      expect(c1.createdAt).toBe(t0.toISOString());
      expect(store.getChallenge(c1.id)).toEqual(c1);
      expect(store.getChallenge(9999)).toBeNull();
      expect(store.recentChallenges(8)).toEqual([
        { category: 'code_review', summary: 'two' },
        { category: 'daily_update', summary: 'one' },
      ]);
      expect(store.recentChallenges(1)).toHaveLength(1);
    });

    test('new expressions get new cards; duplicates by normalizedText are reused', () => {
      const first = store.saveFeedback(feedbackInput());
      expect(first.expressions.map((e) => e.isNew)).toEqual([true, true]);
      expect(first.expressions[0]!.expression).toMatchObject({ text: 'Push back on', type: 'phrasal_verb' });
      expect(store.getCard(first.expressions[0]!.expression.id)).toMatchObject({ state: 'new' });
      const second = store.saveFeedback(
        feedbackInput({
          newExpressions: [{ text: 'push back on.', normalizedText: 'push back on', type: 'phrasal_verb', meaning: 'x', example: 'y' }],
          now: at(1),
        }),
      );
      expect(second.expressions).toEqual([{ expression: first.expressions[0]!.expression, isNew: false }]);
      expect(store.expressionCount()).toBe(2);
    });

    test('mistake counts sorted desc and filtered by date', () => {
      store.saveFeedback(feedbackInput({ now: at(-40) }));
      store.saveFeedback(
        feedbackInput({
          corrections: [
            { original: 'a', corrected: 'b', explanation: 'x', category: 'articles' },
            { original: 'c', corrected: 'd', explanation: 'x', category: 'articles' },
          ],
          now: t0,
        }),
      );
      expect(store.mistakeCounts(null)).toEqual([
        { category: 'articles', count: 2 },
        { category: 'verb_tense', count: 1 },
      ]);
      expect(store.mistakeCounts(at(-30))).toEqual([{ category: 'articles', count: 2 }]);
    });

    test('saveFeedback is atomic', () => {
      expect(() => store.saveFeedback(feedbackInput({ checks: [{ expressionId: 4242, used: true, usedCorrectly: true, note: '' }] }))).toThrow();
      expect(store.history({ before: null, limit: 10 })).toEqual([]);
      expect(store.expressionCount()).toBe(0);
      expect(store.mistakeCounts(null)).toEqual([]);
    });

    test('dueCards skips new cards when asked, limits, most overdue first', () => {
      const saved = store.saveFeedback(
        feedbackInput({
          newExpressions: ['a', 'b', 'c', 'd'].map((t) => ({ text: t, normalizedText: t, type: 'chunk' as const, meaning: 'm', example: 'e' })),
        }),
      );
      const [a, b, c] = saved.expressions.map((e) => e.expression.id);
      // a reviewed long ago (most overdue), b later, c just now; d never reviewed (state new)
      for (const [id, when] of [[a!, at(-20)], [b!, at(-10)], [c!, t0]] as const) {
        const r = rate(newCard(when), 'good', when);
        store.saveReview(id, r.card, r.log);
      }
      const due = store.dueCards(at(1), { excludeNew: true, limit: 2 });
      expect(due.map((d) => d.expression.text)).toEqual(['a', 'b']);
      expect(due[0]!.card.state).not.toBe('new');
      expect(store.dueCards(at(1), { excludeNew: false, limit: 10 }).map((d) => d.expression.text)).toContain('d');
      expect(store.countDue(at(1))).toBeGreaterThanOrEqual(3);
    });

    test('saveReview updates the stored card', () => {
      const id = store.saveFeedback(feedbackInput()).expressions[0]!.expression.id;
      const r = rate(store.getCard(id)!, 'easy', t0);
      store.saveReview(id, r.card, r.log);
      expect(store.getCard(id)).toEqual(r.card);
      expect(store.getCard(9999)).toBeNull();
    });

    test('reusedExpressionCount counts distinct correct uses', () => {
      const saved = store.saveFeedback(feedbackInput());
      const [x, y] = saved.expressions.map((e) => e.expression.id);
      store.saveFeedback(feedbackInput({ newExpressions: [], checks: [{ expressionId: x!, used: true, usedCorrectly: true, note: '' }] }));
      store.saveFeedback(feedbackInput({ newExpressions: [], checks: [{ expressionId: x!, used: true, usedCorrectly: true, note: '' }] }));
      store.saveFeedback(feedbackInput({ newExpressions: [], checks: [{ expressionId: y!, used: true, usedCorrectly: false, note: '' }] }));
      expect(store.reusedExpressionCount()).toBe(1);
    });

    test('getFeedback returns everything saveFeedback stored', () => {
      const seed = store.saveFeedback(feedbackInput());
      const [x] = seed.expressions.map((e) => e.expression);
      const ch = store.saveChallenge(
        { category: 'code_review', situation: 's', interlocutor: 'i', task: 't', summary: 'sum', required: [{ expressionId: x!.id, hint: 'h' }] },
        at(1),
      );
      const saved = store.saveFeedback(
        feedbackInput({
          attempt: { challengeId: ch.id, text: 'My answer.', source: 'typed' },
          corrections: [
            { original: 'a', corrected: 'b', explanation: 'first', category: 'articles' },
            { original: 'c', corrected: 'd', explanation: 'second', category: 'verb_tense' },
          ],
          newExpressions: [
            { text: 'zero in on', normalizedText: 'zero in on', type: 'phrasal_verb', meaning: 'm', example: 'e' },
            { text: 'push back on', normalizedText: 'push back on', type: 'phrasal_verb', meaning: 'm', example: 'e' },
          ],
          checks: [{ expressionId: x!.id, used: true, usedCorrectly: false, note: 'close' }],
          now: at(2),
        }),
      );
      const fb = store.getFeedback(saved.feedbackId)!;
      expect(fb).toMatchObject({
        feedbackId: saved.feedbackId, attemptId: saved.attemptId, createdAt: at(2).toISOString(),
        text: 'My answer.', naturalRewrite: 'I fixed the bug yesterday.',
      });
      expect(fb.challenge).toEqual(store.getChallenge(ch.id));
      expect(fb.corrections.map((c) => c.explanation)).toEqual(['first', 'second']);
      expect(fb.expressions.map((e) => e.text)).toEqual(['zero in on', 'Push back on']);
      expect(fb.requiredChecks).toEqual([{ expression: x, used: true, usedCorrectly: false, note: 'close' }]);
      expect(store.getFeedback(9999)).toBeNull();
    });

    test('pendingChallenge is the newest challenge without an answer', () => {
      expect(store.pendingChallenge()).toBeNull();
      store.saveChallenge({ category: 'daily_update', situation: 's', interlocutor: 'i', task: 't', summary: 'old', required: [] }, t0);
      const newer = store.saveChallenge({ category: 'code_review', situation: 's', interlocutor: 'i', task: 't', summary: 'new', required: [] }, at(1));
      expect(store.pendingChallenge()?.id).toBe(newer.id);
      store.saveFeedback(feedbackInput({ attempt: { challengeId: newer.id, text: 'x', source: 'typed' }, newExpressions: [] }));
      expect(store.pendingChallenge()?.summary).toBe('old');
    });

    test('nextDueAt is the earliest due card', () => {
      expect(store.nextDueAt()).toBeNull();
      const saved = store.saveFeedback(feedbackInput());
      const [a, b] = saved.expressions.map((e) => e.expression.id);
      const r = rate(newCard(t0), 'good', t0);
      store.saveReview(a!, { ...r.card, due: at(5) }, r.log);
      store.saveReview(b!, { ...r.card, due: at(3) }, r.log);
      expect(store.nextDueAt()).toEqual(at(3));
    });

    test('history newest first with cursor pagination', () => {
      const ch = store.saveChallenge({ category: 'bug_explanation', situation: 's', interlocutor: 'i', task: 't', summary: 'x', required: [] }, t0);
      store.saveFeedback(feedbackInput({ now: at(1) }));
      store.saveFeedback(feedbackInput({ attempt: { challengeId: ch.id, text: 'second', source: 'typed' }, corrections: [], now: at(2) }));
      store.saveFeedback(feedbackInput({ now: at(3) }));
      const page1 = store.history({ before: null, limit: 2 });
      expect(page1.map((h) => h.createdAt)).toEqual([at(3).toISOString(), at(2).toISOString()]);
      expect(page1[1]).toMatchObject({ category: 'bug_explanation', text: 'second', correctionCount: 0 });
      expect(page1[0]).toMatchObject({ category: null, correctionCount: 1 });
      const page2 = store.history({ before: page1[1]!.createdAt, limit: 2 });
      expect(page2.map((h) => h.createdAt)).toEqual([at(1).toISOString()]);
    });
  });
}
