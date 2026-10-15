import { SocialError } from '../../src/main/social/errors';
import { mapSupabaseError } from '../../src/main/social/errors';
import { createSupabaseBackend } from '../../src/main/social/supabase-backend';

const URL_BASE = 'https://proj.supabase.co';

interface Recorded {
  method: string;
  path: string;
  query: string;
  type: string | null;
  body: unknown;
  auth: string | null;
}

type Reply = Response | (() => Response) | Error;

/** A fetch that records every request and answers from a route table (first match on "METHOD /path"). */
function fakeFetch(routes: Record<string, Reply>) {
  const calls: Recorded[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const u = new URL(req.url);
    const text = req.body ? await req.text() : '';
    calls.push({
      method: req.method,
      path: u.pathname,
      query: decodeURIComponent(u.search),
      type: req.headers.get('Content-Type'),
      body: text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null,
      auth: req.headers.get('Authorization'),
    });
    const key = Object.keys(routes).find((k) => k === `${req.method} ${u.pathname}`);
    const reply = key ? routes[key]! : new Response('{}', { status: 404 });
    if (reply instanceof Error) throw reply;
    return typeof reply === 'function' ? reply() : reply.clone();
  };
  return { calls, fetch: fetchImpl as typeof fetch };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    map: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

function token(sub: string) {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp, role: 'authenticated', aud: 'authenticated' })}.sig`;
}

function sessionBody(sub = 'user-1', email = 'rian@example.com') {
  return {
    access_token: token(sub),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'refresh-1',
    user: { id: sub, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  };
}

function backend(routes: Record<string, Reply>, storage = memoryStorage()) {
  const f = fakeFetch(routes);
  const b = createSupabaseBackend({ url: URL_BASE, key: 'sb_publishable_test', storage, fetch: f.fetch, autoRefreshToken: false });
  return { b, calls: f.calls, storage };
}

async function errorOf(p: Promise<unknown>): Promise<SocialError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof SocialError) return err;
    throw err;
  }
  throw new Error('expected a SocialError');
}

test('sendCode asks GoTrue for an e-mail code and allows new accounts', async () => {
  const { b, calls } = backend({ 'POST /auth/v1/otp': json(200, {}) });
  await b.sendCode('rian@example.com');
  expect(calls[0]).toMatchObject({ method: 'POST', path: '/auth/v1/otp', body: { email: 'rian@example.com', create_user: true } });
});

test('verifyCode verifies an e-mail code and keeps the session', async () => {
  const { b, calls } = backend({ 'POST /auth/v1/verify': json(200, sessionBody()) });
  const s = await b.verifyCode('rian@example.com', '123456');
  expect(s).toEqual({ userId: 'user-1', email: 'rian@example.com' });
  expect(calls[0]).toMatchObject({ path: '/auth/v1/verify', body: { email: 'rian@example.com', token: '123456', type: 'email' } });
  expect(await b.session()).toEqual({ userId: 'user-1', email: 'rian@example.com' });
});

test('a wrong or expired code maps to invalid_code', async () => {
  const { b } = backend({
    'POST /auth/v1/verify': json(403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }),
  });
  expect((await errorOf(b.verifyCode('rian@example.com', '000000'))).kind).toBe('invalid_code');
});

test('the e-mail rate limit maps to rate_limited', async () => {
  const { b } = backend({
    'POST /auth/v1/otp': json(429, { code: 429, error_code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded' }),
  });
  expect((await errorOf(b.sendCode('rian@example.com'))).kind).toBe('rate_limited');
});

test('a network failure maps to offline', async () => {
  const { b } = backend({ 'POST /auth/v1/otp': new TypeError('fetch failed') });
  expect((await errorOf(b.sendCode('rian@example.com'))).kind).toBe('offline');
});

test('a paused project (5xx) maps to asleep', async () => {
  const { b } = backend({ 'POST /auth/v1/otp': json(503, { message: 'Service Unavailable' }) });
  expect((await errorOf(b.sendCode('rian@example.com'))).kind).toBe('asleep');
});

test('deleteAccount calls the function with the session token, then signs out locally', async () => {
  const { b, calls } = backend({
    'POST /auth/v1/verify': json(200, sessionBody('user-9')),
    'POST /functions/v1/delete-account': json(200, { deleted: true }),
  });
  await b.verifyCode('rian@example.com', '123456');
  await b.deleteAccount();
  const call = calls.find((c) => c.path === '/functions/v1/delete-account')!;
  expect(call.method).toBe('POST');
  expect(call.auth).toBe(`Bearer ${token('user-9')}`);
  expect(await b.session()).toBeNull();
});

test('deleteAccount explains a missing function and keeps the session', async () => {
  const { b } = backend({
    'POST /auth/v1/verify': json(200, sessionBody()),
    'POST /functions/v1/delete-account': json(404, { error: 'Function not found' }),
  });
  await b.verifyCode('rian@example.com', '123456');
  const err = await errorOf(b.deleteAccount());
  expect(err.kind).toBe('unknown');
  expect(err.message).toBe('The delete-account function is not deployed.');
  expect(await b.session()).not.toBeNull();
});

test('deleteAccount while offline keeps the session', async () => {
  const { b } = backend({
    'POST /auth/v1/verify': json(200, sessionBody()),
    'POST /functions/v1/delete-account': new TypeError('fetch failed'),
  });
  await b.verifyCode('rian@example.com', '123456');
  expect((await errorOf(b.deleteAccount())).kind).toBe('offline');
  expect(await b.session()).not.toBeNull();
});

test('saveProfile upserts the row in snake_case and maps it back', async () => {
  const row = {
    id: 'user-1', display_name: 'Rian', native_language: 'Portuguese (Brazil)', level: 'B1', timezone: 'America/Bahia',
    area: 'backend', stack: ['python'], availability: [], bio: '', avatar_path: null,
  };
  const { b, calls } = backend({
    'POST /auth/v1/verify': json(200, sessionBody()),
    'POST /rest/v1/rpc/my_suspension': json(200, null),
    'POST /rest/v1/profiles': json(201, row),
  });
  await b.verifyCode('rian@example.com', '123456');
  const p = await b.saveProfile({
    displayName: 'Rian', nativeLanguage: 'Portuguese (Brazil)', level: 'B1', timezone: 'America/Bahia', area: 'backend',
    stack: ['python'], availability: [], bio: '', mainStack: [], showProgress: true, mascot: null, listed: true,
  });
  expect(p).toEqual({
    id: 'user-1', displayName: 'Rian', nativeLanguage: 'Portuguese (Brazil)', level: 'B1', timezone: 'America/Bahia',
    area: 'backend', stack: ['python'], availability: [], bio: '', hasAvatar: false, suspendedUntil: null,
    mainStack: [], showProgress: true, mascot: null, hasBanner: false, listed: true,
  });
  const post = calls.find((c) => c.method === 'POST' && c.path === '/rest/v1/profiles')!;
  expect(post.body).toMatchObject({ id: 'user-1', display_name: 'Rian', native_language: 'Portuguese (Brazil)' });
  expect(post.body).not.toHaveProperty('suspended_until');
  // suspended_until is not a readable column: every profile read names its columns.
  expect(post.query).toMatch(/select=id,display_name/);
  expect(post.query).not.toMatch(/select=\*|suspended_until/);
});

test('the own suspension comes from my_suspension(), not from the profile row', async () => {
  const row = {
    id: 'user-1', display_name: 'Rian', native_language: 'Portuguese (Brazil)', level: 'B1', timezone: 'America/Bahia',
    area: 'backend', stack: [], availability: [], bio: '', avatar_path: null,
  };
  const { b, calls } = backend({
    'POST /auth/v1/verify': json(200, sessionBody()),
    'GET /rest/v1/profiles': json(200, row),
    'POST /rest/v1/rpc/my_suspension': json(200, '2099-01-31T12:00:00+00:00'),
  });
  await b.verifyCode('rian@example.com', '123456');
  expect((await b.getOwnProfile())?.suspendedUntil).toBe('2099-01-31T12:00:00+00:00');
  const read = calls.find((c) => c.method === 'GET' && c.path === '/rest/v1/profiles')!;
  expect(read.query).not.toMatch(/select=\*|suspended_until/);
});

test('the export includes the moderation actions about the person', async () => {
  const { b } = backend({
    'POST /auth/v1/verify': json(200, sessionBody()),
    'GET /rest/v1/profiles': json(200, null),
    'POST /rest/v1/rpc/my_suspension': json(200, null),
    'GET /rest/v1/consents': json(200, []),
    'GET /rest/v1/blocks': json(200, []),
    'GET /rest/v1/reports': json(200, []),
    'GET /rest/v1/notices': json(200, []),
    'POST /rest/v1/rpc/my_moderation_actions': json(200, [{ action: 'warn', reason: 'Be kind', until: null, created_at: '2026-10-14T10:00:00Z' }]),
    'POST /rest/v1/rpc/my_progress_export': json(200, { practiceDays: [], milestones: [] }),
    'POST /rest/v1/rpc/my_social_export': json(200, { following: [], followers: [], likesGiven: [] }),
    'POST /rest/v1/rpc/profile_badges': json(200, []),
  });
  await b.verifyCode('rian@example.com', '123456');
  const data = await b.exportOwnData();
  expect(data['moderationActions']).toEqual([{ action: 'warn', reason: 'Be kind', until: null, created_at: '2026-10-14T10:00:00Z' }]);
});

test('the export includes practice days and milestones with their times, badges, uses_linux and the banner', async () => {
  const progress = { practiceDays: [{ day: '2026-10-14', answers: 2, reviews: 5, updatedAt: '2026-10-14T21:00:00Z' }], milestones: [] };
  const { b, calls } = backend({
    'POST /auth/v1/verify': json(200, sessionBody()),
    'GET /rest/v1/profiles': json(200, {
      id: 'user-1', display_name: 'Rian', native_language: 'Portuguese (Brazil)', level: 'B1', timezone: 'America/Bahia',
      area: 'backend', stack: [], availability: [], bio: '', avatar_path: null, uses_linux: true, banner_path: 'user-1/banner.gif',
    }),
    'POST /rest/v1/rpc/my_suspension': json(200, null),
    'GET /rest/v1/consents': json(200, []),
    'GET /rest/v1/blocks': json(200, []),
    'GET /rest/v1/reports': json(200, []),
    'GET /rest/v1/notices': json(200, []),
    'POST /rest/v1/rpc/my_moderation_actions': json(200, []),
    'POST /rest/v1/rpc/my_progress_export': json(200, progress),
    'POST /rest/v1/rpc/my_social_export': json(200, { following: [{ id: 'u2', at: '2026-10-15T10:00:00Z' }], followers: [], likesGiven: [] }),
    'POST /rest/v1/rpc/profile_badges': json(200, [{ id: 'mentor', grp: 'community', label: 'Mentor', detail: null }]),
    'POST /storage/v1/object/sign/banners/user-1/banner.gif': json(200, { signedURL: '/object/sign/banners/user-1/banner.gif?token=t' }),
  });
  await b.verifyCode('rian@example.com', '123456');
  const data = await b.exportOwnData();
  expect(data).toMatchObject({ progress, usesLinux: true, badges: [{ id: 'mentor', group: 'community', label: 'Mentor', detail: null }] });
  expect(data['social']).toEqual({ following: [{ id: 'u2', at: '2026-10-15T10:00:00Z' }], followers: [], likesGiven: [] });
  expect(String(data['bannerUrl'])).toContain('banners/user-1/banner.gif');
  expect(calls.find((c) => c.path === '/rest/v1/rpc/profile_badges')!.body).toEqual({ target: 'user-1' });
});

test('sign out clears the stored session even when the expired token cannot be refreshed offline', async () => {
  const storage = memoryStorage();
  const expired = { ...sessionBody(), expires_at: Math.floor(Date.now() / 1000) - 600, expires_in: -600 };
  storage.setItem('sb-proj-auth-token', JSON.stringify(expired));
  const { b } = backend({ 'POST /auth/v1/token': new TypeError('fetch failed'), 'POST /auth/v1/logout': new TypeError('fetch failed') }, storage);
  await b.signOut();
  expect(storage.map.size).toBe(0);
  expect(await b.session()).toBeNull();
});

describe('mapSupabaseError', () => {
  test('row-level security denial is forbidden', () => {
    expect(mapSupabaseError({ code: '42501', message: 'new row violates row-level security policy' }, 403).kind).toBe('forbidden');
  });
  test('the report limit is rate_limited', () => {
    expect(mapSupabaseError({ code: 'P0001', message: 'report limit reached' }, 400).kind).toBe('rate_limited');
  });
  test('a postgrest fetch failure (status 0) is offline', () => {
    expect(mapSupabaseError({ code: '', message: 'TypeError: fetch failed' }, 0).kind).toBe('offline');
  });
});

describe('profile extras', () => {
  const signedIn = (routes: Record<string, Reply>) => backend({ 'POST /auth/v1/verify': json(200, sessionBody()), ...routes });

  test('badges come from profile_badges, with grp mapped to group', async () => {
    const { b, calls } = signedIn({
      'POST /rest/v1/rpc/profile_badges': json(200, [{ id: 'moderator', grp: 'community', label: 'Moderator', detail: null }]),
    });
    await b.verifyCode('rian@example.com', '123456');
    expect(await b.badges('user-2')).toEqual([{ id: 'moderator', group: 'community', label: 'Moderator', detail: null }]);
    expect(calls.find((c) => c.path === '/rest/v1/rpc/profile_badges')!.body).toEqual({ target: 'user-2' });
  });

  test('the practice graph reads the days and the streaks', async () => {
    const { b, calls } = signedIn({
      'GET /rest/v1/practice_days': json(200, [{ day: '2026-10-14', answers: 2, reviews: 3 }]),
      'POST /rest/v1/rpc/practice_streaks': json(200, [{ current: 4, longest: 9 }]),
    });
    await b.verifyCode('rian@example.com', '123456');
    expect(await b.practiceGraph('user-2')).toEqual({ days: [{ day: '2026-10-14', answers: 2, reviews: 3 }], current: 4, longest: 9 });
    const read = calls.find((c) => c.path === '/rest/v1/practice_days')!;
    expect(read.query).toMatch(/select=day,answers,reviews/);
    expect(read.query).toMatch(/user_id=eq.user-2/);
  });

  test('practice days are upserted by day', async () => {
    const { b, calls } = signedIn({ 'POST /rest/v1/practice_days': json(201, null) });
    await b.verifyCode('rian@example.com', '123456');
    await b.publishPracticeDays([{ day: '2026-10-14', answers: 1, reviews: 2 }]);
    const post = calls.find((c) => c.path === '/rest/v1/practice_days')!;
    expect(post.query).toMatch(/on_conflict=user_id,day/);
    expect(post.body).toEqual([{ user_id: 'user-1', day: '2026-10-14', answers: 1, reviews: 2 }]);
  });

  test('a GIF banner replaces the WebP one and is recorded on the profile', async () => {
    const { b, calls } = signedIn({
      'POST /storage/v1/object/banners/user-1/banner.gif': json(200, { Key: 'banners/user-1/banner.gif' }),
      'DELETE /storage/v1/object/banners': json(200, []),
      'PATCH /rest/v1/profiles': () => new Response(null, { status: 204 }),
    });
    await b.verifyCode('rian@example.com', '123456');
    await b.uploadBanner(new Uint8Array([0x47, 0x49, 0x46]), 'gif');
    const up = calls.find((c) => c.path === '/storage/v1/object/banners/user-1/banner.gif')!;
    expect(up.type).toBe('image/gif');
    expect(calls.find((c) => c.method === 'DELETE')!.body).toEqual({ prefixes: ['user-1/banner.webp'] });
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ banner_path: 'user-1/banner.gif' });
  });

  test('granting a badge is a moderation action', async () => {
    const { b, calls } = signedIn({
      'POST /rest/v1/rpc/is_moderator': json(200, true),
      'POST /rest/v1/moderation_actions': json(201, null),
    });
    await b.verifyCode('rian@example.com', '123456');
    await b.grantBadge('user-2', 'mentor', 'Helps a lot');
    expect(calls.find((c) => c.path === '/rest/v1/moderation_actions')!.body).toEqual({
      target: 'user-2', action: 'grant_badge', badge: 'mentor', reason: 'Helps a lot',
    });
  });

  test('uses_linux is written only when it changes, so the profile is not touched on every start', async () => {
    const { b, calls } = signedIn({ 'PATCH /rest/v1/profiles': () => new Response(null, { status: 204 }) });
    await b.verifyCode('rian@example.com', '123456');
    await b.setUsesLinux(true);
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.body).toEqual({ uses_linux: true });
    expect(patch.query).toContain('uses_linux=neq.true');
  });

  test('the moderation history includes the badge of badge actions', async () => {
    const { b, calls } = signedIn({
      'GET /rest/v1/moderation_actions': json(200, [
        { action: 'grant_badge', reason: 'Helps a lot', until: null, badge: 'mentor', created_at: '2026-10-14T10:00:00Z' },
      ]),
    });
    await b.verifyCode('rian@example.com', '123456');
    expect(await b.actionsAbout('user-2')).toEqual([
      { action: 'grant_badge', reason: 'Helps a lot', until: null, badge: 'mentor', createdAt: '2026-10-14T10:00:00Z' },
    ]);
    expect(calls.find((c) => c.path === '/rest/v1/moderation_actions')!.query).toContain('badge');
  });
});

describe('people (Supabase)', () => {
  const signedIn = (routes: Record<string, Reply>) => backend({ 'POST /auth/v1/verify': json(200, sessionBody()), ...routes });
  const row = { id: 'u2', display_name: 'Bia', level: 'B1', area: 'frontend', main_stack: ['react'], mascot: null, has_avatar: true };
  const mapped = { id: 'u2', displayName: 'Bia', level: 'B1', area: 'frontend', mainStack: ['react'], mascot: null, hasAvatar: true };

  test('members asks member_directory, with nulls for empty filters', async () => {
    const { b, calls } = signedIn({ 'POST /rest/v1/rpc/member_directory': json(200, [row]) });
    await b.verifyCode('rian@example.com', '123456');
    expect(await b.members({ level: 'B1', query: '  ' }, 2)).toEqual([mapped]);
    expect(calls.find((c) => c.path === '/rest/v1/rpc/member_directory')!.body).toEqual({ q: null, lvl: 'B1', area_filter: null, stack_tag: null, page: 2 });
  });

  test('socialStats maps profile_social; no row means zeros', async () => {
    const { b } = signedIn({ 'POST /rest/v1/rpc/profile_social': json(200, [{ followers: 3, following: 1, likes: 12, i_follow: true, i_like: false }]) });
    await b.verifyCode('rian@example.com', '123456');
    expect(await b.socialStats('u2')).toEqual({ followers: 3, following: 1, likes: 12, iFollow: true, iLike: false });
    const empty = signedIn({ 'POST /rest/v1/rpc/profile_social': json(200, []) });
    await empty.b.verifyCode('rian@example.com', '123456');
    expect(await empty.b.socialStats('u2')).toEqual({ followers: 0, following: 0, likes: 0, iFollow: false, iLike: false });
  });

  test('follow and like add the caller\'s row, ignoring duplicates; unfollow and unlike remove it', async () => {
    const ok = () => new Response(null, { status: 201 });
    const gone = () => new Response(null, { status: 204 });
    const { b, calls } = signedIn({ 'POST /rest/v1/follows': ok, 'DELETE /rest/v1/follows': gone, 'POST /rest/v1/profile_likes': ok, 'DELETE /rest/v1/profile_likes': gone });
    await b.verifyCode('rian@example.com', '123456');
    await b.follow('u2');
    await b.unfollow('u2');
    await b.like('u2');
    await b.unlike('u2');
    const post = calls.find((c) => c.method === 'POST' && c.path === '/rest/v1/follows')!;
    expect(post.body).toEqual({ follower: 'user-1', followee: 'u2' });
    expect(post.query).toContain('on_conflict=follower,followee');
    expect(calls.find((c) => c.method === 'DELETE' && c.path === '/rest/v1/follows')!.query).toMatch(/follower=eq\.user-1.*followee=eq\.u2/);
    expect(calls.find((c) => c.method === 'POST' && c.path === '/rest/v1/profile_likes')!.body).toEqual({ liker: 'user-1', profile: 'u2' });
    expect(calls.find((c) => c.method === 'DELETE' && c.path === '/rest/v1/profile_likes')!.query).toMatch(/liker=eq\.user-1.*profile=eq\.u2/);
  });

  test('the daily limit comes back as rate_limited', async () => {
    const { b } = signedIn({ 'POST /rest/v1/follows': json(400, { code: 'P0001', message: 'follow limit reached' }) });
    await b.verifyCode('rian@example.com', '123456');
    expect(await errorOf(b.follow('u2'))).toMatchObject({ kind: 'rate_limited' });
  });

  test('followers and following call their readers', async () => {
    const { b, calls } = signedIn({ 'POST /rest/v1/rpc/followers_of': json(200, [row]), 'POST /rest/v1/rpc/following_of': json(200, []) });
    await b.verifyCode('rian@example.com', '123456');
    expect(await b.followers('u3', 1)).toEqual([mapped]);
    expect(await b.following('u3', 0)).toEqual([]);
    expect(calls.find((c) => c.path === '/rest/v1/rpc/followers_of')!.body).toEqual({ target: 'u3', page: 1 });
  });

  test('profileOf reads the row by id with listed; nothing visible means null', async () => {
    const profile = {
      id: 'u2', display_name: 'Bia', native_language: 'Portuguese (Brazil)', level: 'B1', timezone: 'America/Bahia', area: 'frontend',
      stack: ['react'], availability: [], bio: '', avatar_path: null, main_stack: ['react'], show_progress: true, mascot: null, banner_path: null, listed: false,
    };
    const { b, calls } = signedIn({ 'GET /rest/v1/profiles': json(200, profile) });
    await b.verifyCode('rian@example.com', '123456');
    expect(await b.profileOf('u2')).toMatchObject({ id: 'u2', displayName: 'Bia', listed: false, suspendedUntil: null });
    expect(calls.find((c) => c.path === '/rest/v1/profiles')!.query).toMatch(/listed/);
    const none = signedIn({ 'GET /rest/v1/profiles': json(200, null) });
    await none.b.verifyCode('rian@example.com', '123456');
    expect(await none.b.profileOf('u9')).toBeNull();
  });

  test('notices carry their kind and the actor\'s name', async () => {
    const { b } = signedIn({
      'GET /rest/v1/notices': json(200, [
        { id: 1, message: 'Bia followed you.', created_at: '2026-10-15T10:00:00Z', read_at: null, kind: 'follow', actor: 'u2' },
        { id: 2, message: 'Be kind.', created_at: '2026-10-14T10:00:00Z', read_at: null, kind: 'moderation', actor: null },
      ]),
      'GET /rest/v1/profiles': json(200, [{ id: 'u2', display_name: 'Bia' }]),
    });
    await b.verifyCode('rian@example.com', '123456');
    expect(await b.listNotices()).toEqual([
      { id: 1, message: 'Bia followed you.', createdAt: '2026-10-15T10:00:00Z', read: false, kind: 'follow', actor: { id: 'u2', displayName: 'Bia' } },
      { id: 2, message: 'Be kind.', createdAt: '2026-10-14T10:00:00Z', read: false, kind: 'moderation', actor: null },
    ]);
  });
});
