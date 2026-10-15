import type { ProfileDraft } from '../../src/core/social/types';
import { createSocialHandlers } from '../../src/main/ipc/social-handlers';
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
