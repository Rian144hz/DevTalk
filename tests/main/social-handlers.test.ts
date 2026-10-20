import type { ProfileDraft } from '../../src/core/social/types';
import { toAppError } from '../../src/main/ipc/handle';
import { createSocialHandlers } from '../../src/main/ipc/social-handlers';
import { SocialError } from '../../src/main/social/errors';
import type { SocialHandlerDeps } from '../../src/main/ipc/social-handlers';
import { createUnconfiguredBackend } from '../../src/main/social/backend';
import { createFakeSocialBackend } from '../../src/main/social/fake-backend';
import type { FakeSocialOptions } from '../../src/main/social/fake-backend';
import { gif, webp as bannerWebp } from './banner-fixtures';

const draft: ProfileDraft = {
  displayName: 'Rian',
  nativeLanguage: 'Portuguese (Brazil)',
  level: 'B1',
  timezone: 'America/Bahia',
  area: 'backend',
  stack: ['  Python', 'python', 'C++'],
  availability: [{ day: 1, from: '19:00', to: '21:00' }],
  bio: '',
  mainStack: [],
  showProgress: true,
  mascot: null,
  listed: true,
};

/** A tiny but well-formed WebP header ("RIFF....WEBP"). */
function webp(size = 64): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0x52, 0x49, 0x46, 0x46], 0);
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  return b;
}

function setup(fake: FakeSocialOptions = {}, over: Partial<SocialHandlerDeps> = {}) {
  const backend = createFakeSocialBackend(fake);
  const written: { path: string; content: string }[] = [];
  let localDeleted = 0;
  const h = createSocialHandlers({
    backend,
    exportLocal: () => ({ attempts: [{ id: 1, text: 'I have fixed the bug.' }] }),
    chooseSavePath: async (name) => `/tmp/${name}`,
    writeFile: (path, content) => void written.push({ path, content }),
    deleteLocalData: () => {
      localDeleted++;
    },
    today: () => '2026-10-14',
    ...over,
  });
  return { h, backend, written, localDeleted: () => localDeleted };
}

async function ok<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: { kind: string; message: string } }>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`${r.error.kind}: ${r.error.message}`);
  return r.data;
}

async function signUp(h: ReturnType<typeof setup>['h'], email = 'rian@example.com') {
  await ok(h['social:sendCode']({ email }));
  await ok(h['social:verifyCode']({ email, code: '123456' }));
  await ok(h['social:acceptDocuments']({}));
  return ok(h['social:saveProfile'](draft));
}

test('status follows sign-up: signed out → needs documents → needs profile → member', async () => {
  const { h } = setup();
  expect(await ok(h['social:status']({}))).toEqual({
    configured: true, signedIn: false, email: null, needsDocuments: false, hasProfile: false, suspendedUntil: null,
  });
  await ok(h['social:sendCode']({ email: '  Rian@Example.com ' }));
  const verified = await ok(h['social:verifyCode']({ email: 'rian@example.com', code: '123456' }));
  expect(verified).toMatchObject({ signedIn: true, email: 'rian@example.com', needsDocuments: true, hasProfile: false });
  expect(await ok(h['social:acceptDocuments']({}))).toMatchObject({ needsDocuments: false, hasProfile: false });
  await ok(h['social:saveProfile'](draft));
  expect(await ok(h['social:status']({}))).toMatchObject({ needsDocuments: false, hasProfile: true });
});

test('an unconfigured build reports configured: false', async () => {
  const { h } = setup({}, { backend: createUnconfiguredBackend() });
  expect(await ok(h['social:status']({}))).toMatchObject({ configured: false, signedIn: false });
  const r = await h['social:sendCode']({ email: 'rian@example.com' });
  expect(r).toEqual({ ok: false, error: { kind: 'not_configured', message: 'Community is not set up in this build.' } });
});

test('the code must be 6 to 10 digits', async () => {
  const { h } = setup();
  for (const code of ['12a456', '12345', '12345678901']) {
    const r = await h['social:verifyCode']({ email: 'rian@example.com', code });
    expect(r.ok ? 'ok' : r.error.kind).toBe('validation');
  }
});

test('a wrong code gets the plain-English message', async () => {
  const { h } = setup();
  const r = await h['social:verifyCode']({ email: 'rian@example.com', code: '000000' });
  expect(r).toEqual({ ok: false, error: { kind: 'invalid_code', message: 'That code did not work. Check it or send a new one.' } });
});

test('offline and asleep errors get the spec messages', async () => {
  let r = await setup({ fail: { sendCode: 'offline' } }).h['social:sendCode']({ email: 'rian@example.com' });
  expect(r).toEqual({
    ok: false,
    error: { kind: 'offline', message: 'You are offline. Your practice still works; the community needs a connection.' },
  });
  r = await setup({ fail: { sendCode: 'asleep' } }).h['social:sendCode']({ email: 'rian@example.com' });
  expect(r).toEqual({ ok: false, error: { kind: 'asleep', message: 'The community server is asleep. Try again in a minute.' } });
  r = await setup({ fail: { sendCode: 'rate_limited' } }).h['social:sendCode']({ email: 'rian@example.com' });
  expect(r).toEqual({ ok: false, error: { kind: 'rate_limited', message: 'Too many codes were sent. Wait a few minutes and try again.' } });
});

test('saving a profile normalizes the stack tags', async () => {
  const { h } = setup();
  const p = await signUp(h);
  expect(p.stack).toEqual(['python', 'c++']);
});

test('a suspended account sees its end date in status and in the error', async () => {
  const { h, backend } = setup();
  const p = await signUp(h);
  backend.suspendForTest(p.id, '2099-01-31T12:00:00.000Z');
  expect(await ok(h['social:status']({}))).toMatchObject({ suspendedUntil: '2099-01-31T12:00:00.000Z' });
  const r = await h['social:saveProfile'](draft);
  expect(r).toEqual({ ok: false, error: { kind: 'suspended', message: 'Your account is suspended until 31 January 2099.' } });
});

describe('avatar', () => {
  test('a small WebP is stored and returned as a data URL', async () => {
    const { h } = setup();
    await signUp(h);
    const url = await ok(h['social:setAvatar']({ bytes: webp() }));
    expect(url.startsWith('data:image/webp;base64,')).toBe(true);
  });

  test('a PNG or a WebP over 200 KB is refused before upload', async () => {
    const { h } = setup();
    await signUp(h);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    for (const bytes of [png, webp(201 * 1024)]) {
      const r = await h['social:setAvatar']({ bytes });
      expect(r).toEqual({ ok: false, error: { kind: 'validation', message: 'The photo must be a WebP image under 200 KB.' } });
    }
    expect((await ok(h['social:getProfile']({})))!.hasAvatar).toBe(false);
  });
});

describe('export', () => {
  test('writes the account data, and the practice history when asked', async () => {
    const { h, written } = setup();
    await signUp(h);
    expect(await ok(h['social:export']({ includeLocal: true }))).toEqual({ saved: true, path: '/tmp/devtalk-data-2026-10-14.json' });
    const data = JSON.parse(written[0]!.content) as Record<string, unknown>;
    expect(data).toMatchObject({ community: { profile: { displayName: 'Rian' } }, practice: { attempts: [{ id: 1 }] } });
    await ok(h['social:export']({ includeLocal: false }));
    expect(JSON.parse(written[1]!.content)).not.toHaveProperty('practice');
  });

  test('cancelling the save dialog writes nothing', async () => {
    const { h, written } = setup({}, { chooseSavePath: async () => null });
    await signUp(h);
    expect(await ok(h['social:export']({ includeLocal: false }))).toEqual({ saved: false, path: null });
    expect(written).toEqual([]);
  });
});

describe('delete account', () => {
  test('a wrong confirmation e-mail is refused and nothing is deleted', async () => {
    const { h, localDeleted } = setup();
    await signUp(h);
    const r = await h['social:deleteAccount']({ confirmEmail: 'other@example.com', deleteLocal: true });
    expect(r).toEqual({ ok: false, error: { kind: 'validation', message: 'Type the e-mail of this account to confirm.' } });
    expect((await ok(h['social:status']({}))).signedIn).toBe(true);
    expect(localDeleted()).toBe(0);
  });

  test('offline: the account and the local session stay', async () => {
    const { h, localDeleted } = setup({ fail: { deleteAccount: 'offline' } });
    await signUp(h);
    const r = await h['social:deleteAccount']({ confirmEmail: 'RIAN@example.com', deleteLocal: true });
    expect(r.ok ? 'ok' : r.error.kind).toBe('offline');
    expect((await ok(h['social:status']({}))).signedIn).toBe(true);
    expect(localDeleted()).toBe(0);
  });

  test('success signs out, and deletes local data only when asked', async () => {
    const a = setup();
    await signUp(a.h);
    await ok(a.h['social:deleteAccount']({ confirmEmail: 'rian@example.com', deleteLocal: false }));
    expect((await ok(a.h['social:status']({}))).signedIn).toBe(false);
    expect(a.localDeleted()).toBe(0);
    const b = setup();
    await signUp(b.h);
    await ok(b.h['social:deleteAccount']({ confirmEmail: 'rian@example.com', deleteLocal: true }));
    expect(b.localDeleted()).toBe(1);
  });
});

describe('safety and moderation', () => {
  test('a report is validated and limited', async () => {
    const { h, backend } = setup({ seed: 'moderation' });
    const [sam] = backend.seededUserIds();
    const bad = await h['safety:report']({ reported: sam, contextType: 'profile', contextId: null, reason: 'rude', details: '' });
    expect(bad.ok ? 'ok' : bad.error.kind).toBe('validation');
    const long = await h['safety:report']({ reported: sam, contextType: 'profile', contextId: null, reason: 'spam', details: 'x'.repeat(1001) });
    expect(long.ok ? 'ok' : long.error.kind).toBe('validation');
    for (let i = 0; i < 20; i++) await ok(h['safety:report']({ reported: sam, contextType: 'profile', contextId: null, reason: 'spam', details: '' }));
    const limited = await h['safety:report']({ reported: sam, contextType: 'profile', contextId: null, reason: 'spam', details: '' });
    expect(limited).toEqual({ ok: false, error: { kind: 'rate_limited', message: 'You reached the limit of 20 reports a day. Try again tomorrow.' } });
  });

  test('block and unblock', async () => {
    const { h, backend } = setup({ seed: 'moderation' });
    const [sam] = backend.seededUserIds();
    await ok(h['safety:block']({ userId: sam }));
    expect(await backend.listBlocks()).toEqual([sam]);
    await ok(h['safety:unblock']({ userId: sam }));
    expect(await backend.listBlocks()).toEqual([]);
  });

  test('a moderator lists reports and decides; a suspension needs a known length', async () => {
    const { h } = setup({ seed: 'moderation' });
    expect(await ok(h['moderation:isModerator']({}))).toBe(true);
    const reports = await ok(h['moderation:reports']({}));
    expect(reports).toHaveLength(2);
    const bad = await h['moderation:decide']({ kind: 'suspend', reportId: reports[0]!.id, target: reports[0]!.reported!.id, days: 3, reason: 'x' });
    expect(bad.ok ? 'ok' : bad.error.kind).toBe('validation');
    await ok(h['moderation:decide']({ kind: 'dismiss', reportId: reports[0]!.id }));
    expect(await ok(h['moderation:reports']({}))).toHaveLength(1);
    expect(await ok(h['moderation:history']({ userId: reports[1]!.reported!.id }))).toEqual([]);
  });

  test('a non-moderator is told plainly', async () => {
    const { h } = setup();
    await signUp(h);
    const r = await h['moderation:reports']({});
    expect(r).toEqual({ ok: false, error: { kind: 'forbidden', message: 'Only moderators can see this.' } });
  });
});

describe('profile extras', () => {
  const kind = (r: { ok: boolean; error?: { kind: string } }) => (r.ok ? 'ok' : r.error!.kind);

  test('badges and the practice graph of a visible member', async () => {
    const { h, backend } = setup({ seed: 'moderation' });
    const [sam] = backend.seededUserIds();
    const badges = await ok(h['social:badges']({ userId: sam! }));
    expect(badges.map((b) => b.id)).toContain('mentor');
    const me = (await backend.session())!.userId;
    const graph = await ok(h['social:practiceGraph']({ userId: me }));
    expect(graph.days).toHaveLength(10);
    expect(graph.current).toBe(10);
    expect(kind(await h['social:badges']({ userId: '' }))).toBe('validation');
  });

  test('a banner is cleaned, stored and shown; then removed', async () => {
    const { h, backend } = setup();
    await signUp(h);
    const me = (await backend.session())!.userId;
    const url = await ok(h['social:setBanner']({ bytes: gif({ comment: 'taken at home' }) }));
    expect(url.startsWith('data:image/gif;base64,')).toBe(true);
    expect(Buffer.from(url.split(',')[1]!, 'base64').toString('latin1')).not.toContain('taken at home');
    expect(await ok(h['social:banner']({ userId: me }))).toBe(url);
    expect(await ok(h['social:setBanner']({ bytes: bannerWebp() }))).toMatch(/^data:image\/webp;base64,/);
    await ok(h['social:removeBanner']({}));
    expect(await ok(h['social:banner']({ userId: me }))).toBeNull();
  });

  test('a PNG, a tiny or a broken banner gets the plain-English message', async () => {
    const { h } = setup();
    await signUp(h);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array<number>(40).fill(0)]);
    const rules = { ok: false, error: { kind: 'validation', message: 'The banner must be a GIF or WebP under 2 MB, at least 600 × 200.' } };
    expect(await h['social:setBanner']({ bytes: png })).toEqual(rules);
    expect(await h['social:setBanner']({ bytes: gif({ w: 300, h: 100 }) })).toEqual(rules);
    const broken = gif();
    expect(await h['social:setBanner']({ bytes: broken.slice(0, broken.length - 12) })).toEqual({
      ok: false, error: { kind: 'validation', message: 'This image could not be read. Try another one.' },
    });
    expect(kind(await h['social:setBanner']({ bytes: new Uint8Array(8 * 1024 * 1024 + 1) }))).toBe('validation');
  });

  test('badge moderation input is validated', async () => {
    const { h, backend } = setup({ seed: 'moderation' });
    const [, alex] = backend.seededUserIds();
    expect(kind(await h['moderation:grantBadge']({ userId: alex!, badge: 'creator', reason: 'x' }))).toBe('validation');
    expect(kind(await h['moderation:grantBadge']({ userId: alex!, badge: 'mentor', reason: '  ' }))).toBe('validation');
    expect(kind(await h['moderation:grantBadge']({ userId: alex!, badge: 'mentor', reason: 'x'.repeat(201) }))).toBe('validation');
    expect(kind(await h['moderation:searchMembers']({ query: 'x'.repeat(41) }))).toBe('validation');
    expect(kind(await h['moderation:searchMembers']({ query: '' }))).toBe('validation');
  });

  test('a moderator finds a member and gives and takes a badge', async () => {
    const { h, backend } = setup({ seed: 'moderation' });
    const [, alex] = backend.seededUserIds();
    const found = await ok(h['moderation:searchMembers']({ query: 'ale' }));
    expect(found.map((m) => m.displayName)).toEqual(['Alex']);
    await ok(h['moderation:grantBadge']({ userId: alex!, badge: 'beta_tester', reason: 'Tested 0.2' }));
    expect((await ok(h['social:badges']({ userId: alex! }))).map((b) => b.id)).toContain('beta_tester');
    await ok(h['moderation:revokeBadge']({ userId: alex!, badge: 'beta_tester', reason: 'By mistake' }));
    expect((await ok(h['social:badges']({ userId: alex! }))).map((b) => b.id)).not.toContain('beta_tester');
  });

  test('a moderator is told plainly that they cannot change their own badges', async () => {
    const { h, backend } = setup({ seed: 'moderation' });
    const me = (await backend.session())!.userId;
    const own = { ok: false, error: { kind: 'validation', message: 'You cannot change your own badges. Another moderator can do it.' } };
    expect(await h['moderation:grantBadge']({ userId: me, badge: 'mentor', reason: 'x' })).toEqual(own);
    expect(await h['moderation:revokeBadge']({ userId: me, badge: 'mentor', reason: 'x' })).toEqual(own);
  });

  test('a non-moderator cannot search or give badges', async () => {
    const { h } = setup();
    await signUp(h);
    const forbidden = { ok: false, error: { kind: 'forbidden', message: 'Only moderators can see this.' } };
    expect(await h['moderation:searchMembers']({ query: 'sam' })).toEqual(forbidden);
    expect(await h['moderation:grantBadge']({ userId: 'someone', badge: 'mentor', reason: 'x' })).toEqual(forbidden);
    expect(await h['moderation:revokeBadge']({ userId: 'someone', badge: 'mentor', reason: 'x' })).toEqual(forbidden);
  });

  test('saving a profile keeps the new fields', async () => {
    const { h } = setup();
    await signUp(h);
    const saved = await ok(h['social:saveProfile']({ ...draft, stack: ['python', 'java'], mainStack: ['python'], showProgress: false, mascot: 'bear-2' }));
    expect(saved).toMatchObject({ mainStack: ['python'], showProgress: false, mascot: 'bear-2' });
  });
});

describe('people', () => {
  const kind = (r: { ok: boolean; error?: { kind: string } }) => (r.ok ? 'ok' : r.error!.kind);
  async function people() {
    const s = setup({ seed: 'people' });
    const ids = Object.fromEntries((await s.backend.peopleForTest()).map((p) => [p.displayName, p.id])) as Record<string, string>;
    return { ...s, ids, me: (await s.backend.session())!.userId };
  }

  test('members validates the filters and the page', async () => {
    const { h } = await people();
    expect((await ok(h['social:members']({ level: 'B2', page: 0 }))).map((m) => m.displayName)).toEqual(['Caio', 'Lia']);
    expect(kind(await h['social:members']({ query: 'x'.repeat(41), page: 0 }))).toBe('validation');
    expect(kind(await h['social:members']({ page: -1 }))).toBe('validation');
    expect(kind(await h['social:members']({ page: 1.5 }))).toBe('validation');
    expect(kind(await h['social:members']({ level: 'Z9', page: 0 }))).toBe('validation');
    expect(kind(await h['social:members']({ area: 'marketing', page: 0 }))).toBe('validation');
  });

  test('profiles, counts and lists of another member', async () => {
    const { h, ids } = await people();
    expect((await ok(h['social:profileOf']({ userId: ids['Bia']! })))?.displayName).toBe('Bia');
    expect(await ok(h['social:profileOf']({ userId: ids['Gil']! }))).toBeNull();
    expect(await ok(h['social:socialStats']({ userId: ids['Bia']! }))).toMatchObject({ followers: 2, iFollow: false });
    expect((await ok(h['social:followers']({ userId: ids['Bia']!, page: 0 }))).map((m) => m.displayName)).toEqual(['Ana', 'Caio']);
    expect((await ok(h['social:following']({ userId: ids['Ana']!, page: 0 }))).map((m) => m.displayName)).toEqual(['Bia']);
    expect(kind(await h['social:followers']({ userId: ids['Bia']!, page: -2 }))).toBe('validation');
    expect(kind(await h['social:profileOf']({ userId: '' }))).toBe('validation');
  });

  test('follow, unfollow, like and unlike change the counts', async () => {
    const { h, ids } = await people();
    await ok(h['social:follow']({ userId: ids['Dani']! }));
    await ok(h['social:like']({ userId: ids['Dani']! }));
    expect(await ok(h['social:socialStats']({ userId: ids['Dani']! }))).toMatchObject({ followers: 1, likes: 1, iFollow: true, iLike: true });
    await ok(h['social:unfollow']({ userId: ids['Dani']! }));
    await ok(h['social:unlike']({ userId: ids['Dani']! }));
    expect(await ok(h['social:socialStats']({ userId: ids['Dani']! }))).toMatchObject({ followers: 0, likes: 0, iFollow: false, iLike: false });
  });

  test('following or liking yourself is refused in plain words', async () => {
    const { h, me } = await people();
    expect(await h['social:follow']({ userId: me })).toEqual({ ok: false, error: { kind: 'validation', message: 'You cannot follow yourself.' } });
    expect(await h['social:like']({ userId: me })).toEqual({ ok: false, error: { kind: 'validation', message: 'You cannot like your own profile.' } });
  });

  test('the daily limits get their own message', async () => {
    const { h, backend, ids, me } = await people();
    backend.addFollowsForTest(me, 200);
    expect(await h['social:follow']({ userId: ids['Ana']! })).toEqual({
      ok: false, error: { kind: 'rate_limited', message: 'You reached the limit of 200 follows a day. Try again tomorrow.' },
    });
  });

  test('notices carry their kind and actor through the channel', async () => {
    const { h, backend, me } = await people();
    backend.addNoticeForTest(me, 'Be kind.');
    const notices = await ok(h['social:notices']({}));
    expect(notices.find((n) => n.message === 'Be kind.')).toMatchObject({ kind: 'moderation', actor: null });
  });
});

describe('chat channels', () => {
  async function chat() {
    const sessions: number[] = [];
    const { h, backend } = setup({ seed: 'people' }, { onSessionChange: () => void sessions.push(1) });
    const ids = Object.fromEntries((await backend.peopleForTest()).map((p) => [p.displayName, p.id])) as Record<string, string>;
    const conversations = await ok(h['chat:conversations']({}));
    const withBia = conversations.find((c) => c.other.displayName === 'Bia')!;
    return { h, backend, ids, withBia, sessions };
  }

  test('conversations, messages, send, read and corrections go through the backend', async () => {
    const { h, ids, withBia, backend } = await chat();
    await ok(h['chat:send']({ conversationId: withBia.id, body: 'Thursday works for me.' }));
    const msgs = await ok(h['chat:messages']({ conversationId: withBia.id, before: null }));
    expect(msgs.at(-1)).toMatchObject({ body: 'Thursday works for me.', deleted: false });
    await ok(h['chat:read']({ conversationId: withBia.id }));
    expect((await ok(h['chat:conversations']({}))).find((c) => c.id === withBia.id)!.unread).toBe(0);
    backend.sendAsForTest(ids['Bia']!, withBia.id, 'I has a question');
    const theirs = (await ok(h['chat:messages']({ conversationId: withBia.id, before: null }))).at(-1)!;
    await ok(h['chat:correct']({ messageId: theirs.id, corrected: 'I have a question' }));
    await ok(h['chat:delete']({ messageId: msgs.at(-1)!.id }));
    const after = await ok(h['chat:messages']({ conversationId: withBia.id, before: null }));
    expect(after.find((m) => m.id === msgs.at(-1)!.id)).toMatchObject({ deleted: true, body: '' });
    expect(after.at(-1)!.corrections).toEqual([expect.objectContaining({ corrected: 'I have a question' })]);
    const id = await ok(h['chat:request']({ userId: ids['Caio']!, body: 'Hi Caio!' }));
    expect(typeof id).toBe('string');
    expect(await h['chat:respond']({ conversationId: id, accept: true })).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  });

  test('blank or 2 001-character text and bad ids are refused before the backend', async () => {
    const { h, withBia } = await chat();
    for (const body of ['', '   \n ', 'x'.repeat(2001)]) {
      expect(await h['chat:send']({ conversationId: withBia.id, body })).toMatchObject({ ok: false, error: { kind: 'validation' } });
      expect(await h['chat:request']({ userId: 'u2', body })).toMatchObject({ ok: false, error: { kind: 'validation' } });
      expect(await h['chat:correct']({ messageId: 1, corrected: body })).toMatchObject({ ok: false, error: { kind: 'validation' } });
    }
    expect(await h['chat:send']({ conversationId: withBia.id, body: `${'x'.repeat(2000)}  ` })).toMatchObject({ ok: true });
    expect(await h['chat:messages']({ conversationId: withBia.id, before: -1 })).toMatchObject({ ok: false, error: { kind: 'validation' } });
    expect(await h['chat:delete']({ messageId: 1.5 })).toMatchObject({ ok: false, error: { kind: 'validation' } });
    expect(await h['chat:respond']({ conversationId: withBia.id, accept: 'yes' })).toMatchObject({ ok: false, error: { kind: 'validation' } });
  });

  test('the chat limits get their own message', () => {
    expect(toAppError(new SocialError('rate_limited', 'request limit reached'))).toEqual({
      kind: 'rate_limited', message: 'You reached the limit of 10 message requests a day. Try again tomorrow.',
    });
    expect(toAppError(new SocialError('rate_limited', 'message limit reached')).message).toBe(
      'You reached the limit of 500 messages a day. Try again tomorrow.',
    );
    expect(toAppError(new SocialError('rate_limited', 'correction limit reached')).message).toBe(
      'You reached the limit of 200 corrections a day. Try again tomorrow.',
    );
  });

  test('report context is for moderators only', async () => {
    const { h, backend, ids, withBia } = await chat();
    const theirs = (await ok(h['chat:messages']({ conversationId: withBia.id, before: null }))).at(-1)!;
    await ok(h['safety:report']({ reported: ids['Bia']!, contextType: 'message', contextId: String(theirs.id), reason: 'spam', details: '' }));
    expect(await h['moderation:reportContext']({ reportId: 1 })).toEqual({ ok: false, error: { kind: 'forbidden', message: 'Only moderators can see this.' } });
    backend.addModeratorForTest(ids['Dani']!);
    await ok(h['social:verifyCode']({ email: 'dani@example.com', code: '123456' }));
    const report = (await ok(h['moderation:reports']({}))).find((r) => r.contextType === 'message')!;
    expect((await ok(h['moderation:reportContext']({ reportId: report.id }))).at(-1)).toMatchObject({ messageId: theirs.id, reported: true });
  });

  test('signing in, accepting the documents, signing out and deleting tell the live chat', async () => {
    const { h, sessions } = await chat();
    await ok(h['social:signOut']({}));
    await ok(h['social:sendCode']({ email: 'new@example.com' }));
    await ok(h['social:verifyCode']({ email: 'new@example.com', code: '123456' }));
    await ok(h['social:acceptDocuments']({}));
    await ok(h['social:deleteAccount']({ confirmEmail: 'new@example.com', deleteLocal: false }));
    expect(sessions).toHaveLength(4);
  });
});
