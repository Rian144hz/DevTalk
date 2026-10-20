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

test('people pages: tabs, edit, another member and their lists', () => {
  const id = '00000000-0000-4000-8000-000000000012';
  expect(parseHash('#/people')).toEqual({ name: 'people' });
  expect(parseHash('#/people/me')).toEqual({ name: 'people', sub: 'me' });
  expect(parseHash('#/people/following')).toEqual({ name: 'people', sub: 'following' });
  expect(parseHash(`#/people/u/${id}`)).toEqual({ name: 'people', userId: id });
  expect(parseHash(`#/people/u/${id}/followers`)).toEqual({ name: 'people', userId: id, list: 'followers' });
  expect(parseHash(`#/people/u/${id}/following`)).toEqual({ name: 'people', userId: id, list: 'following' });
  expect(parseHash(`#/people/u/${id}/likes`)).toEqual({ name: 'people', userId: id });
  for (const r of [{ name: 'people', userId: id }, { name: 'people', userId: id, list: 'followers' }, { name: 'people', sub: 'me' }] as const) {
    expect(parseHash(toHash(r))).toEqual(r);
  }
});

test('a user id that is not a uuid falls back to the member list', () => {
  expect(parseHash('#/people/u/not-a-uuid')).toEqual({ name: 'people' });
  expect(parseHash('#/people/u/')).toEqual({ name: 'people' });
  expect(parseHash("#/people/u/'%3Cscript%3E")).toEqual({ name: 'people' });
});

test('messages: the list, one conversation and a new message to someone', () => {
  const id = '00000000-0000-4000-8000-000000000042';
  expect(parseHash('#/messages')).toEqual({ name: 'messages' });
  expect(parseHash(`#/messages/${id}`)).toEqual({ name: 'messages', conversationId: id });
  expect(parseHash(`#/messages/to/${id}`)).toEqual({ name: 'messages', to: id });
  expect(parseHash('#/messages/not-a-uuid')).toEqual({ name: 'messages' });
  expect(parseHash('#/messages/to/nope')).toEqual({ name: 'messages' });
  for (const r of [{ name: 'messages' }, { name: 'messages', conversationId: id }, { name: 'messages', to: id }] as const) {
    expect(parseHash(toHash(r))).toEqual(r);
  }
});
