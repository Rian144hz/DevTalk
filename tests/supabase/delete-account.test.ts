import { handle } from '../../supabase/functions/delete-account/handler';
import type { DeleteAccountDeps } from '../../supabase/functions/delete-account/handler';

function deps(over: Partial<DeleteAccountDeps> = {}) {
  const calls: string[] = [];
  const d: DeleteAccountDeps = {
    getUserId: async (jwt) => (jwt === 'good' ? 'user-1' : null),
    removeFiles: async (bucket, uid) => {
      calls.push(`${bucket}:${uid}`);
    },
    deleteUser: async (uid) => {
      calls.push(`user:${uid}`);
    },
    ...over,
  };
  return { d, calls };
}

const post = (auth?: string) =>
  new Request('https://x.supabase.co/functions/v1/delete-account', {
    method: 'POST',
    headers: auth ? { Authorization: auth } : {},
  });

test('only POST is accepted', async () => {
  const { d, calls } = deps();
  const res = await handle(new Request('https://x/delete-account', { method: 'GET' }), d);
  expect(res.status).toBe(405);
  expect(calls).toEqual([]);
});

test('a request without a bearer token is refused', async () => {
  const { d, calls } = deps();
  expect((await handle(post(), d)).status).toBe(401);
  expect((await handle(post('Basic abc'), d)).status).toBe(401);
  expect(calls).toEqual([]);
});

test('an invalid token is refused', async () => {
  const { d, calls } = deps();
  expect((await handle(post('Bearer bad'), d)).status).toBe(401);
  expect(calls).toEqual([]);
});

test('a valid request removes the photo and banner files first, then the user', async () => {
  const { d, calls } = deps();
  const res = await handle(post('Bearer good'), d);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ deleted: true });
  expect(calls).toEqual(['avatars:user-1', 'banners:user-1', 'user:user-1']);
});

test('a failure while removing the banner stops before deleting the user', async () => {
  const { d, calls } = deps({
    removeFiles: async (bucket, uid) => {
      if (bucket === 'banners') throw new Error('storage down');
      calls.push(`${bucket}:${uid}`);
    },
  });
  const res = await handle(post('Bearer good'), d);
  expect(res.status).toBe(500);
  expect(calls).toEqual(['avatars:user-1']);
});

test('a failure while removing avatars stops before deleting the user', async () => {
  const { d, calls } = deps({
    removeFiles: async () => {
      throw new Error('storage down');
    },
  });
  const res = await handle(post('Bearer good'), d);
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: 'storage down' });
  expect(calls).toEqual([]);
});

test('a failure while deleting the user is reported, not hidden', async () => {
  const { d } = deps({
    deleteUser: async () => {
      throw new Error('admin api down');
    },
  });
  const res = await handle(post('Bearer good'), d);
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: 'admin api down' });
});
