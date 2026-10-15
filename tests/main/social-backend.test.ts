import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProfileDraft } from '../../src/core/social/types';
import type { SocialErrorKind } from '../../src/main/social/errors';
import { SocialError } from '../../src/main/social/errors';
import { findShippedSecrets, readSocialConfig } from '../../src/main/social/config';
import { createFakeSocialBackend } from '../../src/main/social/fake-backend';
import { createSessionStore } from '../../src/main/social/session-store';
import type { SafeStorageLike } from '../../src/main/vault/key-vault';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'devtalk-social-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const fakeSafeStorage = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').reverse()),
  decryptString: (b) => Buffer.from(b).reverse().toString('utf8'),
});

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.signature`;
}

const draft: ProfileDraft = {
  displayName: 'Rian',
  nativeLanguage: 'Portuguese (Brazil)',
  level: 'B1',
  timezone: 'America/Bahia',
  area: 'backend',
  stack: ['python'],
  availability: [],
  bio: '',
  mainStack: [],
  showProgress: true,
  mascot: null,
};

async function kindOf(p: Promise<unknown>): Promise<SocialErrorKind | 'resolved'> {
  try {
    await p;
    return 'resolved';
  } catch (err) {
    if (err instanceof SocialError) return err.kind;
    throw err;
  }
}

describe('readSocialConfig', () => {
  const url = 'https://abcdefghijklmnopqrst.supabase.co';

  test('accepts a publishable key', () => {
    expect(readSocialConfig({ MAIN_VITE_SUPABASE_URL: url, MAIN_VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' })).toEqual({
      url,
      key: 'sb_publishable_abc',
    });
  });

  test('accepts a legacy anon JWT', () => {
    const key = jwt({ role: 'anon', iss: 'supabase' });
    expect(readSocialConfig({ MAIN_VITE_SUPABASE_URL: url, MAIN_VITE_SUPABASE_PUBLISHABLE_KEY: key })?.key).toBe(key);
  });

  test('refuses a secret key or a service_role JWT', () => {
    expect(readSocialConfig({ MAIN_VITE_SUPABASE_URL: url, MAIN_VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' })).toBeNull();
    expect(readSocialConfig({ MAIN_VITE_SUPABASE_URL: url, MAIN_VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ role: 'service_role' }) })).toBeNull();
  });

  test('returns null when missing or malformed', () => {
    expect(readSocialConfig({})).toBeNull();
    expect(readSocialConfig({ MAIN_VITE_SUPABASE_URL: 'not a url', MAIN_VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' })).toBeNull();
    expect(readSocialConfig({ MAIN_VITE_SUPABASE_URL: 'http://evil.example.com', MAIN_VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' })).toBeNull();
    expect(readSocialConfig({ MAIN_VITE_SUPABASE_URL: url, MAIN_VITE_SUPABASE_PUBLISHABLE_KEY: 'whatever' })).toBeNull();
  });

  test('trims a trailing slash from the URL', () => {
    expect(readSocialConfig({ MAIN_VITE_SUPABASE_URL: `${url}/`, MAIN_VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' })?.url).toBe(url);
  });
});

describe('findShippedSecrets (build guard)', () => {
  test('names every bundled variable that holds a secret key', () => {
    expect(
      findShippedSecrets({
        MAIN_VITE_SUPABASE_URL: 'https://x.supabase.co',
        MAIN_VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc',
        VITE_OTHER: jwt({ role: 'service_role' }),
        RENDERER_VITE_FINE: 'sb_publishable_abc',
        SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_not_bundled',
      }).sort(),
    ).toEqual(['MAIN_VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_OTHER']);
  });

  test('a publishable key or an anon JWT is fine', () => {
    expect(findShippedSecrets({ MAIN_VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc', MAIN_VITE_X: jwt({ role: 'anon' }) })).toEqual([]);
  });
});

describe('session store', () => {
  test('round-trips through the keyring and never writes plain text', () => {
    const file = join(dir, 'social-session.bin');
    const store = createSessionStore({ safeStorage: fakeSafeStorage(), filePath: file });
    store.setItem('sb-auth-token', '{"access_token":"secret-token"}');
    expect(readFileSync(file).includes('secret-token')).toBe(false);
    const again = createSessionStore({ safeStorage: fakeSafeStorage(), filePath: file });
    expect(again.getItem('sb-auth-token')).toBe('{"access_token":"secret-token"}');
    again.removeItem('sb-auth-token');
    expect(createSessionStore({ safeStorage: fakeSafeStorage(), filePath: file }).getItem('sb-auth-token')).toBeNull();
  });

  test('clear forgets the session and removes the file', () => {
    const file = join(dir, 'social-session.bin');
    const store = createSessionStore({ safeStorage: fakeSafeStorage(), filePath: file });
    store.setItem('k', 'v');
    store.clear();
    expect(store.getItem('k')).toBeNull();
    expect(createSessionStore({ safeStorage: fakeSafeStorage(), filePath: file }).getItem('k')).toBeNull();
  });

  test('without a keyring the session lives only in memory', () => {
    const file = join(dir, 'social-session.bin');
    const store = createSessionStore({ safeStorage: fakeSafeStorage(false), filePath: file });
    store.setItem('k', 'v');
    expect(store.getItem('k')).toBe('v');
    expect(createSessionStore({ safeStorage: fakeSafeStorage(false), filePath: file }).getItem('k')).toBeNull();
  });

  test('an unreadable file counts as signed out', () => {
    const file = join(dir, 'social-session.bin');
    createSessionStore({ safeStorage: fakeSafeStorage(), filePath: file }).setItem('k', 'v');
    const broken: SafeStorageLike = { ...fakeSafeStorage(), decryptString: () => { throw new Error('bad'); } };
    expect(createSessionStore({ safeStorage: broken, filePath: file }).getItem('k')).toBeNull();
  });
});

describe('fake social backend', () => {
  async function signUp(b = createFakeSocialBackend(), email = 'rian@example.com') {
    await b.sendCode(email);
    await b.verifyCode(email, '123456');
    await b.acceptDocuments();
    await b.saveProfile(draft);
    return b;
  }

  test('sign-up: code, documents, then profile', async () => {
    const b = createFakeSocialBackend();
    expect(await b.session()).toBeNull();
    await b.sendCode('rian@example.com');
    expect(await kindOf(b.verifyCode('rian@example.com', '000000'))).toBe('invalid_code');
    const s = await b.verifyCode('rian@example.com', '123456');
    expect(s.email).toBe('rian@example.com');
    expect(await b.hasAcceptedCurrentDocuments()).toBe(false);
    expect(await kindOf(b.saveProfile(draft))).toBe('forbidden');
    await b.acceptDocuments();
    expect(await b.hasAcceptedCurrentDocuments()).toBe(true);
    const p = await b.saveProfile(draft);
    expect(p).toMatchObject({ id: s.userId, displayName: 'Rian', hasAvatar: false, suspendedUntil: null });
    expect(await b.getOwnProfile()).toEqual(p);
  });

  test('signing in again with the same e-mail returns the same account', async () => {
    const b = await signUp();
    const first = (await b.session())!.userId;
    await b.signOut();
    expect(await b.session()).toBeNull();
    await b.sendCode('rian@example.com');
    expect((await b.verifyCode('rian@example.com', '123456')).userId).toBe(first);
  });

  test('calls that need an account fail when signed out', async () => {
    const b = createFakeSocialBackend();
    expect(await kindOf(b.getOwnProfile())).toBe('not_signed_in');
    expect(await kindOf(b.report({ reported: 'x', contextType: 'profile', contextId: null, reason: 'spam', details: '' }))).toBe(
      'not_signed_in',
    );
  });

  test('avatars: upload, read as data URL, remove', async () => {
    const b = await signUp();
    const me = (await b.session())!.userId;
    await b.uploadAvatar(new Uint8Array([82, 73, 70, 70]));
    expect((await b.getOwnProfile())!.hasAvatar).toBe(true);
    expect(await b.avatarDataUrl(me)).toBe('data:image/webp;base64,UklGRg==');
    await b.removeAvatar();
    expect(await b.avatarDataUrl(me)).toBeNull();
  });

  test('blocks hide avatars both ways and can be undone', async () => {
    const b = createFakeSocialBackend({ seed: 'moderation' });
    const [sam] = b.seededUserIds();
    await b.signOut();
    await signUp(b, 'member@example.com');
    expect(await b.avatarDataUrl(sam!)).not.toBeNull();
    await b.block(sam!);
    expect(await b.listBlocks()).toEqual([sam]);
    expect(await b.avatarDataUrl(sam!)).toBeNull();
    await b.unblock(sam!);
    expect(await b.avatarDataUrl(sam!)).not.toBeNull();
  });

  test('reports: never yourself, at most 20 a day', async () => {
    const b = createFakeSocialBackend({ seed: 'moderation' });
    const me = (await b.session())!.userId;
    const [sam] = b.seededUserIds();
    const r = { reported: sam!, contextType: 'profile' as const, contextId: null, reason: 'spam' as const, details: '' };
    expect(await kindOf(b.report({ ...r, reported: me }))).toBe('forbidden');
    for (let i = 0; i < 20; i++) await b.report(r);
    expect(await kindOf(b.report(r))).toBe('rate_limited');
  });

  test('moderation: only moderators read reports and decide', async () => {
    const b = await signUp();
    expect(await b.isModerator()).toBe(false);
    expect(await kindOf(b.listOpenReports())).toBe('forbidden');
    expect(await kindOf(b.decide({ kind: 'dismiss', reportId: 1 }))).toBe('forbidden');
  });

  test('moderation: warn closes the report and leaves a notice; suspend and unsuspend', async () => {
    const b = createFakeSocialBackend({ seed: 'moderation' });
    expect(await b.isModerator()).toBe(true);
    const reports = await b.listOpenReports();
    expect(reports).toHaveLength(2);
    const [first, second] = reports;
    await b.decide({ kind: 'warn', reportId: first!.id, target: first!.reported!.id, message: 'Please be kind.' });
    expect((await b.listOpenReports()).map((r) => r.id)).toEqual([second!.id]);
    expect(b.noticesFor(first!.reported!.id).map((n) => n.message)).toEqual(['Please be kind.']);
    await b.decide({ kind: 'suspend', reportId: second!.id, target: second!.reported!.id, days: 7, reason: 'spam' });
    const history = await b.actionsAbout(second!.reported!.id);
    expect(history[0]).toMatchObject({ action: 'suspend', reason: 'spam' });
    expect(history[0]!.until).not.toBeNull();
    await b.decide({ kind: 'unsuspend', target: second!.reported!.id });
    expect((await b.actionsAbout(second!.reported!.id))[0]).toMatchObject({ action: 'unsuspend', until: null, badge: null });
  });

  test('badge changes show in the history with the badge', async () => {
    const b = createFakeSocialBackend({ seed: 'moderation' });
    const [, alex] = b.seededUserIds();
    await b.grantBadge(alex!, 'open_source', 'Merged a fix');
    await b.revokeBadge(alex!, 'open_source', 'Wrong person');
    expect((await b.actionsAbout(alex!)).map((h) => [h.action, h.badge, h.reason])).toEqual([
      ['revoke_badge', 'open_source', 'Wrong person'],
      ['grant_badge', 'open_source', 'Merged a fix'],
    ]);
  });

  test('an account that has not accepted the documents cannot report, block or see others', async () => {
    const b = createFakeSocialBackend({ seed: 'moderation' });
    const [sam] = b.seededUserIds();
    await b.signOut();
    await b.sendCode('new@example.com');
    await b.verifyCode('new@example.com', '123456');
    expect(await b.avatarDataUrl(sam!)).toBeNull();
    expect(await kindOf(b.block(sam!))).toBe('forbidden');
    expect(await kindOf(b.report({ reported: sam!, contextType: 'profile', contextId: null, reason: 'spam', details: '' }))).toBe('forbidden');
  });

  test('a suspended account cannot edit its profile or report', async () => {
    const b = await signUp();
    const me = (await b.session())!.userId;
    b.suspendForTest(me, '2099-01-01T00:00:00.000Z');
    expect(await kindOf(b.saveProfile(draft))).toBe('suspended');
    expect((await b.getOwnProfile())!.suspendedUntil).toBe('2099-01-01T00:00:00.000Z');
  });

  test('notices: list and mark as read', async () => {
    const b = createFakeSocialBackend({ seed: 'moderation' });
    const me = (await b.session())!.userId;
    b.addNoticeForTest(me, 'Welcome.');
    const [n] = await b.listNotices();
    expect(n).toMatchObject({ message: 'Welcome.', read: false });
    await b.markNoticeRead(n!.id);
    expect((await b.listNotices())[0]!.read).toBe(true);
  });

  test('export contains the account data; delete removes it and signs out', async () => {
    const b = await signUp();
    const data = await b.exportOwnData();
    expect(data).toMatchObject({ account: { email: 'rian@example.com' }, profile: { displayName: 'Rian' } });
    expect(Object.keys(data).sort()).toEqual(['account', 'avatarUrl', 'blocks', 'consents', 'exportedAt', 'moderationActions', 'notices', 'profile', 'reportsMade']);
    await b.deleteAccount();
    expect(await b.session()).toBeNull();
    await b.sendCode('rian@example.com');
    await b.verifyCode('rian@example.com', '123456');
    expect(await b.getOwnProfile()).toBeNull();
    expect(await b.hasAcceptedCurrentDocuments()).toBe(false);
  });

  test('badges: the seeded moderator is Moderator and Founding member, and Sam has Mentor', async () => {
    const b = createFakeSocialBackend({ seed: 'moderation' });
    const me = (await b.session())!.userId;
    const ids = (await b.badges(me)).map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['moderator', 'founding_member', 'area:backend', 'lang:python']));
    const [sam] = b.seededUserIds();
    expect((await b.badges(sam!)).map((x) => x.id)).toContain('mentor');
  });

  test('evolution badges and the graph follow the progress switch for others', async () => {
    const b = await signUp();
    const me = (await b.session())!.userId;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: draft.timezone }).format(new Date());
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i);
      return { day: d.toISOString().slice(0, 10), answers: 1, reviews: 0 };
    });
    await b.publishPracticeDays(days);
    await b.signOut();
    await signUp(b, 'friend@example.com');
    expect((await b.badges(me)).map((x) => x.id)).toContain('streak_7');
    expect((await b.practiceGraph(me)).current).toBe(7);
    await b.signOut();
    await b.sendCode('rian@example.com');
    await b.verifyCode('rian@example.com', '123456');
    await b.saveProfile({ ...draft, showProgress: false });
    expect((await b.badges(me)).map((x) => x.id)).toContain('streak_7');
    await b.signOut();
    await b.sendCode('friend@example.com');
    await b.verifyCode('friend@example.com', '123456');
    expect((await b.badges(me)).map((x) => x.id)).not.toContain('streak_7');
    expect(await b.practiceGraph(me)).toEqual({ days: [], current: 0, longest: 0 });
  });

  test('badge moderation: only moderators, never on themselves; the person gets a notice', async () => {
    const m = createFakeSocialBackend({ seed: 'moderation' });
    const mod = (await m.session())!.userId;
    const [, alex] = m.seededUserIds();
    expect(await kindOf(m.grantBadge(mod, 'mentor', 'self'))).toBe('forbidden');
    await m.grantBadge(alex!, 'open_source', 'Helps the project');
    expect((await m.badges(alex!)).map((x) => x.id)).toContain('open_source');
    expect(m.noticesFor(alex!).map((n) => n.message)).toContain('You received the Open source contributor badge.');
    await m.revokeBadge(alex!, 'open_source', 'By mistake');
    expect((await m.badges(alex!)).map((x) => x.id)).not.toContain('open_source');
    expect((await m.searchMembers('al')).map((x) => x.displayName)).toEqual(['Alex']);
    const b = await signUp();
    expect(await kindOf(b.grantBadge(alex!, 'mentor', 'x'))).toBe('forbidden');
    expect(await kindOf(b.searchMembers('al'))).toBe('forbidden');
  });

  test('banner: upload, read back as a data URL, remove', async () => {
    const b = await signUp();
    const me = (await b.session())!.userId;
    await b.uploadBanner(new Uint8Array([0x47, 0x49, 0x46]), 'gif');
    expect((await b.getOwnProfile())!.hasBanner).toBe(true);
    expect(await b.bannerDataUrl(me)).toBe('data:image/gif;base64,R0lG');
    await b.removeBanner();
    expect(await b.bannerDataUrl(me)).toBeNull();
  });

  test('milestones: valid values only, duplicates ignored', async () => {
    const b = await signUp();
    const me = (await b.session())!.userId;
    await b.publishMilestone('level_up', 'B1>B2');
    await b.publishMilestone('level_up', 'B1>B2');
    await b.publishMilestone('vocabulary', '50');
    expect(await kindOf(b.publishMilestone('level_up', 'B2>B1'))).toBe('unknown');
    const evo = (await b.badges(me)).filter((x) => x.group === 'evolution');
    expect(evo.map((x) => [x.id, x.label, x.detail])).toEqual([
      ['level_up', 'B1 → B2', 'B1>B2'],
      ['vocabulary', 'Vocabulary hunter', '50+'],
    ]);
  });

  test('injected failure: deleteAccount offline keeps the session', async () => {
    const b = await signUp(createFakeSocialBackend({ fail: { deleteAccount: 'offline' } }));
    expect(await kindOf(b.deleteAccount())).toBe('offline');
    expect(await b.session()).not.toBeNull();
  });

  test('state survives a restart when a file is given', async () => {
    const file = join(dir, 'fake-social.json');
    const b = createFakeSocialBackend({ filePath: file });
    await b.sendCode('rian@example.com');
    await b.verifyCode('rian@example.com', '123456');
    const again = createFakeSocialBackend({ filePath: file });
    expect((await again.session())?.email).toBe('rian@example.com');
    expect(await again.hasAcceptedCurrentDocuments()).toBe(false);
  });
});
