import { meshPlan } from '../../src/renderer/lib/mesh';

test('the smaller id offers and the larger one waits', () => {
  expect(meshPlan('b', ['a', 'b', 'c'], [])).toEqual({ offer: ['c'], await: ['a'], drop: [] });
  expect(meshPlan('a', ['c', 'a', 'b'], [])).toEqual({ offer: ['b', 'c'], await: [], drop: [] });
  expect(meshPlan('c', ['a', 'b', 'c'], [])).toEqual({ offer: [], await: ['a', 'b'], drop: [] });
});

test('people already connected are left alone; people who left are dropped', () => {
  expect(meshPlan('b', ['a', 'b', 'd'], ['a', 'c'])).toEqual({ offer: ['d'], await: [], drop: ['c'] });
  expect(meshPlan('b', ['b'], ['a', 'c'])).toEqual({ offer: [], await: [], drop: ['a', 'c'] });
  expect(meshPlan('b', ['a', 'b', 'c'], ['a', 'c'])).toEqual({ offer: [], await: [], drop: [] });
});

test('never plans a connection to yourself, and a name listed twice counts once', () => {
  expect(meshPlan('b', ['b', 'c', 'c', 'a', 'a'], [])).toEqual({ offer: ['c'], await: ['a'], drop: [] });
  expect(meshPlan('b', [], ['b'])).toEqual({ offer: [], await: [], drop: [] });
  expect(meshPlan('b', [], [])).toEqual({ offer: [], await: [], drop: [] });
});

test('every pair has exactly one offerer', () => {
  const ids = ['3f0c', '0a1b', 'ffee', '7d2e', '0a1c'];
  for (const me of ids) {
    for (const other of ids.filter((id) => id !== me)) {
      const mine = meshPlan(me, ids, []);
      const theirs = meshPlan(other, ids, []);
      expect(mine.offer.includes(other)).toBe(theirs.await.includes(me));
      expect(mine.offer.includes(other)).not.toBe(theirs.offer.includes(me));
    }
  }
});
