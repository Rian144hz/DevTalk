import { buildApi } from '../../src/preload/api';
import { PROGRESS_EVENT } from '../../src/shared/ipc-contract';

test('exposes exactly the spec groups', () => {
  const api = buildApi(async () => ({ ok: true, data: null }), () => () => {});
  expect(Object.keys(api).sort()).toEqual(['challenges', 'feedback', 'keys', 'llm', 'profile', 'progress', 'review', 'settings']);
});

test('methods invoke the right channel with the right payload', async () => {
  const calls: [string, unknown][] = [];
  const api = buildApi(async (channel, payload) => {
    calls.push([channel, payload]);
    return { ok: true, data: null };
  }, () => () => {});
  await api.keys.set('k');
  await api.keys.status();
  await api.challenges.next('r1');
  await api.feedback.submit({ requestId: 'r2', challengeId: 3, text: 't' });
  await api.feedback.cancel('r2');
  await api.review.rate({ expressionId: 1, rating: 'good' });
  await api.progress.history({ before: null });
  await api.settings.set({ theme: 'dark' });
  expect(calls).toEqual([
    ['keys:set', { key: 'k' }],
    ['keys:status', {}],
    ['challenges:next', { requestId: 'r1' }],
    ['feedback:submit', { requestId: 'r2', challengeId: 3, text: 't' }],
    ['feedback:cancel', { requestId: 'r2' }],
    ['review:rate', { expressionId: 1, rating: 'good' }],
    ['progress:history', { before: null }],
    ['settings:set', { theme: 'dark' }],
  ]);
});

test('onProgress subscribes to the progress event and returns the unsubscribe', () => {
  const unsubscribe = () => {};
  let subscribed = '';
  const api = buildApi(async () => ({ ok: true, data: null }), (event) => {
    subscribed = event;
    return unsubscribe;
  });
  expect(api.llm.onProgress(() => {})).toBe(unsubscribe);
  expect(subscribed).toBe(PROGRESS_EVENT);
});
