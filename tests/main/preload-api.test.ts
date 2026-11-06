import { buildApi } from '../../src/preload/api';
import { CHAT_EVENT, PROGRESS_EVENT, ROOM_EVENT } from '../../src/shared/ipc-contract';

test('exposes exactly the spec groups', () => {
  const api = buildApi(async () => ({ ok: true, data: null }), () => () => {});
  expect(Object.keys(api).sort()).toEqual([
    'challenges', 'chat', 'check', 'feedback', 'keys', 'llm', 'llmCheck', 'moderation', 'profile', 'progress', 'review', 'rooms', 'safety', 'settings', 'social',
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

test('check.run, check.cancel and review.keep call their channels', async () => {
  const calls: [string, unknown][] = [];
  const api = buildApi(async (channel, payload) => {
    calls.push([channel, payload]);
    return { ok: true, data: null };
  }, () => () => {});
  await api.check.run({ requestId: 'k1', type: 'slack', text: 'Hi team' });
  await api.check.cancel('k1');
  await api.review.keep({ text: 'track down', type: 'phrasal_verb', meaning: 'find', example: 'We track down bugs.' });
  expect(calls).toEqual([
    ['check:run', { requestId: 'k1', type: 'slack', text: 'Hi team' }],
    ['check:cancel', { requestId: 'k1' }],
    ['review:keep', { text: 'track down', type: 'phrasal_verb', meaning: 'find', example: 'We track down bugs.' }],
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
  await api.social.members({ level: 'B1', page: 0 });
  await api.social.profileOf('u6');
  await api.social.socialStats('u6');
  await api.social.follow('u6');
  await api.social.unfollow('u6');
  await api.social.like('u6');
  await api.social.unlike('u6');
  await api.social.followers('u6', 1);
  await api.social.following('u6', 0);
  await api.social.signInWithGitHub();
  await api.social.cancelSignIn();
  await api.social.githubSuggestion();
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
    ['social:members', { level: 'B1', page: 0 }],
    ['social:profileOf', { userId: 'u6' }],
    ['social:socialStats', { userId: 'u6' }],
    ['social:follow', { userId: 'u6' }],
    ['social:unfollow', { userId: 'u6' }],
    ['social:like', { userId: 'u6' }],
    ['social:unlike', { userId: 'u6' }],
    ['social:followers', { userId: 'u6', page: 1 }],
    ['social:following', { userId: 'u6', page: 0 }],
    ['social:signInWithGitHub', {}],
    ['social:cancelSignIn', {}],
    ['social:githubSuggestion', {}],
  ]);
});

test('chat methods map to their channels and onEvent listens to the chat event', async () => {
  const calls: [string, unknown][] = [];
  let subscribed = '';
  const unsubscribe = () => {};
  const api = buildApi(async (channel, payload) => {
    calls.push([channel, payload]);
    return { ok: true, data: null };
  }, (event) => {
    subscribed = event;
    return unsubscribe;
  });
  await api.chat.conversations();
  await api.chat.messages('c1', null);
  await api.chat.messages('c1', 40);
  await api.chat.request('u2', 'Hi!');
  await api.chat.respond('c1', true);
  await api.chat.send('c1', 'Hello');
  await api.chat.delete(5);
  await api.chat.correct(6, 'I have');
  await api.chat.thank(7);
  await api.chat.read('c1');
  await api.chat.check('I has');
  await api.moderation.reportContext(9);
  expect(calls).toEqual([
    ['chat:conversations', {}],
    ['chat:messages', { conversationId: 'c1', before: null }],
    ['chat:messages', { conversationId: 'c1', before: 40 }],
    ['chat:request', { userId: 'u2', body: 'Hi!' }],
    ['chat:respond', { conversationId: 'c1', accept: true }],
    ['chat:send', { conversationId: 'c1', body: 'Hello' }],
    ['chat:delete', { messageId: 5 }],
    ['chat:correct', { messageId: 6, corrected: 'I have' }],
    ['chat:thank', { correctionId: 7 }],
    ['chat:read', { conversationId: 'c1' }],
    ['chat:check', { text: 'I has' }],
    ['moderation:reportContext', { reportId: 9 }],
  ]);
  expect(api.chat.onEvent(() => {})).toBe(unsubscribe);
  expect(subscribed).toBe(CHAT_EVENT);
});

test('room methods map to their channels and onEvent listens to the room event', async () => {
  const calls: [string, unknown][] = [];
  let subscribed = '';
  const unsubscribe = () => {};
  const api = buildApi(async (channel, payload) => {
    calls.push([channel, payload]);
    return { ok: true, data: null };
  }, (event) => {
    subscribed = event;
    return unsubscribe;
  });
  await api.rooms.list();
  await api.rooms.create({ title: 'Code review night', theme: 'code_review', level: 'B2' });
  await api.rooms.create({ title: 'Free talk', theme: 'free', level: null });
  await api.rooms.join('r1');
  await api.rooms.leave('r1');
  await api.rooms.state('r1');
  await api.rooms.signal('r1', 'u2', 'offer', 'sdp');
  await api.rooms.makeModerator('r1', 'u2');
  await api.rooms.removeModerator('r1', 'u2');
  await api.rooms.passHost('r1', 'u2');
  await api.rooms.mute('r1', 'u2');
  await api.rooms.remove('r1', 'u2');
  await api.rooms.end('r1');
  await api.rooms.timer('r1', 60);
  await api.rooms.timer('r1', null);
  await api.rooms.nextCard('r1');
  await api.rooms.setMuted('r1', true);
  await api.rooms.setMuted('r1', false);
  await api.rooms.settings();
  await api.moderation.roomContext(9);
  expect(calls).toEqual([
    ['rooms:list', {}],
    ['rooms:create', { title: 'Code review night', theme: 'code_review', level: 'B2' }],
    ['rooms:create', { title: 'Free talk', theme: 'free', level: null }],
    ['rooms:join', { roomId: 'r1' }],
    ['rooms:leave', { roomId: 'r1' }],
    ['rooms:state', { roomId: 'r1' }],
    ['rooms:signal', { roomId: 'r1', to: 'u2', signal: 'offer', payload: 'sdp' }],
    ['rooms:makeModerator', { roomId: 'r1', userId: 'u2' }],
    ['rooms:removeModerator', { roomId: 'r1', userId: 'u2' }],
    ['rooms:passHost', { roomId: 'r1', userId: 'u2' }],
    ['rooms:mute', { roomId: 'r1', userId: 'u2' }],
    ['rooms:remove', { roomId: 'r1', userId: 'u2' }],
    ['rooms:end', { roomId: 'r1' }],
    ['rooms:timer', { roomId: 'r1', seconds: 60 }],
    ['rooms:timer', { roomId: 'r1', seconds: null }],
    ['rooms:nextCard', { roomId: 'r1' }],
    ['rooms:setMuted', { roomId: 'r1', muted: true }],
    ['rooms:setMuted', { roomId: 'r1', muted: false }],
    ['rooms:settings', {}],
    ['moderation:roomContext', { reportId: 9 }],
  ]);
  expect(api.rooms.onEvent(() => {})).toBe(unsubscribe);
  expect(subscribed).toBe(ROOM_EVENT);
  expect(ROOM_EVENT).toBe('room:event');
});
