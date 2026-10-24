import { createHash } from 'node:crypto';
import { createServer, get, type Server } from 'node:http';
import type { RoomLiveEvent } from '../../src/core/social/rooms';
import { NOT_FINISHED_MESSAGE, PORTS_BUSY_MESSAGE } from '../../src/main/social/oauth-loopback';
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
  prefer: string | null;
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
      prefer: req.headers.get('Prefer'),
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
  // The client runs the PKCE flow (needed for GitHub); the e-mail code still works the same way.
  expect(calls[0]!.body).toMatchObject({ code_challenge: expect.any(String), code_challenge_method: 's256' });
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
    'POST /rest/v1/rpc/my_chat_export': json(200, { conversations: [], messagesSent: [], correctionsGiven: [] }),
    'POST /rest/v1/rpc/my_social_export': json(200, { following: [], followers: [], likesGiven: [] }),
    'POST /rest/v1/rpc/my_rooms_export': json(200, { roomsCreated: [], sessions: [] }),
    'POST /rest/v1/rpc/profile_badges': json(200, []),
  });
  await b.verifyCode('rian@example.com', '123456');
  const data = await b.exportOwnData();
  expect(data['moderationActions']).toEqual([{ action: 'warn', reason: 'Be kind', until: null, created_at: '2026-10-14T10:00:00Z' }]);
});

test('the export includes practice days and milestones with their times, badges, uses_linux and the banner', async () => {
  const progress = { practiceDays: [{ day: '2026-10-14', answers: 2, reviews: 5, updatedAt: '2026-10-14T21:00:00Z' }], milestones: [] };
  const rooms = {
    roomsCreated: [{ id: 'r1', title: 'Stand-up practice', theme: 'standup', createdAt: '2026-10-20T10:00:00Z', endedAt: null }],
    sessions: [{ roomId: 'r1', joinedAt: '2026-10-20T10:00:00Z', leftAt: null, role: 'member', removed: false }],
  };
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
    'POST /rest/v1/rpc/my_chat_export': json(200, { conversations: [], messagesSent: [{ id: 3, body: 'hi' }], correctionsGiven: [] }),
    'POST /rest/v1/rpc/my_social_export': json(200, { following: [{ id: 'u2', at: '2026-10-15T10:00:00Z' }], followers: [], likesGiven: [] }),
    'POST /rest/v1/rpc/my_rooms_export': json(200, rooms),
    'POST /rest/v1/rpc/profile_badges': json(200, [{ id: 'mentor', grp: 'community', label: 'Mentor', detail: null }]),
    'POST /storage/v1/object/sign/banners/user-1/banner.gif': json(200, { signedURL: '/object/sign/banners/user-1/banner.gif?token=t' }),
  });
  await b.verifyCode('rian@example.com', '123456');
  const data = await b.exportOwnData();
  expect(data).toMatchObject({ progress, usesLinux: true, badges: [{ id: 'mentor', group: 'community', label: 'Mentor', detail: null }] });
  expect(data['social']).toEqual({ following: [{ id: 'u2', at: '2026-10-15T10:00:00Z' }], followers: [], likesGiven: [] });
  expect(data['chat']).toEqual({ conversations: [], messagesSent: [{ id: 3, body: 'hi' }], correctionsGiven: [] });
  expect(data['rooms']).toEqual(rooms);
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
  test('the room, room action and signal limits are rate_limited', () => {
    for (const message of ['room limit reached', 'room action limit reached', 'signal limit reached']) {
      expect(mapSupabaseError({ code: 'P0001', message }, 400)).toMatchObject({ kind: 'rate_limited', message });
    }
  });
  test('other room errors keep their message for the window to explain', () => {
    expect(mapSupabaseError({ code: 'P0001', message: 'room is full' }, 400)).toMatchObject({ kind: 'unknown', message: 'room is full' });
    expect(mapSupabaseError({ code: 'P0001', message: 'room has ended' }, 400)).toMatchObject({ kind: 'unknown', message: 'room has ended' });
    expect(mapSupabaseError({ code: '22023', message: 'timer is not valid' }, 400)).toMatchObject({ kind: 'unknown', message: 'timer is not valid' });
    expect(mapSupabaseError({ code: '42501', message: 'not allowed' }, 403)).toMatchObject({ kind: 'forbidden', message: 'not allowed' });
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
      'GET /rest/v1/profiles': json(200, [{ id: 'u2', display_name: 'Bia', avatar_path: 'u2/avatar.webp', mascot: 'bear-2' }]),
    });
    await b.verifyCode('rian@example.com', '123456');
    expect(await b.listNotices()).toEqual([
      { id: 1, message: 'Bia followed you.', createdAt: '2026-10-15T10:00:00Z', read: false, kind: 'follow', actor: { id: 'u2', displayName: 'Bia', hasAvatar: true, mascot: 'bear-2' } },
      { id: 2, message: 'Be kind.', createdAt: '2026-10-14T10:00:00Z', read: false, kind: 'moderation', actor: null },
    ]);
  });
});

/** A Realtime channel the tests drive by hand: records what the backend registered and lets the test fire events. */
type Handler = (payload: { table: string; eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => void;
function fakeChannels() {
  const opened: { name: string; tables: string[]; events: string[]; filters: (string | undefined)[]; handlers: Handler[]; status?: (s: string) => void; closed: boolean }[] = [];
  const open = (name: string) => {
    const ch = { name, tables: [] as string[], events: [] as string[], filters: [] as (string | undefined)[], handlers: [] as Handler[], status: undefined as ((s: string) => void) | undefined, closed: false };
    opened.push(ch);
    const api = {
      on(_type: 'postgres_changes', filter: { event: string; table: string; filter?: string }, cb: Handler) {
        ch.tables.push(filter.table);
        ch.events.push(filter.event);
        ch.filters.push(filter.filter);
        ch.handlers.push(cb);
        return api;
      },
      subscribe(cb: (s: string) => void) {
        ch.status = cb;
        return api;
      },
      unsubscribe() {
        ch.closed = true;
        return Promise.resolve('ok');
      },
    };
    return api;
  };
  return { opened, open };
}
function chatBackend(routes: Record<string, Reply>) {
  const f = fakeFetch({ 'POST /auth/v1/verify': json(200, sessionBody()), ...routes });
  const channels = fakeChannels();
  const b = createSupabaseBackend({
    url: URL_BASE, key: 'sb_publishable_test', storage: memoryStorage(), fetch: f.fetch, autoRefreshToken: false, openChannel: channels.open,
  });
  return { b, calls: f.calls, channels };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('chat (Supabase)', () => {

  test('conversations map my_conversations', async () => {
    const { b, calls } = chatBackend({
      'POST /rest/v1/rpc/my_conversations': json(200, [
        { id: 'c1', other_id: 'u2', other_name: 'Bia', other_has_avatar: true, other_mascot: 'bear-2', status: 'accepted', requested_by_me: true, preview: 'Hi', last_message_at: '2026-10-15T10:00:00Z', unread: 2 },
      ]),
    });
    await b.verifyCode('rian@example.com', '123456');
    expect(await b.conversations()).toEqual([
      { id: 'c1', other: { id: 'u2', displayName: 'Bia', hasAvatar: true, mascot: 'bear-2' }, status: 'accepted', requestedByMe: true, preview: 'Hi', lastMessageAt: '2026-10-15T10:00:00Z', unread: 2 },
    ]);
    expect(calls.some((c) => c.path === '/rest/v1/rpc/my_conversations')).toBe(true);
  });

  test('messages read the newest 50 before a message with their corrections, oldest first', async () => {
    const correction = { id: 7, message_id: 11, author: 'u2', corrected: 'I have', created_at: '2026-10-15T10:02:00Z', thanked_at: null };
    const { b, calls } = chatBackend({
      'GET /rest/v1/messages': json(200, [
        { id: 11, conversation_id: 'c1', sender: 'user-1', body: 'I has', created_at: '2026-10-15T10:01:00Z', deleted_at: null, corrections: [correction] },
        { id: 10, conversation_id: 'c1', sender: 'u2', body: '', created_at: '2026-10-15T10:00:00Z', deleted_at: '2026-10-15T10:05:00Z', corrections: [] },
      ]),
    });
    await b.verifyCode('rian@example.com', '123456');
    expect(await b.messages('c1', 12)).toEqual([
      { id: 10, conversationId: 'c1', senderId: 'u2', body: '', createdAt: '2026-10-15T10:00:00Z', deleted: true, corrections: [] },
      {
        id: 11, conversationId: 'c1', senderId: 'user-1', body: 'I has', createdAt: '2026-10-15T10:01:00Z', deleted: false,
        corrections: [{ id: 7, messageId: 11, authorId: 'u2', corrected: 'I have', createdAt: '2026-10-15T10:02:00Z', thanked: false }],
      },
    ]);
    const q = calls.find((c) => c.path === '/rest/v1/messages')!.query;
    expect(q).toMatch(/corrections\(/);
    expect(q).toMatch(/conversation_id=eq\.c1/);
    expect(q).toMatch(/id=lt\.12/);
    expect(q).toMatch(/order=id\.desc/);
    expect(q).toMatch(/limit=50/);
  });

  test('requests, answers, sends, corrections and the other actions call the right places', async () => {
    const { b, calls } = chatBackend({
      'POST /rest/v1/rpc/request_conversation': json(200, 'c9'),
      'POST /rest/v1/rpc/respond_conversation': json(200, null),
      'POST /rest/v1/messages': json(201, null),
      'POST /rest/v1/corrections': json(201, null),
      'POST /rest/v1/rpc/delete_message': json(200, null),
      'POST /rest/v1/rpc/thank_correction': json(200, null),
      'POST /rest/v1/rpc/mark_read': json(200, null),
      'POST /rest/v1/rpc/report_context': json(200, [{ message_id: 5, sender_name: null, body: 'hey', created_at: '2026-10-15T10:00:00Z', reported: true }]),
    });
    await b.verifyCode('rian@example.com', '123456');
    expect(await b.requestConversation('u2', '  Hi Bia!\n ')).toBe('c9');
    await b.respondConversation('c9', false);
    await b.sendMessage('c9', ' Hello\nthere ');
    await b.suggestCorrection(11, ' I have ');
    await b.deleteMessage(11);
    await b.thankCorrection(7);
    await b.markRead('c9');
    expect(await b.reportContext(3)).toEqual([{ messageId: 5, senderName: null, body: 'hey', createdAt: '2026-10-15T10:00:00Z', reported: true }]);
    const body = (path: string) => calls.find((c) => c.path === path)!.body;
    expect(body('/rest/v1/rpc/request_conversation')).toEqual({ target: 'u2', body: 'Hi Bia!' });
    expect(body('/rest/v1/rpc/respond_conversation')).toEqual({ conversation: 'c9', accept: false });
    expect(body('/rest/v1/messages')).toEqual({ conversation_id: 'c9', sender: 'user-1', body: 'Hello\nthere' });
    expect(body('/rest/v1/corrections')).toEqual({ message_id: 11, author: 'user-1', corrected: 'I have' });
    expect(body('/rest/v1/rpc/delete_message')).toEqual({ message: 11 });
    expect(body('/rest/v1/rpc/thank_correction')).toEqual({ correction: 7 });
    expect(body('/rest/v1/rpc/mark_read')).toEqual({ conversation: 'c9' });
    expect(body('/rest/v1/rpc/report_context')).toEqual({ report: 3 });
  });

  test('blank or too long text is refused before any request', async () => {
    const { b, calls } = chatBackend({});
    await b.verifyCode('rian@example.com', '123456');
    const before = calls.length;
    expect((await errorOf(b.sendMessage('c1', '  \n '))).kind).toBe('unknown');
    expect((await errorOf(b.requestConversation('u2', 'x'.repeat(2001)))).kind).toBe('unknown');
    expect((await errorOf(b.suggestCorrection(1, ''))).kind).toBe('unknown');
    expect(calls.length).toBe(before);
  });

  test('daily chat limits come back as rate_limited', async () => {
    for (const message of ['request limit reached', 'message limit reached', 'correction limit reached']) {
      expect(mapSupabaseError({ code: 'P0001', message }, 400).kind).toBe('rate_limited');
    }
    const { b } = chatBackend({ 'POST /rest/v1/messages': json(400, { code: 'P0001', message: 'message limit reached' }) });
    await b.verifyCode('rian@example.com', '123456');
    expect(await errorOf(b.sendMessage('c1', 'hi'))).toMatchObject({ kind: 'rate_limited' });
  });

  test('subscribe listens to the three chat tables, maps rows to events and stops on sign-out', async () => {
    const { b, channels } = chatBackend({ 'GET /rest/v1/messages': json(200, { conversation_id: 'c2' }) });
    await b.verifyCode('rian@example.com', '123456');
    const events: unknown[] = [];
    const status: boolean[] = [];
    b.subscribe((e) => events.push(e), (on) => status.push(on));
    const ch = channels.opened[0]!;
    // Realtime does not apply RLS to DELETE events: the app never asks for them.
    expect(ch.tables.map((t, i) => `${t}:${ch.events[i]}`).sort()).toEqual([
      'conversations:INSERT', 'conversations:UPDATE', 'corrections:INSERT', 'corrections:UPDATE', 'messages:INSERT', 'messages:UPDATE',
    ]);
    ch.status!('SUBSCRIBED');
    ch.status!('CHANNEL_ERROR');
    expect(status).toEqual([true, false]);
    const fire = (table: string, eventType: string, row: Record<string, unknown>, old: Record<string, unknown> = {}) =>
      ch.handlers[ch.tables.indexOf(table)]!({ table, eventType, new: row, old });
    // Even if a DELETE arrived, its old id says nothing the member may read: no event.
    fire('conversations', 'DELETE', {}, { id: 'cX' });
    fire('messages', 'INSERT', { id: 1, conversation_id: 'c1' });
    fire('conversations', 'UPDATE', { id: 'c3', status: 'accepted' });
    fire('corrections', 'INSERT', { id: 4, message_id: 9 });
    fire('corrections', 'DELETE', {}, { id: 4 });
    await flush();
    expect(events).toEqual([
      { kind: 'message', conversationId: 'c1' },
      { kind: 'conversation', conversationId: 'c3' },
      { kind: 'correction', conversationId: 'c2' },
    ]);
    await b.signOut();
    expect(ch.closed).toBe(true);
    fire('messages', 'INSERT', { id: 2, conversation_id: 'c1' });
    ch.status!('SUBSCRIBED');
    await flush();
    expect(events).toHaveLength(3);
    expect(status).toEqual([true, false]);
  });
});

describe('rooms (Supabase)', () => {
  const room = '5b0f6f6e-0000-4000-8000-000000000001';
  const ok = () => new Response(null, { status: 204 });
  const body = (calls: Recorded[], path: string) => calls.find((c) => c.path === path)!.body;

  test('liveRooms maps live_rooms: the host name, the people with their names, the level', async () => {
    const { b, calls } = chatBackend({
      'POST /rest/v1/rpc/live_rooms': json(200, [
        {
          id: room, title: 'Stand-up practice', theme: 'standup', level: 'B1', host_name: 'Bia', created_at: '2026-10-20T10:00:00Z',
          people: [
            { id: 'u2', name: 'Bia', hasAvatar: true, mascot: null },
            { id: 'u3', name: 'Caio', hasAvatar: false, mascot: 'bear-2' },
          ],
        },
        { id: 'r2', title: 'Free chat', theme: 'free', level: null, host_name: null, created_at: '2026-10-20T09:00:00Z', people: null },
      ]),
    });
    await b.verifyCode('rian@example.com', '123456');
    expect(await b.liveRooms()).toEqual([
      {
        id: room, title: 'Stand-up practice', theme: 'standup', level: 'B1', hostName: 'Bia',
        people: [
          { id: 'u2', displayName: 'Bia', hasAvatar: true, mascot: null },
          { id: 'u3', displayName: 'Caio', hasAvatar: false, mascot: 'bear-2' },
        ],
      },
      { id: 'r2', title: 'Free chat', theme: 'free', level: null, hostName: '', people: [] },
    ]);
    expect(calls.some((c) => c.path === '/rest/v1/rpc/live_rooms')).toBe(true);
  });

  test('createRoom sends the trimmed title, the theme and the level; a bad title is refused before any request', async () => {
    const { b, calls } = chatBackend({ 'POST /rest/v1/rpc/create_room': json(200, room) });
    await b.verifyCode('rian@example.com', '123456');
    expect(await b.createRoom({ title: '  Code review night \n', theme: 'code_review', level: 'B2' })).toBe(room);
    expect(await b.createRoom({ title: 'Free chat', theme: 'free', level: null })).toBe(room);
    const sent = calls.filter((c) => c.path === '/rest/v1/rpc/create_room').map((c) => c.body);
    expect(sent).toEqual([
      { title: 'Code review night', theme: 'code_review', level: 'B2' },
      { title: 'Free chat', theme: 'free', level: null },
    ]);
    const before = calls.length;
    for (const title of ['', '  ab ', 'x'.repeat(61)]) {
      expect(await errorOf(b.createRoom({ title, theme: 'free', level: null }))).toMatchObject({ kind: 'unknown', message: 'room title is not valid' });
    }
    expect(calls.length).toBe(before);
  });

  test('joining, leaving, the roles, muting, removing, ending, the timer and the card call the right functions', async () => {
    const names = [
      'join_room', 'leave_room', 'make_room_moderator', 'remove_room_moderator', 'pass_host', 'mute_member', 'remove_from_room',
      'end_room', 'start_timer', 'stop_timer', 'next_card', 'set_room_muted',
    ];
    const { b, calls } = chatBackend(Object.fromEntries(names.map((n) => [`POST /rest/v1/rpc/${n}`, ok])));
    await b.verifyCode('rian@example.com', '123456');
    await b.joinRoom(room);
    await b.leaveRoom(room);
    await b.makeRoomModerator(room, 'u2');
    await b.removeRoomModerator(room, 'u2');
    await b.passHost(room, 'u3');
    await b.muteMember(room, 'u4');
    await b.removeFromRoom(room, 'u5');
    await b.endRoom(room);
    await b.setRoomTimer(room, 60);
    await b.setRoomTimer(room, 90);
    await b.setRoomTimer(room, null);
    await b.nextCard(room);
    await b.setRoomMuted(room, true);
    await b.setRoomMuted(room, false);
    const sent = calls.filter((c) => c.path.startsWith('/rest/v1/rpc/')).map((c) => [c.path.replace('/rest/v1/rpc/', ''), c.body]);
    expect(sent).toEqual([
      ['join_room', { room }],
      ['leave_room', { room }],
      ['make_room_moderator', { room, member: 'u2' }],
      ['remove_room_moderator', { room, member: 'u2' }],
      ['pass_host', { room, member: 'u3' }],
      ['mute_member', { room, member: 'u4' }],
      ['remove_from_room', { room, member: 'u5' }],
      ['end_room', { room }],
      ['start_timer', { room, seconds: 60 }],
      ['start_timer', { room, seconds: 90 }],
      ['stop_timer', { room }],
      ['next_card', { room }],
      ['set_room_muted', { room, muted: true }],
      ['set_room_muted', { room, muted: false }],
    ]);
  });

  test('roomHeartbeat gives back what the server says', async () => {
    const answers = [true, false];
    const { b, calls } = chatBackend({ 'POST /rest/v1/rpc/room_heartbeat': () => json(200, answers.shift()) });
    await b.verifyCode('rian@example.com', '123456');
    expect(await b.roomHeartbeat(room)).toBe(true);
    expect(await b.roomHeartbeat(room)).toBe(false);
    expect(body(calls, '/rest/v1/rpc/room_heartbeat')).toEqual({ room });
  });

  test('roomState maps room_state; a room you were never in is null', async () => {
    const state = {
      id: room, title: 'Stand-up practice', theme: 'standup', level: 'B1', hostId: 'u2', endedAt: null,
      timer: { startedAt: '2026-10-20T10:05:00+00:00', seconds: 60 }, card: 3,
      me: { live: true, removed: false, role: 'moderator', muteRequestedAt: '2026-10-20T10:06:00+00:00' },
      people: [
        { id: 'u2', displayName: 'Bia', hasAvatar: true, mascot: null, level: 'B1', role: 'host', muted: true },
        { id: 'user-1', displayName: 'Rian', hasAvatar: false, mascot: 'duck-1', level: 'B1', role: 'moderator', muted: false },
      ],
    };
    const { b, calls } = chatBackend({ 'POST /rest/v1/rpc/room_state': json(200, state) });
    await b.verifyCode('rian@example.com', '123456');
    expect(await b.roomState(room)).toEqual(state);
    // A person without the field counts as not muted; anything but true is not muted.
    const odd = chatBackend({
      'POST /rest/v1/rpc/room_state': json(200, { ...state, people: [{ ...state.people[0], muted: undefined }, { ...state.people[1], muted: 'yes' }] }),
    });
    await odd.b.verifyCode('rian@example.com', '123456');
    expect((await odd.b.roomState(room))!.people.map((p) => p.muted)).toEqual([false, false]);
    expect(body(calls, '/rest/v1/rpc/room_state')).toEqual({ room });
    const ended = { ...state, hostId: null, endedAt: '2026-10-20T11:00:00+00:00', timer: null, me: { ...state.me, live: false, muteRequestedAt: null }, people: [] };
    const other = chatBackend({ 'POST /rest/v1/rpc/room_state': json(200, ended) });
    await other.b.verifyCode('rian@example.com', '123456');
    expect(await other.b.roomState(room)).toEqual(ended);
    const none = chatBackend({ 'POST /rest/v1/rpc/room_state': json(200, null) });
    await none.b.verifyCode('rian@example.com', '123456');
    expect(await none.b.roomState('r9')).toBeNull();
  });

  test('a signal is inserted into room_signals without asking for the row back', async () => {
    const { b, calls } = chatBackend({ 'POST /rest/v1/room_signals': json(201, null) });
    await b.verifyCode('rian@example.com', '123456');
    await b.sendRoomSignal(room, 'u2', 'offer', '{"sdp":"v=0"}');
    const post = calls.find((c) => c.path === '/rest/v1/room_signals')!;
    expect(post.body).toEqual({ room_id: room, sender: 'user-1', recipient: 'u2', kind: 'offer', payload: '{"sdp":"v=0"}' });
    // Only the recipient may read a signal, so asking for the row back would fail.
    expect(post.query).not.toMatch(/select=/);
    expect(post.prefer ?? '').not.toMatch(/return=representation/);
  });

  test('room errors: a refused signal is forbidden, the limits are rate_limited, a full room keeps its message', async () => {
    const refused = chatBackend({ 'POST /rest/v1/room_signals': json(403, { code: '42501', message: 'new row violates row-level security policy for table "room_signals"' }) });
    await refused.b.verifyCode('rian@example.com', '123456');
    expect(await errorOf(refused.b.sendRoomSignal(room, 'u2', 'answer', '{}'))).toMatchObject({ kind: 'forbidden' });
    const limited = chatBackend({ 'POST /rest/v1/room_signals': json(400, { code: 'P0001', message: 'signal limit reached' }) });
    await limited.b.verifyCode('rian@example.com', '123456');
    expect(await errorOf(limited.b.sendRoomSignal(room, 'u2', 'candidate', '{}'))).toMatchObject({ kind: 'rate_limited' });
    const tooMany = chatBackend({ 'POST /rest/v1/rpc/create_room': json(400, { code: 'P0001', message: 'room limit reached' }) });
    await tooMany.b.verifyCode('rian@example.com', '123456');
    expect(await errorOf(tooMany.b.createRoom({ title: 'Another room', theme: 'free', level: null }))).toMatchObject({ kind: 'rate_limited' });
    const full = chatBackend({ 'POST /rest/v1/rpc/join_room': json(400, { code: 'P0001', message: 'room is full', hint: 'Try another room.' }) });
    await full.b.verifyCode('rian@example.com', '123456');
    expect(await errorOf(full.b.joinRoom(room))).toMatchObject({ kind: 'unknown', message: 'room is full' });
    const denied = chatBackend({ 'POST /rest/v1/rpc/mute_member': json(403, { code: '42501', message: 'not allowed' }) });
    await denied.b.verifyCode('rian@example.com', '123456');
    expect(await errorOf(denied.b.muteMember(room, 'u2'))).toMatchObject({ kind: 'forbidden', message: 'not allowed' });
  });

  test('roomReportContext maps the room a report names, and is null when the server gives nothing', async () => {
    const { b, calls } = chatBackend({
      'POST /rest/v1/rpc/room_report_context': json(200, {
        title: 'Stand-up practice', theme: 'standup', hostName: 'Bia', createdAt: '2026-10-20T10:00:00+00:00',
        people: [
          { name: 'Bia', joinedAt: '2026-10-20T10:00:00+00:00', leftAt: null },
          { name: null, joinedAt: '2026-10-20T10:01:00+00:00', leftAt: '2026-10-20T10:20:00+00:00' },
        ],
      }),
    });
    await b.verifyCode('rian@example.com', '123456');
    expect(await b.roomReportContext(8)).toEqual({
      title: 'Stand-up practice', theme: 'standup', hostName: 'Bia', createdAt: '2026-10-20T10:00:00+00:00',
      people: [
        { name: 'Bia', joinedAt: '2026-10-20T10:00:00+00:00', leftAt: null },
        { name: null, joinedAt: '2026-10-20T10:01:00+00:00', leftAt: '2026-10-20T10:20:00+00:00' },
      ],
    });
    expect(body(calls, '/rest/v1/rpc/room_report_context')).toEqual({ report: 8 });
    const none = chatBackend({ 'POST /rest/v1/rpc/room_report_context': json(200, null) });
    await none.b.verifyCode('rian@example.com', '123456');
    expect(await none.b.roomReportContext(9)).toBeNull();
  });

  test('subscribeRoom opens one channel for this room: INSERT and UPDATE of the room and its sessions, signals sent to me', async () => {
    const { b, channels } = chatBackend({});
    await b.verifyCode('rian@example.com', '123456');
    const events: RoomLiveEvent[] = [];
    b.subscribeRoom(room, (e) => events.push(e));
    await flush();
    expect(channels.opened).toHaveLength(1);
    const ch = channels.opened[0]!;
    // Realtime does not apply RLS to DELETE events: the app never asks for them.
    const registered = ch.tables.map((t, i) => `${t}:${ch.events[i]}:${ch.filters[i]}`).sort();
    expect(registered).toEqual([
      `room_sessions:INSERT:room_id=eq.${room}`,
      `room_sessions:UPDATE:room_id=eq.${room}`,
      'room_signals:INSERT:recipient=eq.user-1',
      `rooms:INSERT:id=eq.${room}`,
      `rooms:UPDATE:id=eq.${room}`,
    ]);
    expect(ch.events.every((e) => e === 'INSERT' || e === 'UPDATE')).toBe(true);
    expect(events).toEqual([]);
  });

  test('room changes become changed events, signals for this room become signal events, other rooms\' signals are ignored', async () => {
    const { b, channels } = chatBackend({});
    await b.verifyCode('rian@example.com', '123456');
    const events: RoomLiveEvent[] = [];
    b.subscribeRoom(room, (e) => events.push(e));
    await flush();
    const ch = channels.opened[0]!;
    const fire = (table: string, eventType: string, row: Record<string, unknown>, old: Record<string, unknown> = {}) =>
      ch.handlers[ch.tables.indexOf(table)]!({ table, eventType, new: row, old });
    fire('rooms', 'UPDATE', { id: room, card: 4 });
    fire('room_sessions', 'INSERT', { id: 7, room_id: room, user_id: 'u2' });
    fire('room_sessions', 'UPDATE', { id: 7, room_id: room, left_at: '2026-10-20T10:00:00Z' });
    // A DELETE says nothing the member may read: no event, even if one arrives.
    fire('rooms', 'DELETE', {}, { id: room });
    fire('room_sessions', 'DELETE', {}, { id: 7 });
    fire('room_signals', 'INSERT', { id: 1, room_id: room, sender: 'u2', recipient: 'user-1', kind: 'offer', payload: '{"sdp":"v=0"}' });
    fire('room_signals', 'INSERT', { id: 2, room_id: 'another-room', sender: 'u3', recipient: 'user-1', kind: 'offer', payload: '{}' });
    fire('room_signals', 'INSERT', { id: 3, room_id: room, sender: 'u3', recipient: 'user-1', kind: 'shout', payload: '{}' });
    fire('room_signals', 'DELETE', {}, { id: 1 });
    expect(events).toEqual([
      { kind: 'changed' },
      { kind: 'changed' },
      { kind: 'changed' },
      { kind: 'signal', from: 'u2', signal: 'offer', payload: '{"sdp":"v=0"}' },
    ]);
  });

  test('the channel status becomes online and offline, and sign-out closes the channel for good', async () => {
    const { b, channels } = chatBackend({});
    await b.verifyCode('rian@example.com', '123456');
    const events: RoomLiveEvent[] = [];
    b.subscribeRoom(room, (e) => events.push(e));
    await flush();
    const ch = channels.opened[0]!;
    ch.status!('SUBSCRIBED');
    ch.status!('CHANNEL_ERROR');
    ch.status!('SUBSCRIBED');
    expect(events).toEqual([{ kind: 'online' }, { kind: 'offline' }, { kind: 'online' }]);
    await b.signOut();
    expect(ch.closed).toBe(true);
    ch.handlers[0]!({ table: 'rooms', eventType: 'UPDATE', new: { id: room }, old: {} });
    ch.handlers[ch.tables.indexOf('room_signals')]!({ table: 'room_signals', eventType: 'INSERT', new: { room_id: room, sender: 'u2', kind: 'bye', payload: '{}' }, old: {} });
    ch.status!('SUBSCRIBED');
    expect(events).toHaveLength(3);
  });

  test('the unsubscribe closes the channel once, also when it is called before the channel was opened', async () => {
    const { b, channels } = chatBackend({});
    await b.verifyCode('rian@example.com', '123456');
    const early = b.subscribeRoom(room, () => undefined);
    early();
    await flush();
    expect(channels.opened).toHaveLength(0);
    const events: RoomLiveEvent[] = [];
    const off = b.subscribeRoom(room, (e) => events.push(e));
    await flush();
    off();
    off();
    expect(channels.opened).toHaveLength(1);
    expect(channels.opened[0]!.closed).toBe(true);
    channels.opened[0]!.handlers[0]!({ table: 'rooms', eventType: 'UPDATE', new: { id: room }, old: {} });
    expect(events).toEqual([]);
  });

  test('signed out, there is nothing to subscribe to', async () => {
    const { b, channels } = chatBackend({});
    const events: RoomLiveEvent[] = [];
    b.subscribeRoom(room, (e) => events.push(e))();
    await flush();
    expect(channels.opened).toHaveLength(0);
    expect(events).toEqual([]);
  });
});

describe('GitHub sign-in (Supabase)', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => { s.closeAllConnections(); s.close(() => r()); })));
  });

  /** The browser: follows a URL to the loopback (node:http without an agent, so nothing stays open). */
  function visit(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      get(url, { agent: false }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (body += c));
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });
  }

  /** A browser where the member finishes on GitHub: Supabase sends it back to redirect_to with `query`. */
  function browser(query: string | null) {
    const opened: string[] = [];
    const pages: Promise<string>[] = [];
    const openExternal = async (url: string) => {
      opened.push(url);
      const back = new URL(url).searchParams.get('redirect_to');
      if (back && query !== null) pages.push(visit(`${back}?${query}`));
    };
    return { opened, pages, openExternal };
  }

  function githubUser(sub = 'gh-1', meta: Record<string, unknown> = {}, providers = ['github']) {
    const body = sessionBody(sub, 'octo@example.com');
    return {
      ...body,
      user: {
        ...body.user,
        app_metadata: { provider: providers[0], providers },
        user_metadata: meta,
        identities: providers.map((provider, i) => ({ id: `${i}`, identity_id: `id-${i}`, user_id: sub, provider, identity_data: {} })),
      },
    };
  }

  // Port 0: any free port, so these tests never meet the ones that use 53682–53684.
  function ghBackend(routes: Record<string, Reply>, extra: { url?: string; oauthPorts?: number[]; oauthTimeoutMs?: number } = {}) {
    const f = fakeFetch(routes);
    const storage = memoryStorage();
    const b = createSupabaseBackend({
      url: extra.url ?? URL_BASE, key: 'sb_publishable_test', storage, fetch: f.fetch, autoRefreshToken: false,
      oauthPorts: extra.oauthPorts ?? [0], oauthTimeoutMs: extra.oauthTimeoutMs,
    });
    return { b, calls: f.calls, storage };
  }

  test('opens the project\'s authorize page for GitHub with the loopback redirect, then exchanges the code (PKCE)', async () => {
    const { b, calls } = ghBackend({ 'POST /auth/v1/token': json(200, githubUser()) });
    const web = browser('code=auth-code-1');
    const s = await b.signInWithGitHub({ openExternal: web.openExternal });
    expect(s).toEqual({ userId: 'gh-1', email: 'octo@example.com' });
    expect(await b.session()).toEqual(s);

    expect(web.opened).toHaveLength(1);
    const url = new URL(web.opened[0]!);
    expect(url.origin + url.pathname).toBe('https://proj.supabase.co/auth/v1/authorize');
    expect(url.searchParams.get('provider')).toBe('github');
    expect(url.searchParams.get('redirect_to')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(url.searchParams.get('scopes')).toBe('read:user user:email');
    expect(url.searchParams.get('code_challenge_method')).toBe('s256');
    expect(await web.pages[0]).toContain('You can go back to DevTalk.');

    const exchange = calls.find((c) => c.path === '/auth/v1/token')!;
    expect(exchange.method).toBe('POST');
    expect(exchange.query).toBe('?grant_type=pkce');
    const body = exchange.body as { auth_code: string; code_verifier: string };
    expect(body.auth_code).toBe('auth-code-1');
    // The verifier kept in the session store is the one behind the challenge sent to the browser.
    const challenge = createHash('sha256').update(body.code_verifier).digest('base64url');
    expect(url.searchParams.get('code_challenge')).toBe(challenge);
    // Nothing was fetched before the browser came back, except the exchange.
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /auth/v1/token']);
  });

  test('an error from GitHub (the member said no) ends with "not finished" and no exchange', async () => {
    const { b, calls } = ghBackend({ 'POST /auth/v1/token': json(200, githubUser()) });
    const web = browser('error=access_denied&error_description=The+user+denied+the+request');
    const err = await errorOf(b.signInWithGitHub({ openExternal: web.openExternal }));
    expect(err.kind).toBe('unknown');
    expect(err.message).toBe(NOT_FINISHED_MESSAGE);
    expect(await web.pages[0]).toContain('The user denied the request');
    expect(calls).toEqual([]);
    expect(await b.session()).toBeNull();
  });

  test('a made-up code (no matching PKCE flow) does not sign in', async () => {
    const { b } = ghBackend({
      'POST /auth/v1/token': json(400, { code: 400, error_code: 'flow_state_not_found', msg: 'invalid flow state, no valid flow state found' }),
    });
    const err = await errorOf(b.signInWithGitHub(browser('code=forged')));
    expect(err.kind).toBe('unknown');
    expect(err.message).toBe(NOT_FINISHED_MESSAGE);
    expect(await b.session()).toBeNull();
  });

  test('offline during the exchange says offline', async () => {
    const { b } = ghBackend({ 'POST /auth/v1/token': new TypeError('fetch failed') });
    expect((await errorOf(b.signInWithGitHub(browser('code=c')))).kind).toBe('offline');
  });

  test('refuses to open a URL that is not https on the project origin', async () => {
    // A local http project: the authorize URL is http, so nothing is opened.
    const { b } = ghBackend({}, { url: 'http://127.0.0.1:54321' });
    const web = browser('code=c');
    const err = await errorOf(b.signInWithGitHub({ openExternal: web.openExternal }));
    expect(err.kind).toBe('unknown');
    expect(err.message).toBe('Could not start GitHub sign-in.');
    expect(web.opened).toEqual([]);
  });

  test('a browser that cannot open stops the sign-in and closes the listener', async () => {
    let redirect = '';
    const { b } = ghBackend({});
    const err = await errorOf(
      b.signInWithGitHub({
        openExternal: async (url) => {
          redirect = new URL(url).searchParams.get('redirect_to')!;
          throw new Error('no browser');
        },
      }),
    );
    expect(err.message).toBe('Could not start GitHub sign-in.');
    await expect(visit(`${redirect}?code=late`)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });

  test('Cancel (abort) while the browser is open ends with "not finished" and frees the port', async () => {
    const { b } = ghBackend({});
    const ac = new AbortController();
    let redirect = '';
    const p = b.signInWithGitHub({
      signal: ac.signal,
      openExternal: async (url) => {
        redirect = new URL(url).searchParams.get('redirect_to')!;
        setTimeout(() => ac.abort(), 10);
      },
    });
    const err = await errorOf(p);
    expect(err.message).toBe(NOT_FINISHED_MESSAGE);
    await expect(visit(`${redirect}?code=late`)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    expect(await b.session()).toBeNull();
  });

  test('after Cancel, a new attempt gets the same port again', async () => {
    const free = createServer();
    await new Promise<void>((r) => free.listen(0, '127.0.0.1', () => r()));
    const port = (free.address() as { port: number }).port;
    await new Promise<void>((r) => free.close(() => r()));
    const { b } = ghBackend({ 'POST /auth/v1/token': json(200, githubUser()) }, { oauthPorts: [port] });
    const ac = new AbortController();
    const first = await errorOf(b.signInWithGitHub({ signal: ac.signal, openExternal: async () => void setTimeout(() => ac.abort(), 5) }));
    expect(first.message).toBe(NOT_FINISHED_MESSAGE);
    const web = browser('code=c2');
    expect(await b.signInWithGitHub({ openExternal: web.openExternal })).toEqual({ userId: 'gh-1', email: 'octo@example.com' });
    expect(new URL(web.opened[0]!).searchParams.get('redirect_to')).toBe(`http://127.0.0.1:${port}/callback`);
  });

  test('an already cancelled sign-in never opens the browser', async () => {
    const { b } = ghBackend({});
    const ac = new AbortController();
    ac.abort();
    const web = browser('code=c');
    expect((await errorOf(b.signInWithGitHub({ openExternal: web.openExternal, signal: ac.signal }))).message).toBe(NOT_FINISHED_MESSAGE);
    expect(web.opened).toEqual([]);
  });

  test('an abandoned browser times out with "not finished"', async () => {
    const { b } = ghBackend({}, { oauthTimeoutMs: 50 });
    const err = await errorOf(b.signInWithGitHub(browser(null)));
    expect(err.message).toBe(NOT_FINISHED_MESSAGE);
  });

  test('busy ports: the message names them', async () => {
    const other = createServer();
    servers.push(other);
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', () => r()));
    const port = (other.address() as { port: number }).port;
    const { b } = ghBackend({}, { oauthPorts: [port] });
    const web = browser('code=c');
    const err = await errorOf(b.signInWithGitHub({ openExternal: web.openExternal }));
    expect(err.kind).toBe('unknown');
    expect(err.message).toBe(PORTS_BUSY_MESSAGE);
    expect(PORTS_BUSY_MESSAGE).toBe('Could not start GitHub sign-in. Close other apps that use ports 53682\u201353684 and try again.');
    expect(web.opened).toEqual([]);
  });

  describe('githubSuggestion', () => {
    const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    const image = (bytes: Uint8Array<ArrayBuffer>, type = 'image/png', headers: Record<string, string> = {}) =>
      () => new Response(bytes, { status: 200, headers: { 'Content-Type': type, ...headers } });

    async function signedIn(meta: Record<string, unknown>, routes: Record<string, Reply> = {}, providers = ['github']) {
      const r = ghBackend({ 'POST /auth/v1/verify': json(200, githubUser('gh-1', meta, providers)), ...routes });
      await r.b.verifyCode('octo@example.com', '123456');
      return r;
    }

    test('the GitHub name and photo, downloaded from avatars.githubusercontent.com', async () => {
      const { b, calls } = await signedIn(
        { full_name: '  Octo   Dev  ', name: 'ignored', user_name: 'octo', avatar_url: 'https://avatars.githubusercontent.com/u/583231?v=4' },
        { 'GET /u/583231': image(PNG) },
      );
      const g = await b.githubSuggestion();
      expect(g.displayName).toBe('Octo Dev');
      expect(g.avatarType).toBe('image/png');
      expect([...g.avatar!]).toEqual([...PNG]);
      const photo = calls.find((c) => c.path === '/u/583231')!;
      expect(photo.query).toBe('?v=4');
      expect(photo.auth).toBeNull(); // the session token never goes to GitHub
    });

    test('name falls back to "name" and is cut to the display name limit', async () => {
      const { b } = await signedIn({ name: 'A'.repeat(60) });
      const g = await b.githubSuggestion();
      expect(g.displayName).toBe('A'.repeat(40));
      expect(g.avatar).toBeNull();
      expect(g.avatarType).toBeNull();
    });

    test('a name that is empty, too short or not text is no suggestion', async () => {
      expect((await (await signedIn({ full_name: '   ' })).b.githubSuggestion()).displayName).toBeNull();
      expect((await (await signedIn({ full_name: 'A' })).b.githubSuggestion()).displayName).toBeNull();
      expect((await (await signedIn({ full_name: 42, name: ['x'] })).b.githubSuggestion()).displayName).toBeNull();
    });

    test('a photo from any other host is never downloaded', async () => {
      for (const avatar_url of [
        'https://evil.example/u/1.png',
        'http://avatars.githubusercontent.com/u/1',
        'https://avatars.githubusercontent.com.evil.example/u/1',
        'https://avatars.githubusercontent.com@evil.example/u/1',
        'https://avatars.githubusercontent.com:8443/u/1',
        'file:///etc/passwd',
      ]) {
        const { b, calls } = await signedIn({ full_name: 'Octo Dev', avatar_url }, { 'GET /u/1.png': image(PNG), 'GET /u/1': image(PNG) });
        const g = await b.githubSuggestion();
        expect(g).toEqual({ displayName: 'Octo Dev', avatar: null, avatarType: null });
        expect(calls.filter((c) => c.method === 'GET' && c.path.startsWith('/u/'))).toEqual([]);
      }
    });

    test('a photo over 2 MB is refused, by its declared size or its real size', async () => {
      const url = 'https://avatars.githubusercontent.com/u/7';
      const declared = await signedIn({ full_name: 'Octo Dev', avatar_url: url }, { 'GET /u/7': image(PNG, 'image/png', { 'Content-Length': String(3 * 1024 * 1024) }) });
      expect((await declared.b.githubSuggestion()).avatar).toBeNull();
      const big = new Uint8Array(2 * 1024 * 1024 + 1);
      big.set(PNG);
      const real = await signedIn({ full_name: 'Octo Dev', avatar_url: url }, { 'GET /u/7': image(big) });
      expect((await real.b.githubSuggestion()).avatar).toBeNull();
      const exact = new Uint8Array(2 * 1024 * 1024);
      exact.set(PNG);
      const ok = await signedIn({ full_name: 'Octo Dev', avatar_url: url }, { 'GET /u/7': image(exact) });
      expect((await ok.b.githubSuggestion()).avatar?.byteLength).toBe(2 * 1024 * 1024);
    });

    test('only PNG, JPEG, WebP or GIF photos, and the bytes must be that kind of image', async () => {
      const url = 'https://avatars.githubusercontent.com/u/8';
      const svg = await signedIn({ full_name: 'Octo Dev', avatar_url: url }, { 'GET /u/8': image(new TextEncoder().encode('<svg/>'), 'image/svg+xml') });
      expect((await svg.b.githubSuggestion()).avatar).toBeNull();
      const html = await signedIn({ full_name: 'Octo Dev', avatar_url: url }, { 'GET /u/8': image(new TextEncoder().encode('<html>'), 'text/html') });
      expect((await html.b.githubSuggestion()).avatar).toBeNull();
      const lying = await signedIn({ full_name: 'Octo Dev', avatar_url: url }, { 'GET /u/8': image(new TextEncoder().encode('<svg/> not a png'), 'image/png') });
      expect((await lying.b.githubSuggestion()).avatar).toBeNull();
      const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
      const ok = await signedIn({ full_name: 'Octo Dev', avatar_url: url }, { 'GET /u/8': image(jpeg, 'image/jpeg; charset=binary') });
      expect(await ok.b.githubSuggestion()).toMatchObject({ avatarType: 'image/jpeg' });
    });

    test('a failed or missing photo is just no photo', async () => {
      const url = 'https://avatars.githubusercontent.com/u/9';
      const missing = await signedIn({ full_name: 'Octo Dev', avatar_url: url }, { 'GET /u/9': json(404, {}) });
      expect(await missing.b.githubSuggestion()).toEqual({ displayName: 'Octo Dev', avatar: null, avatarType: null });
      const offline = await signedIn({ full_name: 'Octo Dev', avatar_url: url }, { 'GET /u/9': new TypeError('fetch failed') });
      expect(await offline.b.githubSuggestion()).toEqual({ displayName: 'Octo Dev', avatar: null, avatarType: null });
    });

    test('nothing for a member without a GitHub identity, even with the same metadata', async () => {
      const { b, calls } = await signedIn(
        { full_name: 'Octo Dev', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
        { 'GET /u/1': image(PNG) },
        ['email'],
      );
      expect(await b.githubSuggestion()).toEqual({ displayName: null, avatar: null, avatarType: null });
      expect(calls.filter((c) => c.path === '/u/1')).toEqual([]);
    });

    test('signed out is not_signed_in', async () => {
      const { b } = ghBackend({});
      expect((await errorOf(b.githubSuggestion())).kind).toBe('not_signed_in');
    });
  });
});
