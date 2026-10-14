import { parseHash, toHash } from '../../src/renderer/lib/router';

test('parses known routes with optional ids', () => {
  expect(parseHash('#/feedback/12')).toEqual({ name: 'feedback', id: 12 });
  expect(parseHash('#/review')).toEqual({ name: 'review' });
  expect(parseHash('')).toEqual({ name: 'home' });
  expect(parseHash('#/nope')).toEqual({ name: 'home' });
  expect(parseHash('#/feedback/abc')).toEqual({ name: 'feedback' });
});

test('round-trips', () => {
  for (const r of [{ name: 'home' }, { name: 'feedback', id: 3 }, { name: 'settings' }] as const) {
    expect(parseHash(toHash(r))).toEqual(r);
  }
});
