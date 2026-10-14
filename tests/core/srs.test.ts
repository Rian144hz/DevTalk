import { newCard, previewDue, rate, type SrsCard } from '../../src/core/srs/srs';

const t0 = new Date('2026-10-13T12:00:00Z');

test('new card is due now and in state new', () => {
  expect(newCard(t0)).toMatchObject({ state: 'new', reps: 0, lapses: 0, due: t0, lastReview: null });
});

test('good on a new card leaves state new and schedules in the future', () => {
  const { card, log } = rate(newCard(t0), 'good', t0);
  expect(card.state).not.toBe('new');
  expect(card.reps).toBe(1);
  expect(card.lastReview).toEqual(t0);
  expect(card.due.getTime()).toBeGreaterThan(t0.getTime());
  expect(log).toMatchObject({ rating: 'good', state: 'new', review: t0 });
});

test('preview is ordered again <= hard <= good <= easy', () => {
  const p = previewDue(rate(newCard(t0), 'good', t0).card, new Date('2026-10-20T12:00:00Z'));
  expect(p.again <= p.hard && p.hard <= p.good && p.good <= p.easy).toBe(true);
});

test('again on a review card increments lapses and relearns', () => {
  let card: SrsCard = newCard(t0);
  let now = t0;
  for (let i = 0; i < 10 && card.state !== 'review'; i++) {
    card = rate(card, 'good', now).card;
    now = card.due;
  }
  expect(card.state).toBe('review');
  const after = rate(card, 'again', now).card;
  expect(after.lapses).toBe(1);
  expect(after.state).toBe('relearning');
});

test('scheduling is deterministic (no fuzz)', () => {
  const a = rate(rate(newCard(t0), 'good', t0).card, 'easy', new Date('2026-10-14T12:00:00Z')).card;
  const b = rate(rate(newCard(t0), 'good', t0).card, 'easy', new Date('2026-10-14T12:00:00Z')).card;
  expect(a.due).toEqual(b.due);
});
