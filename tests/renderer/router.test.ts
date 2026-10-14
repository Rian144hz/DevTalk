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

test('sub-pages are kept only where they exist', () => {
  expect(parseHash('#/people/edit')).toEqual({ name: 'people', sub: 'edit' });
  expect(parseHash('#/legal/privacy')).toEqual({ name: 'legal', sub: 'privacy' });
  expect(parseHash('#/legal/nope')).toEqual({ name: 'legal' });
  expect(parseHash('#/review/edit')).toEqual({ name: 'review' });
  expect(parseHash('#/join')).toEqual({ name: 'join' });
  expect(toHash({ name: 'people', sub: 'edit' })).toBe('#/people/edit');
});
