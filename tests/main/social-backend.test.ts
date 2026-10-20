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
    expect(Object.keys(data).sort()).toEqual([
      'account', 'avatarUrl', 'badges', 'bannerUrl', 'blocks', 'consents', 'exportedAt', 'moderationActions', 'notices', 'profile', 'progress', 'reportsMade', 'social', 'usesLinux',
    ]);
    expect(data['progress']).toEqual({ practiceDays: [], milestones: [] });
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

  test('deleting your account removes your conversations and messages', async () => {
    const { b, as, withBia } = await chat();
    const c = (await withBia()).id;
    await b.deleteAccount();
    await as('Bia');
    expect(await b.conversations()).toEqual([]);
    expect(await b.messages(c, null)).toEqual([]);
  });
});
