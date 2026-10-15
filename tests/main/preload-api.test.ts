import { buildApi } from '../../src/preload/api';
import { PROGRESS_EVENT } from '../../src/shared/ipc-contract';

test('exposes exactly the spec groups', () => {
  const api = buildApi(async () => ({ ok: true, data: null }), () => () => {});
  expect(Object.keys(api).sort()).toEqual([
    'challenges', 'feedback', 'keys', 'llm', 'llmCheck', 'moderation', 'profile', 'progress', 'review', 'safety', 'settings', 'social',
  ]);
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
  await api.feedback.get(7);
  await api.challenges.pending();
  expect(calls).toEqual([
    ['keys:set', { key: 'k' }],
    ['keys:status', {}],
    ['challenges:next', { requestId: 'r1' }],
    ['feedback:submit', { requestId: 'r2', challengeId: 3, text: 't' }],
    ['feedback:cancel', { requestId: 'r2' }],
    ['review:rate', { expressionId: 1, rating: 'good' }],
    ['progress:history', { before: null }],
    ['settings:set', { theme: 'dark' }],
    ['feedback:get', { feedbackId: 7 }],
    ['challenges:pending', {}],
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

test('social, safety and moderation methods map to their channels', async () => {
  const calls: [string, unknown][] = [];
  const api = buildApi(async (channel, payload) => {
    calls.push([channel, payload]);
    return { ok: true, data: null };
  }, () => () => {});
  const bytes = new Uint8Array([1, 2]);
  await api.social.status();
  await api.social.sendCode('a@b.co');
  await api.social.verifyCode('a@b.co', '123456');
  await api.social.acceptDocuments();
  await api.social.getProfile();
  await api.social.setAvatar(bytes);
  await api.social.removeAvatar();
  await api.social.avatar('u1');
  await api.social.notices();
  await api.social.readNotice(3);
  await api.social.signOut();
  await api.social.exportData(true);
  await api.social.deleteAccount({ confirmEmail: 'a@b.co', deleteLocal: false });
  await api.safety.block('u2');
  await api.safety.unblock('u2');
  await api.moderation.isModerator();
  await api.moderation.reports();
  await api.moderation.history('u3');
  await api.moderation.decide({ kind: 'dismiss', reportId: 4 });
  await api.social.badges('u4');
  await api.social.practiceGraph('u4');
  await api.social.setBanner(bytes);
  await api.social.removeBanner();
  await api.social.banner('u4');
  await api.moderation.searchMembers('al');
  await api.moderation.grantBadge({ userId: 'u5', badge: 'mentor', reason: 'r' });
  await api.moderation.revokeBadge({ userId: 'u5', badge: 'mentor', reason: 'r' });
  await api.progress.graph();
  expect(calls).toEqual([
    ['social:status', {}],
    ['social:sendCode', { email: 'a@b.co' }],
    ['social:verifyCode', { email: 'a@b.co', code: '123456' }],
    ['social:acceptDocuments', {}],
    ['social:getProfile', {}],
    ['social:setAvatar', { bytes }],
    ['social:removeAvatar', {}],
    ['social:avatar', { userId: 'u1' }],
    ['social:notices', {}],
    ['social:readNotice', { id: 3 }],
    ['social:signOut', {}],
    ['social:export', { includeLocal: true }],
    ['social:deleteAccount', { confirmEmail: 'a@b.co', deleteLocal: false }],
    ['safety:block', { userId: 'u2' }],
    ['safety:unblock', { userId: 'u2' }],
    ['moderation:isModerator', {}],
    ['moderation:reports', {}],
    ['moderation:history', { userId: 'u3' }],
    ['moderation:decide', { kind: 'dismiss', reportId: 4 }],
    ['social:badges', { userId: 'u4' }],
    ['social:practiceGraph', { userId: 'u4' }],
    ['social:setBanner', { bytes }],
    ['social:removeBanner', {}],
    ['social:banner', { userId: 'u4' }],
    ['moderation:searchMembers', { query: 'al' }],
    ['moderation:grantBadge', { userId: 'u5', badge: 'mentor', reason: 'r' }],
    ['moderation:revokeBadge', { userId: 'u5', badge: 'mentor', reason: 'r' }],
    ['progress:graph', {}],
  ]);
});
