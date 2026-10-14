import { buildProgressSummary, endOfLocalDay } from '../../src/core/progress/summary';
import { newCard, rate } from '../../src/core/srs/srs';
import { MemoryStudyStore } from '../../src/core/testing/memory-store';

const ORIGINAL_TZ = process.env['TZ'];
afterEach(() => {
  process.env['TZ'] = ORIGINAL_TZ;
});

test('endOfLocalDay uses the local time zone', () => {
  process.env['TZ'] = 'America/Bahia'; // UTC-3, no DST
  expect(endOfLocalDay(new Date('2026-10-13T15:00:00.000Z')).toISOString()).toBe('2026-10-14T02:59:59.999Z');
});

test('progress summary', () => {
  process.env['TZ'] = 'America/Bahia';
  const now = new Date('2026-10-13T15:00:00.000Z'); // 12:00 local
  const store = new MemoryStudyStore();
  const old = new Date(now.getTime() - 40 * 86_400_000);
  const saved = store.saveFeedback({
    attempt: { challengeId: null, text: 'a', source: 'typed' },
    feedback: { naturalRewrite: 'a', provider: 'fake', model: 'fake', latencyMs: 0, rawJson: '{}' },
    corrections: [{ original: 'a', corrected: 'b', explanation: 'x', category: 'articles' }],
    newExpressions: ['late tonight', 'tomorrow', 'used'].map((t) => ({ text: t, normalizedText: t, type: 'chunk' as const, meaning: 'm', example: 'e' })),
    checks: [],
    initialCard: newCard(old),
    now: old,
  });
  const [tonight, tomorrow, used] = saved.expressions.map((e) => e.expression.id);
  const base = rate(newCard(old), 'good', old);
  store.saveReview(tonight!, { ...base.card, due: new Date('2026-10-14T02:30:00.000Z') }, base.log); // 23:30 local
  store.saveReview(tomorrow!, { ...base.card, due: new Date('2026-10-14T03:30:00.000Z') }, base.log); // 00:30 next day
  store.saveReview(used!, { ...base.card, due: new Date('2026-12-01T00:00:00.000Z') }, base.log);
  store.saveFeedback({
    attempt: { challengeId: null, text: 'b', source: 'typed' },
    feedback: { naturalRewrite: 'b', provider: 'fake', model: 'fake', latencyMs: 0, rawJson: '{}' },
    corrections: [
      { original: 'a', corrected: 'b', explanation: 'x', category: 'prepositions' },
      { original: 'a', corrected: 'b', explanation: 'x', category: 'prepositions' },
      { original: 'a', corrected: 'b', explanation: 'x', category: 'articles' },
    ],
    newExpressions: [],
    checks: [{ expressionId: used!, used: true, usedCorrectly: true, note: '' }],
    initialCard: newCard(now),
    now,
  });

  expect(buildProgressSummary(store, now)).toEqual({
    dueToday: 1,
    totalExpressions: 3,
    reusedExpressions: 1,
    mistakes: [
      { category: 'articles', last30Days: 1, total: 2 },
      { category: 'prepositions', last30Days: 2, total: 2 },
    ],
  });
});
