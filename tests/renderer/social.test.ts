import { applyFollow, applyLike, followersText, followingText, likesText } from '../../src/renderer/lib/social';

const base = { followers: 2, following: 1, likes: 0, iFollow: false, iLike: false };

test('following counts once, and undoing never goes below zero', () => {
  const on = applyFollow(base, true);
  expect(on).toEqual({ ...base, followers: 3, iFollow: true });
  expect(applyFollow(on, true)).toEqual(on);
  expect(applyFollow(on, false)).toEqual(base);
  expect(applyFollow({ ...base, followers: 0, iFollow: true }, false)).toMatchObject({ followers: 0, iFollow: false });
  expect(applyFollow(base, false)).toEqual(base);
});

test('liking counts once, and undoing never goes below zero', () => {
  const on = applyLike(base, true);
  expect(on).toEqual({ ...base, likes: 1, iLike: true });
  expect(applyLike(on, true)).toEqual(on);
  expect(applyLike(on, false)).toEqual(base);
  expect(applyLike({ ...base, likes: 0, iLike: true }, false)).toMatchObject({ likes: 0, iLike: false });
});

test('counts read naturally', () => {
  expect(followersText(1)).toBe('1 follower');
  expect(followersText(2)).toBe('2 followers');
  expect(followersText(0)).toBe('0 followers');
  expect(followingText(5)).toBe('5 following');
  expect(likesText(1)).toBe('1 like');
  expect(likesText(12)).toBe('12 likes');
});
