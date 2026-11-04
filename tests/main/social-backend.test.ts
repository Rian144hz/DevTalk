import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, inflateSync } from 'node:zlib';
import type { RoomDraft, RoomLiveEvent, RoomTimer } from '../../src/core/social/rooms';
import type { ProfileDraft } from '../../src/core/social/types';
import type { SocialErrorKind } from '../../src/main/social/errors';
import { createUnconfiguredBackend, type SocialBackend } from '../../src/main/social/backend';
import { SocialError } from '../../src/main/social/errors';
import { findShippedSecrets, readSocialConfig } from '../../src/main/social/config';
import {
  createFakeSocialBackend,
  FAKE_GITHUB_ID,
  FAKE_GITHUB_NAME,
  FAKE_GITHUB_PICTURE,
  FAKE_GITHUB_USERNAME,
} from '../../src/main/social/fake-backend';
import { NOT_FINISHED_MESSAGE } from '../../src/main/social/oauth-loopback';
import { createSessionStore, withoutProviderTokens } from '../../src/main/social/session-store';
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
  listed: true,
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

  test('empty values read as not configured: what a CI build gets when its repository secrets are not set', () => {
    expect(readSocialConfig({ MAIN_VITE_SUPABASE_URL: '', MAIN_VITE_SUPABASE_PUBLISHABLE_KEY: '' })).toBeNull();
    expect(readSocialConfig({ MAIN_VITE_SUPABASE_URL: url, MAIN_VITE_SUPABASE_PUBLISHABLE_KEY: '' })).toBeNull();
    expect(readSocialConfig({ MAIN_VITE_SUPABASE_URL: '  ', MAIN_VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' })).toBeNull();
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

  test('empty values (unset CI secrets) do not stop a build', () => {
    expect(findShippedSecrets({ MAIN_VITE_SUPABASE_URL: '', MAIN_VITE_SUPABASE_PUBLISHABLE_KEY: '' })).toEqual([]);
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

  describe('withoutProviderTokens', () => {
    function wrapped() {
      const file = join(dir, 'social-session.bin');
      const inner = createSessionStore({ safeStorage: fakeSafeStorage(), filePath: file });
      return { store: withoutProviderTokens(inner), inner, file };
    }

    test('drops provider_token and provider_refresh_token at the top level and in a nested currentSession', () => {
      const { store, inner } = wrapped();
      const tokens = { provider_token: 'gho_x', provider_refresh_token: 'ghr_x' };
      store.setItem('a', JSON.stringify({ access_token: 'at', refresh_token: 'rt', ...tokens }));
      store.setItem('b', JSON.stringify({ currentSession: { access_token: 'at', ...tokens }, expiresAt: 5 }));
      expect(JSON.parse(inner.getItem('a')!)).toEqual({ access_token: 'at', refresh_token: 'rt' });
      expect(JSON.parse(inner.getItem('b')!)).toEqual({ currentSession: { access_token: 'at' }, expiresAt: 5 });
      expect(store.getItem('a')).toBe(inner.getItem('a'));
    });

    test('a non-JSON value, a JSON string or a session without those fields is stored exactly as given', () => {
      const { store, inner, file } = wrapped();
      const plain = '{"access_token":"at",  "refresh_token":"rt"}';
      for (const [key, value] of [['verifier', 'abc123.def'], ['quoted', '"abc123"'], ['plain', plain], ['list', '[1,2]'], ['null', 'null']] as const) {
        store.setItem(key, value);
        expect(inner.getItem(key)).toBe(value);
      }
      expect(readFileSync(file).length).toBeGreaterThan(0);
    });

    test('removeItem and clear still reach the real store', () => {
      const { store, inner } = wrapped();
      store.setItem('k', 'v');
      store.removeItem('k');
      expect(inner.getItem('k')).toBeNull();
      store.setItem('k', 'v');
      store.clear();
      expect(inner.getItem('k')).toBeNull();
    });
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
    expect(Object.keys(data).sort()).toEqual([
      'account', 'avatarUrl', 'badges', 'bannerUrl', 'blocks', 'chat', 'consents', 'exportedAt', 'moderationActions', 'notices', 'profile', 'progress', 'reportsMade', 'rooms', 'social', 'usesLinux',
    ]);
    expect(data['progress']).toEqual({ practiceDays: [], milestones: [] });
    expect(data['rooms']).toEqual({ roomsCreated: [], sessions: [] });
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

describe('fake backend: people', () => {
  /** Signed in as Rian (B1, back end) with a seeded community; returns name → id. */
  async function people() {
    const b = createFakeSocialBackend({ seed: 'people' });
    const ids = Object.fromEntries((await b.peopleForTest()).map((p) => [p.displayName, p.id])) as Record<string, string>;
    return { b, ids };
  }
  const names = (rows: { displayName: string }[]) => rows.map((r) => r.displayName);

  test('the member list leaves out yourself, unlisted, suspended and blocked people, closest level first', async () => {
    const { b } = await people();
    const all = names(await b.members({}, 0));
    expect(all).not.toContain('Rian');
    for (const hidden of ['Edu', 'Fabi', 'Gil']) expect(all).not.toContain(hidden);
    expect(all.slice(0, 3)).toEqual(['Bia', 'João', 'Max']);
    expect(names(await b.members({ level: 'B2' }, 0))).toEqual(['Caio', 'Lia']);
    expect(names(await b.members({ area: 'frontend' }, 0))).toEqual(['Bia', 'Iris']);
    expect(names(await b.members({ stack: 'PYTHON' }, 0))).toEqual(['Ana', 'Caio']);
    expect(names(await b.members({ query: 'ai' }, 0))).toEqual(['Caio']);
    expect(await b.members({}, 1)).toEqual([]);
    expect((await b.members({ query: 'Bia' }, 0))[0]).toEqual({
      id: expect.any(String), displayName: 'Bia', level: 'B1', area: 'frontend', mainStack: ['react'], mascot: null, hasAvatar: false,
    });
  });

  test('follow and unfollow: counts, one notice a week, never yourself or blocked people', async () => {
    const { b, ids } = await people();
    const me = (await b.session())!.userId;
    expect(await b.socialStats(ids['Bia']!)).toEqual({ followers: 2, following: 0, likes: 0, iFollow: false, iLike: false });
    await b.follow(ids['Bia']!);
    await b.follow(ids['Bia']!);
    expect(await b.socialStats(ids['Bia']!)).toMatchObject({ followers: 3, iFollow: true });
    expect(b.noticesFor(ids['Bia']!).filter((n) => n.kind === 'follow')).toEqual([
      expect.objectContaining({ message: 'Rian followed you.', kind: 'follow', actor: { id: me, displayName: 'Rian', hasAvatar: false, mascot: null } }),
    ]);
    await b.unfollow(ids['Bia']!);
    await b.follow(ids['Bia']!);
    expect(b.noticesFor(ids['Bia']!).filter((n) => n.kind === 'follow')).toHaveLength(1);
    expect(await kindOf(b.follow(me))).toBe('forbidden');
    expect(await kindOf(b.follow(ids['Gil']!))).toBe('forbidden');
    expect(await kindOf(b.follow(ids['Fabi']!))).toBe('forbidden');
  });

  test('likes count without notices; you cannot like yourself', async () => {
    const { b, ids } = await people();
    const before = b.noticesFor(ids['Ana']!).length;
    await b.like(ids['Ana']!);
    await b.like(ids['Ana']!);
    expect(await b.socialStats(ids['Ana']!)).toMatchObject({ likes: 1, iLike: true });
    expect(b.noticesFor(ids['Ana']!)).toHaveLength(before);
    await b.unlike(ids['Ana']!);
    expect(await b.socialStats(ids['Ana']!)).toMatchObject({ likes: 0, iLike: false });
    expect(await kindOf(b.like((await b.session())!.userId))).toBe('forbidden');
  });

  test('the 201st follow in a day hits the limit', async () => {
    const { b, ids } = await people();
    b.addFollowsForTest((await b.session())!.userId, 200);
    const err = await b.follow(ids['Ana']!).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'rate_limited', message: 'follow limit reached' });
  });

  test('follower lists keep unlisted people and leave out suspended and blocked ones', async () => {
    const { b, ids } = await people();
    expect(names(await b.followers(ids['Bia']!, 0))).toEqual(['Ana', 'Caio']);
    expect(names(await b.followers(ids['Max']!, 0))).toEqual(['Edu']);
    expect(names(await b.following(ids['Ana']!, 0))).toEqual(['Bia']);
    expect(await b.followers(ids['Gil']!, 0)).toEqual([]);
  });

  test('blocking ends follows and likes both ways', async () => {
    const { b, ids } = await people();
    await b.follow(ids['Dani']!);
    await b.like(ids['Dani']!);
    await b.block(ids['Dani']!);
    await b.unblock(ids['Dani']!);
    expect(await b.socialStats(ids['Dani']!)).toMatchObject({ followers: 0, likes: 0, iFollow: false, iLike: false });
  });

  test('profileOf gives a visible member, null for blocked, suspended or unknown ids', async () => {
    const { b, ids } = await people();
    expect((await b.profileOf(ids['Edu']!))?.displayName).toBe('Edu');
    expect(await b.profileOf(ids['Gil']!)).toBeNull();
    expect(await b.profileOf(ids['Fabi']!)).toBeNull();
    expect(await b.profileOf('00000000-0000-4000-8000-999999999999')).toBeNull();
  });

  test('after review: loops hit the limit, no profile means no follow, deleting removes your notices', async () => {
    const { b, ids } = await people();
    const me = (await b.session())!.userId;
    for (let i = 0; i < 200; i++) b.addNoticeForTest('00000000-0000-4000-8000-' + String(900000 + i).padStart(12, '0'), 'Rian followed you.', { kind: 'follow', actor: me });
    expect(await b.follow(ids['Ana']!).catch((e: unknown) => e)).toMatchObject({ kind: 'rate_limited', message: 'follow limit reached' });

    const fresh = createFakeSocialBackend({ seed: 'people' });
    const freshIds = Object.fromEntries((await fresh.peopleForTest()).map((p) => [p.displayName, p.id])) as Record<string, string>;
    await fresh.signOut();
    await fresh.sendCode('noprofile@example.com');
    await fresh.verifyCode('noprofile@example.com', '123456');
    await fresh.acceptDocuments();
    expect(await kindOf(fresh.follow(freshIds['Ana']!))).toBe('forbidden');
    expect(await kindOf(fresh.like(freshIds['Ana']!))).toBe('forbidden');

    const c = await people();
    await c.b.follow(c.ids['Dani']!);
    expect(c.b.noticesFor(c.ids['Dani']!).filter((n) => n.kind === 'follow')).toHaveLength(1);
    await c.b.deleteAccount();
    expect(c.b.noticesFor(c.ids['Dani']!).filter((n) => n.kind === 'follow')).toEqual([]);
  });

  test('moderation notices have no actor; the export lists your ties', async () => {
    const { b, ids } = await people();
    const me = (await b.session())!.userId;
    b.addNoticeForTest(me, 'Be kind.');
    expect((await b.listNotices()).find((n) => n.message === 'Be kind.')).toMatchObject({ kind: 'moderation', actor: null });
    await b.follow(ids['Ana']!);
    await b.like(ids['Ana']!);
    const data = await b.exportOwnData();
    expect(data['social']).toMatchObject({ following: [{ id: ids['Ana'] }], likesGiven: [{ id: ids['Ana'] }] });
  });
});

describe('fake backend: chat', () => {
  async function chat() {
    const b = createFakeSocialBackend({ seed: 'people' });
    const ids = Object.fromEntries((await b.peopleForTest()).map((p) => [p.displayName, p.id])) as Record<string, string>;
    const as = async (name: string) => {
      await b.verifyCode(`${name.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}@example.com`, '123456');
    };
    const withBia = async () => (await b.conversations()).find((c) => c.other.displayName === 'Bia')!;
    return { b, ids, as, withBia };
  }
  const errorOf = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as SocialError);

  test('the people seed has a conversation with Bia (with a correction) and a request from Ana', async () => {
    const { b, ids, withBia } = await chat();
    expect(await b.conversations()).toEqual([
      expect.objectContaining({ other: expect.objectContaining({ id: ids['Ana'], displayName: 'Ana' }), status: 'pending', requestedByMe: false, unread: 1 }),
      expect.objectContaining({ other: expect.objectContaining({ displayName: 'Bia' }), status: 'accepted', unread: 1 }),
    ]);
    const msgs = await b.messages((await withBia()).id, null);
    expect(msgs.length).toBeGreaterThanOrEqual(3);
    expect(msgs.flatMap((m) => m.corrections)).toEqual([expect.objectContaining({ authorId: ids['Bia'], thanked: false })]);
    await b.markRead((await withBia()).id);
    expect((await withBia()).unread).toBe(0);
  });

  test('only the two people read a conversation; others get nothing', async () => {
    const { b, as, withBia } = await chat();
    const c = (await withBia()).id;
    await as('Caio');
    expect(await b.conversations()).toEqual([]);
    expect(await b.messages(c, null)).toEqual([]);
    expect((await errorOf(b.sendMessage(c, 'hi')))?.kind).toBe('forbidden');
  });

  test('a request is pending until accepted; a decline is silent and a repeat changes nothing', async () => {
    const { b, ids, as } = await chat();
    const c = await b.requestConversation(ids['Dani']!, '  Hi Dani!  ');
    expect((await errorOf(b.sendMessage(c, 'hello?')))?.kind).toBe('forbidden');
    expect((await errorOf(b.respondConversation(c, true)))?.kind).toBe('forbidden');
    await as('Dani');
    expect(await b.conversations()).toEqual([expect.objectContaining({ id: c, status: 'pending', requestedByMe: false, preview: 'Hi Dani!' })]);
    await b.respondConversation(c, false);
    expect(await b.conversations()).toEqual([]);
    await as('Rian');
    expect((await b.conversations()).find((x) => x.id === c)).toMatchObject({ status: 'pending', requestedByMe: true });
    expect(await b.requestConversation(ids['Dani']!, 'again')).toBe(c);
    expect(await b.messages(c, null)).toHaveLength(1);
    expect((await errorOf(b.requestConversation(ids['Rian']!, 'me')))?.kind).toBe('forbidden');
    expect((await errorOf(b.requestConversation(ids['Gil']!, 'blocked')))?.kind).toBe('forbidden');
    expect((await errorOf(b.requestConversation(ids['Fabi']!, 'suspended')))?.kind).toBe('forbidden');
    expect((await errorOf(b.requestConversation(ids['Caio']!, '   ')))?.kind).toBe('unknown');
  });

  test('asking someone who asked you accepts their request; accepting opens the conversation', async () => {
    const { b, ids, as } = await chat();
    const fromAna = (await b.conversations()).find((x) => x.other.displayName === 'Ana')!;
    expect(await b.requestConversation(ids['Ana']!, 'Sure, let us talk!')).toBe(fromAna.id);
    expect((await b.conversations()).find((x) => x.id === fromAna.id)!.status).toBe('accepted');
    const c = await b.requestConversation(ids['Caio']!, 'Hi Caio');
    await as('Caio');
    await b.respondConversation(c, true);
    await b.sendMessage(c, 'Hi! Nice to meet you.');
    expect((await b.messages(c, null)).map((m) => m.body)).toEqual(['Hi Caio', 'Hi! Nice to meet you.']);
  });

  test('daily limits: 10 requests, 500 messages, 200 corrections', async () => {
    const { b, ids, as, withBia } = await chat();
    const extra: string[] = [];
    for (let i = 0; i < 4; i++) {
      await b.signOut();
      await b.verifyCode(`extra${i}@example.com`, '123456');
      await b.acceptDocuments();
      extra.push((await b.saveProfile({ ...draft, displayName: `Extra ${i}` })).id);
    }
    await as('Rian');
    const targets = ['Caio', 'Dani', 'Hugo', 'Iris', 'João', 'Lia', 'Max'].map((n) => ids[n]!).concat(extra);
    for (const t of targets.slice(0, 10)) await b.requestConversation(t, 'Hi!');
    expect(await errorOf(b.requestConversation(targets[10]!, 'Hi!'))).toMatchObject({ kind: 'rate_limited', message: 'request limit reached' });

    const c = (await withBia()).id;
    // The 10 first messages of the requests count; the seeded messages are older than a day.
    for (let i = 10; i < 500; i++) await b.sendMessage(c, `m${i}`);
    expect(await errorOf(b.sendMessage(c, 'one more'))).toMatchObject({ kind: 'rate_limited', message: 'message limit reached' });

    const fromBia: number[] = [];
    for (let i = 0; i < 201; i++) {
      b.sendAsForTest(ids['Bia']!, c, `b${i}`);
      fromBia.push((await b.messages(c, null)).at(-1)!.id);
    }
    for (const id of fromBia.slice(0, 200)) await b.suggestCorrection(id, 'fixed');
    expect(await errorOf(b.suggestCorrection(fromBia[200]!, 'x'))).toMatchObject({ kind: 'rate_limited', message: 'correction limit reached' });
  });

  test('delete empties your message and drops its corrections; corrections and Thanks follow the rules', async () => {
    const { b, ids, as, withBia } = await chat();
    const c = (await withBia()).id;
    await b.sendMessage(c, 'I has a bug');
    const mine = (await b.messages(c, null)).at(-1)!;
    expect((await errorOf(b.suggestCorrection(mine.id, 'I have a bug')))?.kind).toBe('forbidden');
    await as('Bia');
    await b.suggestCorrection(mine.id, 'I have a bug');
    expect((await errorOf(b.suggestCorrection(mine.id, 'I have a bug!')))?.kind).toBe('unknown');
    expect((await errorOf(b.deleteMessage(mine.id)))?.kind).toBe('forbidden');
    const k = (await b.messages(c, null)).at(-1)!.corrections[0]!;
    expect((await errorOf(b.thankCorrection(k.id)))?.kind).toBe('forbidden');
    await as('Rian');
    await b.thankCorrection(k.id);
    expect((await b.messages(c, null)).at(-1)!.corrections[0]!.thanked).toBe(true);
    await b.deleteMessage(mine.id);
    expect((await b.messages(c, null)).at(-1)).toMatchObject({ id: mine.id, body: '', deleted: true, corrections: [] });
    expect((await withBia()).preview).toBeNull();
    await as('Bia');
    expect((await errorOf(b.suggestCorrection(mine.id, 'x')))?.kind).toBe('forbidden');
  });

  test('a correction counts in the author\'s practice graph', async () => {
    const { b, ids, withBia } = await chat();
    const c = (await withBia()).id;
    b.sendAsForTest(ids['Bia']!, c, 'I goed home');
    const m = (await b.messages(c, null)).at(-1)!;
    await b.suggestCorrection(m.id, 'I went home');
    const graph = await b.practiceGraph(ids['Rian']!);
    expect(graph.days.at(-1)).toMatchObject({ corrections: 1 });
    expect(graph.current).toBeGreaterThanOrEqual(1);
    await b.publishPracticeDays([{ day: graph.days.at(-1)!.day, answers: 2, reviews: 0 }]);
    expect((await b.practiceGraph(ids['Rian']!)).days.at(-1)).toMatchObject({ answers: 2, corrections: 1 });
  });

  test('a block closes the conversation for both; unblocking opens it again', async () => {
    const { b, ids, as, withBia } = await chat();
    const c = (await withBia()).id;
    await b.block(ids['Bia']!);
    expect((await b.conversations()).map((x) => x.other.displayName)).toEqual(['Ana']);
    expect(await b.messages(c, null)).toEqual([]);
    await as('Bia');
    expect(await b.conversations()).toEqual([]);
    expect((await errorOf(b.sendMessage(c, 'hi')))?.kind).toBe('forbidden');
    await as('Rian');
    await b.unblock(ids['Bia']!);
    expect((await withBia()).id).toBe(c);
  });

  test('a message report keeps the message and the 10 before it for moderators only', async () => {
    const { b, ids, as, withBia } = await chat();
    const c = (await withBia()).id;
    for (let i = 1; i <= 12; i++) b.sendAsForTest(ids['Bia']!, c, `bia ${i}`);
    const target = (await b.messages(c, null)).find((m) => m.body === 'bia 11')!;
    await b.report({ reported: ids['Bia']!, contextType: 'message', contextId: String(target.id), reason: 'harassment', details: '' });
    b.addModeratorForTest(ids['Dani']!);
    await as('Dani');
    const report = (await b.listOpenReports()).find((r) => r.contextType === 'message')!;
    await as('Bia');
    await b.deleteMessage(target.id);
    expect(await b.reportContext(report.id)).toEqual([]);
    await as('Dani');
    const context = await b.reportContext(report.id);
    expect(context).toHaveLength(11);
    expect(context.at(-1)).toMatchObject({ body: 'bia 11', senderName: 'Bia', reported: true });
    expect(context.filter((m) => m.reported)).toHaveLength(1);
    // A report that names someone outside the conversation keeps no copy.
    await as('Rian');
    await b.report({ reported: ids['Caio']!, contextType: 'message', contextId: String(target.id), reason: 'spam', details: '' });
    await as('Dani');
    const other = (await b.listOpenReports()).find((r) => r.reported?.id === ids['Caio'])!;
    expect(await b.reportContext(other.id)).toEqual([]);
  });

  test('live events reach only people who can read the conversation, and stop after sign-out', async () => {
    const { b, ids, as, withBia } = await chat();
    const c = (await withBia()).id;
    const rian: unknown[] = [];
    const caio: unknown[] = [];
    const status: boolean[] = [];
    b.subscribe((e) => rian.push(e), (on) => status.push(on));
    await as('Caio');
    b.subscribe((e) => caio.push(e), () => undefined);
    b.sendAsForTest(ids['Bia']!, c, 'hello');
    expect(rian).toEqual([{ kind: 'message', conversationId: c }]);
    expect(caio).toEqual([]);
    expect(status).toEqual([true]);

    await as('Rian');
    const d = await b.requestConversation(ids['Dani']!, 'Hi Dani');
    expect(rian.at(-1)).toEqual({ kind: 'conversation', conversationId: d });
    const before = rian.length;
    await as('Dani');
    await b.respondConversation(d, false);
    expect(rian).toHaveLength(before);

    await b.signOut();
    b.sendAsForTest(ids['Bia']!, c, 'still there?');
    expect(rian).toHaveLength(before);
  });

  test('the export has your own messages and corrections, not the other person\'s', async () => {
    const { b, ids, withBia } = await chat();
    const c = (await withBia()).id;
    await b.sendMessage(c, 'Mine to keep');
    b.sendAsForTest(ids['Bia']!, c, 'Hers');
    const data = (await b.exportOwnData())['chat'] as { messagesSent: { body: string }[]; correctionsGiven: unknown[]; conversations: { with: string }[] };
    expect(data.messagesSent.map((m) => m.body)).toContain('Mine to keep');
    expect(data.messagesSent.map((m) => m.body)).not.toContain('Hers');
    expect(data.conversations.map((x) => x.with)).toEqual(expect.arrayContaining([ids['Bia'], ids['Ana']]));
    expect(data.correctionsGiven).toEqual([]);
  });

  test('deleting your account removes your conversations and messages', async () => {
    const { b, as, withBia } = await chat();
    const c = (await withBia()).id;
    await b.deleteAccount();
    await as('Bia');
    expect(await b.conversations()).toEqual([]);
    expect(await b.messages(c, null)).toEqual([]);
  });
});

describe('fake backend: rooms', () => {
  const T0 = Date.parse('2026-10-20T12:00:00.000Z');
  const SECOND = 1000;
  const MINUTE = 60_000;
  const draft: RoomDraft = { title: 'Code review night', theme: 'code_review', level: 'B2' };

  /** Signed in as Rian among the seeded people, with a clock the test moves. `as` runs a call as another member. */
  async function rooms() {
    let t = T0;
    const b = createFakeSocialBackend({ seed: 'people', now: () => t });
    const ids = Object.fromEntries((await b.peopleForTest()).map((p) => [p.displayName, p.id])) as Record<string, string>;
    const as = async <T,>(name: string, act: (x: SocialBackend) => Promise<T>) => (await b.actAsForTest(ids[name]!, act)) as T;
    const advance = (ms: number) => {
      t += ms;
    };
    const joinAll = async (room: string, names: string[]) => {
      for (const name of names) await as(name, (x) => x.joinRoom(room));
    };
    const stateOf = async (name: string, room: string) => as(name, (x) => x.roomState(room));
    /** Listens to one room as `name` (events go to `log`). */
    const listen = async (name: string, room: string) => {
      const log: RoomLiveEvent[] = [];
      await as(name, async (x) => {
        x.subscribeRoom(room, (e) => log.push(e));
      });
      return {
        log,
        changes: () => log.filter((e) => e.kind === 'changed').length,
        signals: () => log.filter((e) => e.kind === 'signal'),
      };
    };
    return { b, ids, as, advance, joinAll, stateOf, listen };
  }
  const errorOf = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as SocialError);
  const titles = (list: { title: string }[]) => list.map((r) => r.title);
  const personOf = (name: string, id: string, level = 'B1', role = 'member', muted = false) => ({ id, displayName: name, hasAvatar: false, mascot: null, level, role, muted });

  test('the people seed has Bia\'s stand-up room with Caio inside, and seeded people stay live', async () => {
    const { b, ids, advance } = await rooms();
    const bia = { id: ids['Bia'], displayName: 'Bia', hasAvatar: false, mascot: null };
    const caio = { id: ids['Caio'], displayName: 'Caio', hasAvatar: false, mascot: null };
    const expected = [{ id: expect.any(String), title: 'Stand-up practice', theme: 'standup', level: 'B1', hostName: 'Bia', people: [bia, caio] }];
    expect(await b.liveRooms()).toEqual(expected);
    advance(3 * 60 * MINUTE);
    expect(await b.liveRooms()).toEqual(expected);
    // Rian was never there: the room is not his to read.
    expect(await b.roomState((await b.liveRooms())[0]!.id)).toBeNull();
  });

  test('joining Bia\'s room puts you last in the list of people', async () => {
    const { b, ids } = await rooms();
    const room = (await b.liveRooms())[0]!.id;
    await b.joinRoom(room);
    expect(await b.roomState(room)).toEqual({
      id: room, title: 'Stand-up practice', theme: 'standup', level: 'B1', hostId: ids['Bia'], endedAt: null, timer: null, card: 0,
      me: { live: true, removed: false, role: 'member', muteRequestedAt: null },
      people: [personOf('Bia', ids['Bia']!, 'B1', 'host'), personOf('Caio', ids['Caio']!, 'B2'), personOf('Rian', ids['Rian']!)],
    });
    expect((await b.liveRooms())[0]!.people.map((p) => p.displayName)).toEqual(['Bia', 'Caio', 'Rian']);
    // Joining the room you are live in again changes nothing.
    await b.joinRoom(room);
    expect((await b.liveRooms())[0]!.people).toHaveLength(3);
    expect((await b.exportOwnData())['rooms']).toMatchObject({ sessions: [expect.objectContaining({ roomId: room })] });
  });

  test('creating a room makes you its host and live; other members see it, newest first', async () => {
    const { b, ids, as } = await rooms();
    const room = await b.createRoom({ title: '  Code review night ', theme: 'code_review', level: 'B2' });
    expect(await b.roomState(room)).toEqual({
      id: room, title: 'Code review night', theme: 'code_review', level: 'B2', hostId: ids['Rian'], endedAt: null, timer: null, card: 0,
      me: { live: true, removed: false, role: 'host', muteRequestedAt: null },
      people: [personOf('Rian', ids['Rian']!, 'B1', 'host')],
    });
    const list = await as('Ana', (x) => x.liveRooms());
    expect(titles(list)).toEqual(['Code review night', 'Stand-up practice']);
    expect(list[0]).toMatchObject({ id: room, level: 'B2', theme: 'code_review', hostName: 'Rian', people: [{ id: ids['Rian'], displayName: 'Rian' }] });
  });

  test('a title is 3 to 60 characters after trimming; the theme and the level must be known', async () => {
    const { b } = await rooms();
    const bad = (over: Partial<RoomDraft>) => errorOf(b.createRoom({ title: 'Good title', theme: 'free', level: null, ...over }));
    for (const title of ['', '  ab  ', 'x'.repeat(61), '   \n ']) {
      expect(await bad({ title })).toMatchObject({ kind: 'unknown', message: 'room title is not valid' });
    }
    expect(await bad({ theme: 'party' as never })).toMatchObject({ kind: 'unknown', message: 'room theme is not valid' });
    expect(await bad({ level: 'D9' as never })).toMatchObject({ kind: 'unknown', message: 'room level is not valid' });
    expect(titles(await b.liveRooms())).toEqual(['Stand-up practice']);
    for (const title of ['abc', 'x'.repeat(60), '😀😀😀', '  a b  ']) await b.createRoom({ title, theme: 'free', level: null });
    expect(titles(await b.liveRooms())).toEqual(['a b', 'Stand-up practice']);
  });

  test('only a member in good standing with a profile opens or joins a room', async () => {
    const { b, ids } = await rooms();
    const seeded = (await b.liveRooms())[0]!.id;
    b.suspendForTest(ids['Rian']!, '2099-01-01T00:00:00.000Z');
    expect(await kindOf(b.createRoom(draft))).toBe('forbidden');
    expect(await kindOf(b.joinRoom(seeded))).toBe('forbidden');
    expect(await b.liveRooms()).toEqual([]);
    b.suspendForTest(ids['Rian']!, '2000-01-01T00:00:00.000Z');
    await b.signOut();
    await b.verifyCode('noprofile@example.com', '123456');
    await b.acceptDocuments();
    expect(await kindOf(b.createRoom(draft))).toBe('forbidden');
    expect(await kindOf(b.joinRoom(seeded))).toBe('forbidden');
  });

  test('the 11th room in a day fails with room limit reached; a day later you can open one again', async () => {
    const { b, advance } = await rooms();
    for (let i = 1; i <= 10; i++) await b.createRoom({ ...draft, title: `Room number ${i}` });
    expect(await errorOf(b.createRoom(draft))).toMatchObject({ kind: 'rate_limited', message: 'room limit reached' });
    advance(24 * 60 * MINUTE + SECOND);
    await b.createRoom(draft);
  });

  test('the 7th person gets room is full; a silent seat frees after 90 seconds and a leaving person frees theirs', async () => {
    const { b, as, advance, joinAll, stateOf } = await rooms();
    const room = await b.createRoom(draft);
    await joinAll(room, ['Ana', 'Dani', 'Hugo', 'Iris', 'João']);
    expect((await b.roomState(room))!.people).toHaveLength(6);
    expect(await errorOf(as('Lia', (x) => x.joinRoom(room)))).toMatchObject({ kind: 'unknown', message: 'room is full' });
    // Rian keeps saying he is here; the other five go quiet for 91 seconds.
    advance(60 * SECOND);
    expect(await b.roomHeartbeat(room)).toBe(true);
    advance(31 * SECOND);
    await as('Lia', (x) => x.joinRoom(room));
    expect((await b.roomState(room))!.people.map((p) => p.displayName)).toEqual(['Rian', 'Lia']);
    expect((await stateOf('Ana', room))!.me.live).toBe(false);
    await joinAll(room, ['Max', 'Ana', 'Dani', 'Hugo']);
    expect(await errorOf(as('Iris', (x) => x.joinRoom(room)))).toMatchObject({ message: 'room is full' });
    await as('Lia', (x) => x.leaveRoom(room));
    await as('Iris', (x) => x.joinRoom(room));
    expect((await b.roomState(room))!.people).toHaveLength(6);
  });

  test('one room at a time: joining another room leaves the first, which passes on or ends', async () => {
    const { b, as, stateOf } = await rooms();
    const first = await b.createRoom(draft);
    await as('Ana', (x) => x.joinRoom(first));
    const second = await b.createRoom({ ...draft, title: 'A second room' });
    expect((await stateOf('Ana', first))!.hostId).toBe((await stateOf('Ana', first))!.people[0]!.id);
    expect((await stateOf('Ana', first))!.people.map((p) => p.displayName)).toEqual(['Ana']);
    expect((await b.roomState(first))!.me).toMatchObject({ live: false, role: 'member' });
    await as('Ana', (x) => x.joinRoom(second));
    expect(await stateOf('Ana', first)).toMatchObject({ endedAt: expect.any(String), me: { live: false } });
    expect(titles(await b.liveRooms())).toEqual(['A second room', 'Stand-up practice']);
    expect((await b.roomState(second))!.people.map((p) => p.displayName)).toEqual(['Rian', 'Ana']);
    // Joining a room that has ended, or one that does not exist, says so.
    const ended = { kind: 'unknown', message: 'room has ended' };
    expect(await errorOf(as('Dani', (x) => x.joinRoom(first)))).toMatchObject(ended);
    expect(await errorOf(as('Dani', (x) => x.joinRoom('00000000-0000-4000-8000-999999999999')))).toMatchObject(ended);
  });

  test('a dropped host is replaced when someone\'s heartbeat settles the room, and a room nobody is in leaves the list', async () => {
    const { b, ids, as, advance, stateOf } = await rooms();
    const room = await b.createRoom(draft);
    await as('Ana', (x) => x.joinRoom(room));
    advance(60 * SECOND);
    expect(await as('Ana', (x) => x.roomHeartbeat(room))).toBe(true);
    advance(40 * SECOND);
    // Rian has been silent for 100 seconds: the list already shows only Ana.
    expect((await as('Dani', (x) => x.liveRooms())).find((r) => r.id === room)!.people.map((p) => p.displayName)).toEqual(['Ana']);
    expect(await as('Ana', (x) => x.roomHeartbeat(room))).toBe(true);
    expect((await stateOf('Ana', room))!.hostId).toBe(ids['Ana']);
    expect(await b.roomState(room)).toMatchObject({ hostId: ids['Ana'], me: { live: false }, people: [] });
    // Then Ana goes quiet too, and the room is gone from the list.
    advance(100 * SECOND);
    expect((await as('Dani', (x) => x.liveRooms())).map((r) => r.id)).not.toContain(room);
    expect(await as('Ana', (x) => x.roomHeartbeat(room))).toBe(false);
    expect((await stateOf('Ana', room))!.endedAt).not.toBeNull();
  });

  test('a room whose people all went silent has ended for whoever comes; removed and blocked people still get not allowed', async () => {
    const { b, ids, as, advance } = await rooms();
    const room = await b.createRoom(draft);
    await as('Ana', (x) => x.joinRoom(room));
    advance(91 * SECOND);
    expect(await errorOf(as('Dani', (x) => x.joinRoom(room)))).toMatchObject({ kind: 'unknown', message: 'room has ended' });
    const open = await as('Dani', (x) => x.createRoom({ ...draft, title: 'Still open' }));
    await as('Hugo', (x) => x.joinRoom(open));
    await as('Dani', (x) => x.removeFromRoom(open, ids['Hugo']!));
    expect(await kindOf(as('Hugo', (x) => x.joinRoom(open)))).toBe('forbidden');
    await as('Dani', (x) => x.block(ids['Iris']!));
    expect(await kindOf(as('Iris', (x) => x.joinRoom(open)))).toBe('forbidden');
  });

  test('30 room actions a minute per person, then room action limit reached; repeats that change nothing are free', async () => {
    const { b, ids, as, advance, joinAll } = await rooms();
    const room = await b.createRoom(draft);
    await joinAll(room, ['Ana', 'Dani']);
    await b.setRoomTimer(room, 60);
    await b.setRoomMuted(room, true);
    for (let i = 0; i < 28; i++) await b.nextCard(room);
    const limited = { kind: 'rate_limited', message: 'room action limit reached' };
    const refused = [
      () => b.setRoomMuted(room, false),
      () => b.nextCard(room),
      () => b.setRoomTimer(room, 90),
      () => b.setRoomTimer(room, null),
      () => b.muteMember(room, ids['Ana']!),
      () => b.makeRoomModerator(room, ids['Ana']!),
      () => b.removeRoomModerator(room, ids['Ana']!),
      () => b.passHost(room, ids['Ana']!),
      () => b.removeFromRoom(room, ids['Dani']!),
    ];
    for (const act of refused) expect(await errorOf(act())).toMatchObject(limited);
    const s = (await b.roomState(room))!;
    expect(s).toMatchObject({ card: 28, hostId: ids['Rian'], timer: { seconds: 60 } });
    expect(s.people.map((p) => [p.displayName, p.role, p.muted])).toEqual([['Rian', 'host', true], ['Ana', 'member', false], ['Dani', 'member', false]]);
    expect((await as('Ana', (x) => x.roomState(room)))!.me.muteRequestedAt).toBeNull();
    // Saying again what is already so is free.
    await b.setRoomMuted(room, true);
    // Per person, and a refused call is not counted: Ana still has 30.
    expect(await kindOf(as('Ana', (x) => x.muteMember(room, ids['Rian']!)))).toBe('forbidden');
    for (let i = 0; i < 30; i++) await as('Ana', (x) => x.nextCard(room));
    expect(await errorOf(as('Ana', (x) => x.nextCard(room)))).toMatchObject(limited);
    // A minute later Rian acts again; stopping a timer that is not running is free.
    advance(61 * SECOND);
    await b.setRoomTimer(room, null);
    await b.setRoomTimer(room, null);
    for (let i = 0; i < 29; i++) await b.nextCard(room);
    expect(await errorOf(b.nextCard(room))).toMatchObject(limited);
  });

  test('a person sends at most 5 000 signals a day; deleting old signals or ending the room does not reset the count', async () => {
    const { b, ids, as, advance, joinAll } = await rooms();
    const room = await b.createRoom(draft);
    await joinAll(room, ['Ana']);
    // 4 999 signals in 10 minutes (under 600 a minute); heartbeats keep both seats and delete the old signals.
    for (let minute = 0; minute < 10; minute++) {
      for (let i = 0; i < (minute === 9 ? 499 : 500); i++) await b.sendRoomSignal(room, ids['Ana']!, 'candidate', '{}');
      advance(61 * SECOND);
      expect(await b.roomHeartbeat(room)).toBe(true);
      expect(await as('Ana', (x) => x.roomHeartbeat(room))).toBe(true);
    }
    await b.sendRoomSignal(room, ids['Ana']!, 'candidate', '{}');
    const limited = { kind: 'rate_limited', message: 'signal limit reached' };
    expect(await errorOf(b.sendRoomSignal(room, ids['Ana']!, 'candidate', '{}'))).toMatchObject(limited);
    // Per sender: Ana still sends.
    await as('Ana', (x) => x.sendRoomSignal(room, ids['Rian']!, 'candidate', '{}'));
    // A new room does not reset it.
    await b.endRoom(room);
    const next = await b.createRoom({ ...draft, title: 'Next room' });
    await as('Ana', (x) => x.joinRoom(next));
    expect(await errorOf(b.sendRoomSignal(next, ids['Ana']!, 'candidate', '{}'))).toMatchObject(limited);
    // A day later (counted by the hour) Rian may send again.
    advance(25 * 60 * MINUTE);
    const later = await b.createRoom({ ...draft, title: 'A day later' });
    await as('Ana', (x) => x.joinRoom(later));
    await b.sendRoomSignal(later, ids['Ana']!, 'candidate', '{}');
  });

  test('a heartbeat is true while you are live, and false when you never joined, left or went silent', async () => {
    const { b, as, advance } = await rooms();
    const room = await b.createRoom(draft);
    expect(await as('Ana', (x) => x.roomHeartbeat(room))).toBe(false);
    await as('Ana', (x) => x.joinRoom(room));
    advance(80 * SECOND);
    expect(await as('Ana', (x) => x.roomHeartbeat(room))).toBe(true);
    expect(await b.roomHeartbeat(room)).toBe(true);
    await as('Ana', (x) => x.leaveRoom(room));
    expect(await as('Ana', (x) => x.roomHeartbeat(room))).toBe(false);
    advance(91 * SECOND);
    expect(await b.roomHeartbeat(room)).toBe(false);
    expect(await b.roomHeartbeat('00000000-0000-4000-8000-999999999999')).toBe(false);
  });

  test('when the host leaves the room goes to the oldest room moderator, else to who came first; the last person ends it', async () => {
    const { b, ids, as, advance, stateOf } = await rooms();
    const room = await b.createRoom(draft);
    for (const name of ['Ana', 'Dani', 'Hugo']) {
      advance(SECOND);
      await as(name, (x) => x.joinRoom(room));
    }
    await b.makeRoomModerator(room, ids['Hugo']!);
    await b.leaveRoom(room);
    expect((await stateOf('Ana', room))!.hostId).toBe(ids['Hugo']);
    expect((await stateOf('Ana', room))!.people.map((p) => [p.displayName, p.role])).toEqual([['Ana', 'member'], ['Dani', 'member'], ['Hugo', 'host']]);
    await as('Hugo', (x) => x.leaveRoom(room));
    expect((await stateOf('Dani', room))!.hostId).toBe(ids['Ana']);
    await as('Ana', (x) => x.leaveRoom(room));
    expect((await stateOf('Dani', room))!.hostId).toBe(ids['Dani']);
    await as('Dani', (x) => x.leaveRoom(room));
    expect(await stateOf('Dani', room)).toMatchObject({ endedAt: expect.any(String), me: { live: false } });
    expect(titles(await b.liveRooms())).toEqual(['Stand-up practice']);
    // Leaving a room you are not in does nothing.
    await b.leaveRoom(room);
  });

  test('only the host gives and takes Room moderator and passes the host role, and only to someone live in the room', async () => {
    const { b, ids, as, joinAll, stateOf } = await rooms();
    const room = await b.createRoom(draft);
    await joinAll(room, ['Ana', 'Dani']);
    expect(await kindOf(as('Ana', (x) => x.makeRoomModerator(room, ids['Dani']!)))).toBe('forbidden');
    expect(await kindOf(as('Ana', (x) => x.passHost(room, ids['Ana']!)))).toBe('forbidden');
    expect(await kindOf(b.makeRoomModerator(room, ids['Rian']!))).toBe('forbidden');
    expect(await kindOf(b.makeRoomModerator(room, ids['Hugo']!))).toBe('forbidden');
    expect(await kindOf(b.passHost(room, ids['Hugo']!))).toBe('forbidden');
    await b.makeRoomModerator(room, ids['Ana']!);
    expect((await b.roomState(room))!.people.map((p) => p.role)).toEqual(['host', 'moderator', 'member']);
    expect(await kindOf(as('Ana', (x) => x.removeRoomModerator(room, ids['Ana']!)))).toBe('forbidden');
    await b.removeRoomModerator(room, ids['Ana']!);
    expect((await b.roomState(room))!.people.map((p) => p.role)).toEqual(['host', 'member', 'member']);
    await b.passHost(room, ids['Ana']!);
    expect((await stateOf('Dani', room))!.hostId).toBe(ids['Ana']);
    expect((await b.roomState(room))!.me.role).toBe('member');
    expect(await kindOf(b.makeRoomModerator(room, ids['Dani']!))).toBe('forbidden');
    await as('Ana', (x) => x.makeRoomModerator(room, ids['Rian']!));
    expect((await b.roomState(room))!.me.role).toBe('moderator');
  });

  test('the host and a room moderator ask people to mute; a member cannot, and nobody mutes the host', async () => {
    const { b, ids, as, joinAll, stateOf } = await rooms();
    const room = await b.createRoom(draft);
    await joinAll(room, ['Ana', 'Dani']);
    expect(await kindOf(as('Ana', (x) => x.muteMember(room, ids['Dani']!)))).toBe('forbidden');
    await b.makeRoomModerator(room, ids['Ana']!);
    await as('Ana', (x) => x.muteMember(room, ids['Dani']!));
    expect((await stateOf('Dani', room))!.me.muteRequestedAt).toBe(new Date(T0).toISOString());
    expect(await kindOf(as('Ana', (x) => x.muteMember(room, ids['Rian']!)))).toBe('forbidden');
    expect(await kindOf(as('Dani', (x) => x.muteMember(room, ids['Rian']!)))).toBe('forbidden');
    expect(await kindOf(as('Ana', (x) => x.muteMember(room, ids['Ana']!)))).toBe('forbidden');
    await b.muteMember(room, ids['Ana']!);
    expect((await stateOf('Ana', room))!.me.muteRequestedAt).not.toBeNull();
    // Nobody who is not in the room is muted, and nobody outside mutes.
    expect(await kindOf(b.muteMember(room, ids['Hugo']!))).toBe('forbidden');
    expect(await kindOf(as('Hugo', (x) => x.muteMember(room, ids['Dani']!)))).toBe('forbidden');
  });

  test('you set your own microphone state; the others see it; the same state again tells nobody; a new session starts unmuted', async () => {
    const { b, ids, as, joinAll, stateOf, listen } = await rooms();
    const room = await b.createRoom(draft);
    await joinAll(room, ['Ana']);
    const ana = await listen('Ana', room);
    const rianMuted = async () => (await stateOf('Ana', room))!.people.find((p) => p.id === ids['Rian'])!.muted;
    expect(await rianMuted()).toBe(false);
    await b.setRoomMuted(room, true);
    expect(await rianMuted()).toBe(true);
    expect((await b.roomState(room))!.people.find((p) => p.id === ids['Ana'])!.muted).toBe(false);
    expect(ana.changes()).toBe(1);
    await b.setRoomMuted(room, true);
    expect(ana.changes()).toBe(1);
    await b.setRoomMuted(room, false);
    expect(await rianMuted()).toBe(false);
    expect(ana.changes()).toBe(2);
    // Only someone live in the room.
    expect(await kindOf(as('Hugo', (x) => x.setRoomMuted(room, true)))).toBe('forbidden');
    await as('Ana', (x) => x.setRoomMuted(room, true));
    await as('Ana', (x) => x.leaveRoom(room));
    expect(await kindOf(as('Ana', (x) => x.setRoomMuted(room, false)))).toBe('forbidden');
    await as('Ana', (x) => x.joinRoom(room));
    expect((await b.roomState(room))!.people.find((p) => p.id === ids['Ana'])!.muted).toBe(false);
  });

  test('the host removes anyone else, a room moderator removes a member only, and a removed person cannot return', async () => {
    const { b, ids, as, joinAll, stateOf } = await rooms();
    const room = await b.createRoom(draft);
    await joinAll(room, ['Ana', 'Dani', 'Hugo', 'Iris']);
    await b.makeRoomModerator(room, ids['Ana']!);
    await b.makeRoomModerator(room, ids['Dani']!);
    expect(await kindOf(as('Iris', (x) => x.removeFromRoom(room, ids['Hugo']!)))).toBe('forbidden');
    expect(await kindOf(as('Ana', (x) => x.removeFromRoom(room, ids['Dani']!)))).toBe('forbidden');
    expect(await kindOf(as('Ana', (x) => x.removeFromRoom(room, ids['Rian']!)))).toBe('forbidden');
    expect(await kindOf(b.removeFromRoom(room, ids['Rian']!))).toBe('forbidden');
    expect(await kindOf(b.removeFromRoom(room, ids['Lia']!))).toBe('forbidden');
    await as('Ana', (x) => x.removeFromRoom(room, ids['Hugo']!));
    expect(await stateOf('Hugo', room)).toMatchObject({ me: { live: false, removed: true }, people: [] });
    expect(await kindOf(as('Hugo', (x) => x.joinRoom(room)))).toBe('forbidden');
    // The room leaves the removed person's list; the others still see it.
    expect((await as('Hugo', (x) => x.liveRooms())).map((r) => r.id)).not.toContain(room);
    expect((await as('Lia', (x) => x.liveRooms())).map((r) => r.id)).toContain(room);
    expect(await as('Hugo', (x) => x.roomHeartbeat(room))).toBe(false);
    await b.removeFromRoom(room, ids['Dani']!);
    expect((await b.roomState(room))!.people.map((p) => p.displayName)).toEqual(['Rian', 'Ana', 'Iris']);
    expect((await stateOf('Dani', room))!.me.removed).toBe(true);
    expect(await kindOf(as('Dani', (x) => x.joinRoom(room)))).toBe('forbidden');
    // Hugo can still join another room, just not this one.
    const other = await b.createRoom({ ...draft, title: 'Another room' });
    await as('Hugo', (x) => x.joinRoom(other));
  });

  test('only the host ends the room, and it ends for everyone', async () => {
    const { b, ids, as, joinAll, stateOf } = await rooms();
    const room = await b.createRoom(draft);
    await joinAll(room, ['Ana', 'Dani']);
    await b.setRoomTimer(room, 60);
    expect(await kindOf(as('Ana', (x) => x.endRoom(room)))).toBe('forbidden');
    expect((await b.roomState(room))!.endedAt).toBeNull();
    await b.endRoom(room);
    for (const name of ['Ana', 'Dani']) {
      expect(await stateOf(name, room)).toMatchObject({ endedAt: new Date(T0).toISOString(), timer: null, me: { live: false }, people: [] });
    }
    expect(await b.roomState(room)).toMatchObject({ hostId: ids['Rian'], endedAt: expect.any(String) });
    expect(titles(await b.liveRooms())).toEqual(['Stand-up practice']);
    expect(await errorOf(as('Hugo', (x) => x.joinRoom(room)))).toMatchObject({ kind: 'unknown', message: 'room has ended' });
    expect(await as('Ana', (x) => x.roomHeartbeat(room))).toBe(false);
    expect(await kindOf(b.endRoom(room))).toBe('forbidden');
    expect(await kindOf(b.setRoomTimer(room, 90))).toBe('forbidden');
  });

  test('the timer runs 60 or 90 seconds, anyone live starts and stops it, and the idea card moves on', async () => {
    const { b, as, advance, joinAll, stateOf } = await rooms();
    const room = await b.createRoom(draft);
    await joinAll(room, ['Ana']);
    await as('Ana', (x) => x.setRoomTimer(room, 60));
    expect((await b.roomState(room))!.timer).toEqual({ startedAt: new Date(T0).toISOString(), seconds: 60 });
    advance(20 * SECOND);
    await b.setRoomTimer(room, 90);
    expect((await stateOf('Ana', room))!.timer).toEqual({ startedAt: new Date(T0 + 20 * SECOND).toISOString(), seconds: 90 });
    expect(await errorOf(b.setRoomTimer(room, 45 as RoomTimer))).toMatchObject({ kind: 'unknown', message: 'timer is not valid' });
    expect((await b.roomState(room))!.timer!.seconds).toBe(90);
    await as('Ana', (x) => x.setRoomTimer(room, null));
    expect((await b.roomState(room))!.timer).toBeNull();
    await b.setRoomTimer(room, null);
    await b.nextCard(room);
    await as('Ana', (x) => x.nextCard(room));
    expect((await stateOf('Ana', room))!.card).toBe(2);
    // Outsiders can do neither.
    expect(await kindOf(as('Dani', (x) => x.setRoomTimer(room, 60)))).toBe('forbidden');
    expect(await kindOf(as('Dani', (x) => x.setRoomTimer(room, null)))).toBe('forbidden');
    expect(await kindOf(as('Dani', (x) => x.nextCard(room)))).toBe('forbidden');
    expect((await b.roomState(room))!.card).toBe(2);
  });

  test('people blocked with someone inside neither see nor join the room', async () => {
    const { b, ids, as } = await rooms();
    // The seed has Gil blocking Rian.
    const gils = await as('Gil', (x) => x.createRoom({ ...draft, title: 'Gil\'s room' }));
    expect(titles(await b.liveRooms())).toEqual(['Stand-up practice']);
    expect(await kindOf(b.joinRoom(gils))).toBe('forbidden');
    expect(titles(await as('Gil', (x) => x.liveRooms()))).toEqual(["Gil's room", 'Stand-up practice']);
    // Blocking after the fact hides a room too, in both directions.
    const danis = await as('Dani', (x) => x.createRoom({ ...draft, title: 'Dani\'s room' }));
    expect(titles(await b.liveRooms())).toContain("Dani's room");
    await b.block(ids['Dani']!);
    expect(titles(await b.liveRooms())).not.toContain("Dani's room");
    expect(await kindOf(b.joinRoom(danis))).toBe('forbidden');
    // Dani's room has only Dani inside, and Rian blocked Dani: Dani sees their own room, Rian does not.
    expect(titles(await as('Dani', (x) => x.liveRooms()))).toContain("Dani's room");
    await b.unblock(ids['Dani']!);
    await b.joinRoom(danis);
  });

  test('a block made inside a room takes the blocker out, never the blocked person', async () => {
    const { b, ids, as, stateOf } = await rooms();
    const room = await b.createRoom(draft);
    await as('Dani', (x) => x.joinRoom(room));
    await as('Ana', (x) => x.joinRoom(room));
    await b.block(ids['Dani']!);
    expect(await b.roomState(room)).toMatchObject({ me: { live: false }, people: [] });
    expect((await stateOf('Dani', room))!.me.live).toBe(true);
    expect((await stateOf('Dani', room))!.people.map((p) => p.displayName)).toEqual(['Dani', 'Ana']);
    // Dani and Ana are still inside; the host role went to who was there first.
    expect((await stateOf('Dani', room))!.hostId).toBe(ids['Dani']);
    // Blocking someone who is not in your room changes nothing in it.
    await as('Dani', (x) => x.block(ids['Hugo']!));
    expect((await stateOf('Dani', room))!.me.live).toBe(true);
    // Rian cannot come back while Dani is inside.
    expect(await kindOf(b.joinRoom(room))).toBe('forbidden');
  });

  test('signals reach only their recipient, between people live in the same room', async () => {
    const { b, ids, as, joinAll, listen } = await rooms();
    const room = await b.createRoom(draft);
    await joinAll(room, ['Ana', 'Dani']);
    const rian = await listen('Rian', room);
    const ana = await listen('Ana', room);
    const dani = await listen('Dani', room);
    await b.sendRoomSignal(room, ids['Ana']!, 'offer', '{"sdp":"v=0"}');
    await as('Ana', (x) => x.sendRoomSignal(room, ids['Rian']!, 'answer', '{"sdp":"v=1"}'));
    await as('Dani', (x) => x.sendRoomSignal(room, ids['Ana']!, 'candidate', '{"c":1}'));
    await as('Dani', (x) => x.sendRoomSignal(room, ids['Rian']!, 'bye', ''));
    expect(ana.signals()).toEqual([
      { kind: 'signal', from: ids['Rian'], signal: 'offer', payload: '{"sdp":"v=0"}' },
      { kind: 'signal', from: ids['Dani'], signal: 'candidate', payload: '{"c":1}' },
    ]);
    expect(rian.signals()).toEqual([
      { kind: 'signal', from: ids['Ana'], signal: 'answer', payload: '{"sdp":"v=1"}' },
      { kind: 'signal', from: ids['Dani'], signal: 'bye', payload: '' },
    ]);
    expect(dani.signals()).toEqual([]);
    // Not to yourself, not to someone outside, not from someone outside, not in a room that is not shared.
    expect(await kindOf(b.sendRoomSignal(room, ids['Rian']!, 'offer', '{}'))).toBe('forbidden');
    expect(await kindOf(b.sendRoomSignal(room, ids['Hugo']!, 'offer', '{}'))).toBe('forbidden');
    expect(await kindOf(as('Hugo', (x) => x.sendRoomSignal(room, ids['Ana']!, 'offer', '{}')))).toBe('forbidden');
    const standup = (await b.liveRooms()).find((r) => r.title === 'Stand-up practice')!.id;
    expect(await kindOf(b.sendRoomSignal(standup, ids['Bia']!, 'offer', '{}'))).toBe('forbidden');
    // After someone leaves, nothing is delivered to or from them.
    await as('Ana', (x) => x.leaveRoom(room));
    expect(await kindOf(b.sendRoomSignal(room, ids['Ana']!, 'offer', '{}'))).toBe('forbidden');
    expect(await kindOf(as('Ana', (x) => x.sendRoomSignal(room, ids['Rian']!, 'bye', '')))).toBe('forbidden');
    expect(ana.signals()).toHaveLength(2);
  });

  test('a signal holds at most 16 384 bytes (not characters) and a person sends at most 600 a minute', async () => {
    const { b, ids, advance, joinAll } = await rooms();
    const room = await b.createRoom(draft);
    await joinAll(room, ['Ana']);
    await b.sendRoomSignal(room, ids['Ana']!, 'offer', 'x'.repeat(16_384));
    expect(await errorOf(b.sendRoomSignal(room, ids['Ana']!, 'offer', 'x'.repeat(16_385)))).toMatchObject({ kind: 'unknown' });
    expect(await errorOf(b.sendRoomSignal(room, ids['Ana']!, 'offer', 'é'.repeat(8193)))).toMatchObject({ kind: 'unknown' });
    await b.sendRoomSignal(room, ids['Ana']!, 'offer', 'é'.repeat(8192));
    // 2 signals have gone out so far.
    for (let i = 0; i < 598; i++) await b.sendRoomSignal(room, ids['Ana']!, 'candidate', '{}');
    expect(await errorOf(b.sendRoomSignal(room, ids['Ana']!, 'candidate', '{}'))).toMatchObject({ kind: 'rate_limited', message: 'signal limit reached' });
    advance(61 * SECOND);
    await b.sendRoomSignal(room, ids['Ana']!, 'candidate', '{}');
  });

  test('room events go to people live in that room and to the person just muted, removed or sent out; heartbeats are silent', async () => {
    const { b, ids, as, joinAll, listen } = await rooms();
    const standupRoom = (await b.liveRooms())[0]!.id;
    const room = await b.createRoom(draft);
    const rian = await listen('Rian', room);
    const ana = await listen('Ana', room);
    const dani = await listen('Dani', room);
    const caio = await listen('Caio', standupRoom);
    const hugo = await listen('Hugo', room);
    expect(rian.log).toEqual([{ kind: 'online' }]);
    await joinAll(room, ['Ana', 'Dani']);
    // Ana's own join reaches her, the host and Dani only once each time someone comes in.
    expect([rian.changes(), ana.changes(), dani.changes()]).toEqual([2, 2, 1]);
    const base = [rian.changes(), ana.changes(), dani.changes()];
    await as('Ana', (x) => x.roomHeartbeat(room));
    await b.roomHeartbeat(room);
    expect([rian.changes(), ana.changes(), dani.changes()]).toEqual(base);
    await b.setRoomTimer(room, 60);
    await as('Dani', (x) => x.nextCard(room));
    expect([rian.changes(), ana.changes(), dani.changes()]).toEqual([base[0]! + 2, base[1]! + 2, base[2]! + 2]);
    // Muting reaches the muted person; removing reaches the person removed, once, and then they hear no more.
    await b.muteMember(room, ids['Dani']!);
    expect(dani.changes()).toBe(base[2]! + 3);
    await b.removeFromRoom(room, ids['Dani']!);
    expect(dani.changes()).toBe(base[2]! + 4);
    await b.nextCard(room);
    expect(dani.changes()).toBe(base[2]! + 4);
    expect(rian.changes()).toBe(base[0]! + 5);
    await b.endRoom(room);
    expect([rian.changes(), ana.changes()]).toEqual([base[0]! + 6, base[1]! + 6]);
    // People in other rooms and people who never joined hear nothing of it.
    expect(caio.log).toEqual([{ kind: 'online' }]);
    expect(hugo.log).toEqual([{ kind: 'online' }]);
  });

  test('leaving, handing the host over and a silent person being settled are events too; the unsubscribe stops them', async () => {
    const { b, ids, as, advance, joinAll, listen } = await rooms();
    const room = await b.createRoom(draft);
    await joinAll(room, ['Ana', 'Dani']);
    const rian = await listen('Rian', room);
    const ana = await listen('Ana', room);
    const counts = () => [rian.changes(), ana.changes()];
    await as('Dani', (x) => x.leaveRoom(room));
    expect(counts()).toEqual([1, 1]);
    await b.passHost(room, ids['Ana']!);
    expect(counts()).toEqual([2, 2]);
    // Rian goes silent. The first heartbeat of Ana changes nothing; once he has been quiet for 90 seconds, her
    // next one closes his seat, and he hears about it too.
    advance(60 * SECOND);
    await as('Ana', (x) => x.roomHeartbeat(room));
    expect(counts()).toEqual([2, 2]);
    advance(31 * SECOND);
    await as('Ana', (x) => x.roomHeartbeat(room));
    expect(counts()).toEqual([3, 3]);
    await as('Ana', (x) => x.roomHeartbeat(room));
    expect(counts()).toEqual([3, 3]);
    // The unsubscribe works.
    const stop = await (async () => {
      let off: () => void = () => undefined;
      await as('Ana', async (x) => {
        off = x.subscribeRoom(room, () => undefined);
      });
      return off;
    })();
    stop();
    const log: RoomLiveEvent[] = [];
    let off: () => void = () => undefined;
    await as('Ana', async (x) => {
      off = x.subscribeRoom(room, (e) => log.push(e));
    });
    off();
    await as('Ana', (x) => x.nextCard(room));
    expect(log).toEqual([{ kind: 'online' }]);
  });

  test('nothing is delivered after sign-out, or to someone who subscribed while signed out', async () => {
    const { b, ids, as } = await rooms();
    const room = (await b.liveRooms())[0]!.id;
    await b.joinRoom(room);
    const log: RoomLiveEvent[] = [];
    const off = b.subscribeRoom(room, (e) => log.push(e));
    await as('Bia', (x) => x.nextCard(room));
    expect(log).toEqual([{ kind: 'online' }, { kind: 'changed' }]);
    await b.signOut();
    await as('Bia', (x) => x.nextCard(room));
    await as('Bia', (x) => x.sendRoomSignal(room, ids['Rian']!, 'offer', '{}')).catch(() => undefined);
    expect(log).toHaveLength(2);
    const late: RoomLiveEvent[] = [];
    const stop = b.subscribeRoom(room, (e) => late.push(e));
    await as('Bia', (x) => x.nextCard(room));
    stop();
    off();
    expect(late).toEqual([]);
    expect(log).toHaveLength(2);
  });

  test('actAsForTest lets Bia mute and remove Rian, then Rian is Rian again, and the events still flow', async () => {
    const { b, ids } = await rooms();
    const room = (await b.liveRooms())[0]!.id;
    await b.joinRoom(room);
    const log: RoomLiveEvent[] = [];
    b.subscribeRoom(room, (e) => log.push(e));
    expect(await b.actAsForTest(ids['Bia']!, async (x) => x.muteMember(room, ids['Rian']!))).toBeUndefined();
    expect((await b.session())!.userId).toBe(ids['Rian']);
    expect((await b.roomState(room))!.me.muteRequestedAt).not.toBeNull();
    expect(log).toEqual([{ kind: 'online' }, { kind: 'changed' }]);
    await b.actAsForTest(ids['Bia']!, (x) => x.removeFromRoom(room, ids['Rian']!));
    expect(await b.roomState(room)).toMatchObject({ me: { live: false, removed: true }, people: [] });
    expect(log.at(-1)).toEqual({ kind: 'changed' });
    expect(await b.actAsForTest(ids['Caio']!, async (x) => (await x.roomState(room))!.me.role)).toBe('member');
    // A failing act still puts the session back, and passes the error on.
    expect(await errorOf(b.actAsForTest(ids['Caio']!, (x) => x.endRoom(room)))).toMatchObject({ kind: 'forbidden' });
    expect((await b.session())!.userId).toBe(ids['Rian']);
    await expect(b.actAsForTest('00000000-0000-4000-8000-999999999999', async () => undefined)).rejects.toThrow();
    expect((await b.session())!.userId).toBe(ids['Rian']);
  });

  test('actAsForTest does not leave the other person signed in when the state is saved to a file', async () => {
    const file = join(dir, 'fake-rooms.json');
    const first = createFakeSocialBackend({ seed: 'people', filePath: file });
    const people = Object.fromEntries((await first.peopleForTest()).map((p) => [p.displayName, p.id])) as Record<string, string>;
    const room = (await first.liveRooms())[0]!.id;
    await first.actAsForTest(people['Bia']!, (x) => x.nextCard(room));
    const again = createFakeSocialBackend({ filePath: file });
    expect((await again.session())!.userId).toBe(people['Rian']);
    expect((await again.liveRooms())[0]!).toMatchObject({ title: 'Stand-up practice' });
  });

  test('Room host: 5 rooms opened where someone else came; Active speaker: 10 sessions of 5 minutes shared with someone', async () => {
    const { b, ids, as, advance } = await rooms();
    const badgeIds = async () => (await b.badges(ids['Rian']!)).map((x) => x.id);
    // Rooms nobody else entered do not count.
    for (let i = 0; i < 3; i++) await b.createRoom({ ...draft, title: `Alone ${i + 1}` });
    for (let i = 0; i < 4; i++) {
      const room = await b.createRoom({ ...draft, title: `With Ana ${i + 1}` });
      await as('Ana', (x) => x.joinRoom(room));
    }
    expect(await badgeIds()).not.toContain('room_host');
    const room = await b.createRoom({ ...draft, title: 'With Ana 5' });
    await as('Ana', (x) => x.joinRoom(room));
    expect(await badgeIds()).toContain('room_host');
    expect((await b.badges(ids['Rian']!)).find((x) => x.id === 'room_host')).toEqual({ id: 'room_host', group: 'community', label: 'Room host', detail: null });
    // Sessions long enough to count: each one is 5.5 minutes with Ana, everyone saying they are here every 30 seconds.
    advance(24 * 60 * MINUTE);
    await b.leaveRoom(room);
    const sit = async (title: string) => {
      const next = await b.createRoom({ ...draft, title });
      await as('Ana', (x) => x.joinRoom(next));
      for (let i = 0; i < 11; i++) {
        advance(30 * SECOND);
        await b.roomHeartbeat(next);
        await as('Ana', (x) => x.roomHeartbeat(next));
      }
    };
    for (let i = 1; i <= 9; i++) await sit(`Long ${i}`);
    await b.leaveRoom((await b.liveRooms()).find((r) => r.title === 'Long 9')!.id);
    expect(await badgeIds()).not.toContain('active_speaker');
    await sit('Long 10');
    await b.leaveRoom((await b.liveRooms()).find((r) => r.title === 'Long 10')!.id);
    expect(await badgeIds()).toContain('active_speaker');
    expect((await b.badges(ids['Rian']!)).find((x) => x.id === 'active_speaker')).toMatchObject({ group: 'community', label: 'Active speaker' });
  });

  test('a session shorter than 5 minutes, or alone, does not count towards Active speaker', async () => {
    const { b, ids, as, advance } = await rooms();
    for (let i = 0; i < 10; i++) {
      const room = await b.createRoom({ ...draft, title: `Short ${i}` });
      await as('Ana', (x) => x.joinRoom(room));
      for (let k = 0; k < 8; k++) {
        advance(30 * SECOND);
        await b.roomHeartbeat(room);
        await as('Ana', (x) => x.roomHeartbeat(room));
      }
    }
    expect((await b.badges(ids['Rian']!)).map((x) => x.id)).not.toContain('active_speaker');
  });

  test('the export lists the rooms you opened and your own sessions, not other people\'s', async () => {
    const { b, ids, as, advance } = await rooms();
    const room = await b.createRoom(draft);
    await as('Ana', (x) => x.joinRoom(room));
    advance(MINUTE);
    await as('Ana', (x) => x.roomHeartbeat(room));
    await b.roomHeartbeat(room);
    await as('Ana', (x) => x.leaveRoom(room));
    await b.leaveRoom(room);
    const seeded = (await b.liveRooms())[0]!.id;
    await b.joinRoom(seeded);
    const minute = new Date(T0 + MINUTE).toISOString();
    expect((await b.exportOwnData())['rooms']).toEqual({
      roomsCreated: [{ id: room, title: 'Code review night', theme: 'code_review', createdAt: new Date(T0).toISOString(), endedAt: minute }],
      sessions: [
        { roomId: room, joinedAt: new Date(T0).toISOString(), leftAt: minute, role: 'member', removed: false },
        { roomId: seeded, joinedAt: minute, leftAt: null, role: 'member', removed: false },
      ],
    });
    const ana = (await as('Ana', (x) => x.exportOwnData()))['rooms'] as { roomsCreated: unknown[]; sessions: unknown[] };
    expect(ana.roomsCreated).toEqual([]);
    expect(ana.sessions).toEqual([expect.objectContaining({ roomId: room })]);
    expect(ids['Ana']).toBeDefined();
  });

  test('a room report shows the room to moderators: title, theme, host, and who was there when', async () => {
    const { b, ids, as, advance } = await rooms();
    const room = await b.createRoom(draft);
    await as('Ana', (x) => x.joinRoom(room));
    advance(MINUTE);
    await b.roomHeartbeat(room);
    await as('Ana', (x) => x.leaveRoom(room));
    await b.report({ reported: ids['Ana']!, contextType: 'room', contextId: room, reason: 'harassment', details: '' });
    await b.report({ reported: ids['Hugo']!, contextType: 'room', contextId: room, reason: 'spam', details: '' });
    await b.report({ reported: ids['Ana']!, contextType: 'message', contextId: '5', reason: 'spam', details: '' });
    b.addModeratorForTest(ids['Dani']!);
    const reports = await as('Dani', (x) => x.listOpenReports());
    const ofAna = reports.find((r) => r.contextType === 'room' && r.reported?.id === ids['Ana'])!;
    const ofHugo = reports.find((r) => r.reported?.id === ids['Hugo'])!;
    const message = reports.find((r) => r.contextType === 'message')!;
    expect(await as('Dani', (x) => x.roomReportContext(ofAna.id))).toEqual({
      title: 'Code review night', theme: 'code_review', hostName: 'Rian', createdAt: new Date(T0).toISOString(),
      people: [
        { name: 'Rian', joinedAt: new Date(T0).toISOString(), leftAt: null },
        { name: 'Ana', joinedAt: new Date(T0).toISOString(), leftAt: new Date(T0 + MINUTE).toISOString() },
      ],
    });
    // A seat nobody has heard from for 90 seconds counts as left at its last sign of life.
    advance(100 * SECOND);
    expect((await as('Dani', (x) => x.roomReportContext(ofAna.id)))!.people[0]).toMatchObject({ name: 'Rian', leftAt: new Date(T0 + MINUTE).toISOString() });
    // Not for members, not for a person who was never in the room, not for other kinds of report, not for unknown reports.
    expect(await b.roomReportContext(ofAna.id)).toBeNull();
    expect(await as('Dani', (x) => x.roomReportContext(ofHugo.id))).toBeNull();
    expect(await as('Dani', (x) => x.roomReportContext(message.id))).toBeNull();
    expect(await as('Dani', (x) => x.roomReportContext(999_999))).toBeNull();
  });

  test('deleting your account removes the rooms you opened; a room you only hosted goes on without you', async () => {
    const mine = await rooms();
    const opened = await mine.b.createRoom(draft);
    await mine.as('Ana', (x) => x.joinRoom(opened));
    await mine.b.passHost(opened, mine.ids['Ana']!);
    await mine.b.deleteAccount();
    expect(await mine.stateOf('Ana', opened)).toBeNull();
    expect(titles(await mine.as('Ana', (x) => x.liveRooms()))).toEqual(['Stand-up practice']);

    const hosted = await rooms();
    const hers = await hosted.as('Ana', (x) => x.createRoom({ ...draft, title: 'Ana\'s room' }));
    await hosted.b.joinRoom(hers);
    await hosted.as('Ana', (x) => x.passHost(hers, hosted.ids['Rian']!));
    expect((await hosted.stateOf('Ana', hers))!.hostId).toBe(hosted.ids['Rian']);
    await hosted.b.deleteAccount();
    expect(await hosted.stateOf('Ana', hers)).toMatchObject({
      hostId: hosted.ids['Ana'], endedAt: null, people: [expect.objectContaining({ displayName: 'Ana', role: 'host' })],
    });
    // If nobody else was there, the room ends.
    const alone = await rooms();
    const aloneRoom = await alone.as('Ana', (x) => x.createRoom({ ...draft, title: 'Ana alone' }));
    await alone.as('Ana', (x) => x.leaveRoom(aloneRoom));
    expect(await alone.stateOf('Ana', aloneRoom)).toMatchObject({ endedAt: expect.any(String) });
  });

  test('the unconfigured backend refuses every room call and subscribes to nothing', async () => {
    const b = createUnconfiguredBackend();
    expect(await kindOf(b.liveRooms())).toBe('not_configured');
    expect(await kindOf(b.createRoom(draft))).toBe('not_configured');
    expect(await kindOf(b.joinRoom('r'))).toBe('not_configured');
    expect(await kindOf(b.roomHeartbeat('r'))).toBe('not_configured');
    expect(await kindOf(b.sendRoomSignal('r', 'u', 'offer', '{}'))).toBe('not_configured');
    expect(await kindOf(b.setRoomTimer('r', null))).toBe('not_configured');
    expect(await kindOf(b.setRoomMuted('r', true))).toBe('not_configured');
    expect(await kindOf(b.roomReportContext(1))).toBe('not_configured');
    const stop = b.subscribeRoom('r', () => {
      throw new Error('no events');
    });
    stop();
  });

  test('injected failures reach the room calls', async () => {
    const b = createFakeSocialBackend({ seed: 'people', fail: { liveRooms: 'offline', joinRoom: 'asleep' } });
    expect(await kindOf(b.liveRooms())).toBe('offline');
    expect(await kindOf(b.joinRoom('r'))).toBe('asleep');
  });
});

describe('fake backend: GitHub sign-in', () => {
  const browser = () => {
    const opened: string[] = [];
    return { opened, openExternal: async (url: string) => void opened.push(url) };
  };

  /** Checks the PNG really is one a browser can decode: signature, chunk CRCs, IHDR size, pixel data length. */
  function readPng(bytes: Uint8Array): { width: number; height: number } {
    const buf = Buffer.from(bytes);
    expect([...buf.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    let at = 8;
    let width = 0;
    let height = 0;
    const idat: Buffer[] = [];
    const types: string[] = [];
    while (at < buf.length) {
      const len = buf.readUInt32BE(at);
      const type = buf.subarray(at + 4, at + 8).toString('latin1');
      const data = buf.subarray(at + 8, at + 8 + len);
      expect(buf.readUInt32BE(at + 8 + len)).toBe(crc32(buf.subarray(at + 4, at + 8 + len)));
      types.push(type);
      if (type === 'IHDR') {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        expect([data[8], data[9]]).toEqual([8, 2]); // 8-bit RGB
      }
      if (type === 'IDAT') idat.push(data);
      at += 12 + len;
    }
    expect(types[0]).toBe('IHDR');
    expect(types.at(-1)).toBe('IEND');
    expect(inflateSync(Buffer.concat(idat)).length).toBe(height * (1 + width * 3));
    return { width, height };
  }

  test('signs in at once as the GitHub test member, after "opening" the browser once', async () => {
    const b = createFakeSocialBackend();
    const { opened, openExternal } = browser();
    const s = await b.signInWithGitHub({ openExternal });
    expect(s.email).toBe('octo@example.com');
    expect(await b.session()).toEqual(s);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatch(/^https:\/\//);
    // A new member: the documents and the profile come next, as for e-mail.
    expect(await b.hasAcceptedCurrentDocuments()).toBe(false);
    expect(await b.getOwnProfile()).toBeNull();
  });

  test('signing in with GitHub again returns the same account', async () => {
    const b = createFakeSocialBackend();
    const first = await b.signInWithGitHub(browser());
    await b.signOut();
    expect((await b.signInWithGitHub(browser())).userId).toBe(first.userId);
  });

  test('the same e-mail joins the account made with an e-mail code', async () => {
    const b = createFakeSocialBackend();
    await b.sendCode('octo@example.com');
    const byCode = await b.verifyCode('octo@example.com', '123456');
    expect((await b.githubSuggestion()).displayName).toBeNull();
    await b.signOut();
    expect((await b.signInWithGitHub(browser())).userId).toBe(byCode.userId);
    expect((await b.githubSuggestion()).displayName).toBe('Octo Dev');
  });

  test('the suggestion is the GitHub name and a small PNG photo', async () => {
    const b = createFakeSocialBackend();
    await b.signInWithGitHub(browser());
    const g = await b.githubSuggestion();
    expect(g.displayName).toBe('Octo Dev');
    expect(g.avatarType).toBe('image/png');
    expect(g.avatar).toBeInstanceOf(Uint8Array);
    expect(g.avatar!.byteLength).toBeLessThan(2 * 1024 * 1024);
    expect(readPng(g.avatar!)).toEqual({ width: 64, height: 64 });
    // Nothing is saved until the member saves the profile.
    expect(await b.getOwnProfile()).toBeNull();
  });

  test('no suggestion for a member who signed in with an e-mail code; signed out is not_signed_in', async () => {
    const b = createFakeSocialBackend();
    expect(await kindOf(b.githubSuggestion())).toBe('not_signed_in');
    await b.sendCode('rian@example.com');
    await b.verifyCode('rian@example.com', '123456');
    expect(await b.githubSuggestion()).toEqual({ displayName: null, avatar: null, avatarType: null });
  });

  test('the export says how you sign in; GitHub details only for the GitHub test member', async () => {
    const mail = createFakeSocialBackend();
    await mail.sendCode('rian@example.com');
    await mail.verifyCode('rian@example.com', '123456');
    expect((await mail.exportOwnData())['account']).toEqual({ email: 'rian@example.com', signInMethods: ['email'], github: null });

    const b = createFakeSocialBackend();
    await b.signInWithGitHub(browser());
    expect((await b.exportOwnData())['account']).toEqual({
      email: 'octo@example.com',
      signInMethods: ['email', 'github'],
      github: {
        id: FAKE_GITHUB_ID,
        name: FAKE_GITHUB_NAME,
        username: FAKE_GITHUB_USERNAME,
        picture: FAKE_GITHUB_PICTURE,
      },
    });
  });

  test('an injected failure stops the sign-in before the browser opens', async () => {
    const b = createFakeSocialBackend({ fail: { signInWithGitHub: 'offline', githubSuggestion: 'asleep' } });
    const { opened, openExternal } = browser();
    expect(await kindOf(b.signInWithGitHub({ openExternal }))).toBe('offline');
    expect(opened).toEqual([]);
    expect(await b.session()).toBeNull();
    expect(await kindOf(b.githubSuggestion())).toBe('asleep');
  });

  test('Cancel (an aborted signal) does not sign in', async () => {
    const b = createFakeSocialBackend();
    const ac = new AbortController();
    ac.abort();
    const err = await b.signInWithGitHub({ ...browser(), signal: ac.signal }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SocialError);
    expect((err as SocialError).kind).toBe('unknown');
    expect((err as SocialError).message).toBe(NOT_FINISHED_MESSAGE);
    expect(await b.session()).toBeNull();
  });

  test('a browser that cannot open stops the sign-in', async () => {
    const b = createFakeSocialBackend();
    const err = await b.signInWithGitHub({ openExternal: async () => { throw new Error('no browser'); } }).catch((e: unknown) => e);
    expect((err as SocialError).kind).toBe('unknown');
    expect((err as SocialError).message).toBe('Could not start GitHub sign-in.');
    expect(await b.session()).toBeNull();
  });

  test('the GitHub account survives a relaunch', async () => {
    const filePath = join(dir, 'fake-social.json');
    const a = createFakeSocialBackend({ filePath });
    const s = await a.signInWithGitHub(browser());
    const b = createFakeSocialBackend({ filePath });
    expect(await b.session()).toEqual(s);
    expect((await b.githubSuggestion()).displayName).toBe('Octo Dev');
  });

  test('the unconfigured backend refuses GitHub sign-in and the suggestion', async () => {
    const b = createUnconfiguredBackend();
    const { opened, openExternal } = browser();
    expect(await kindOf(b.signInWithGitHub({ openExternal }))).toBe('not_configured');
    expect(opened).toEqual([]);
    expect(await kindOf(b.githubSuggestion())).toBe('not_configured');
  });
});
