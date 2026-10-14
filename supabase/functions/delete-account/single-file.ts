// DevTalk — delete-account Edge Function, as one file for the Supabase dashboard editor.
// Generated from supabase/functions/delete-account by `npm run build:edge`. Do not edit by hand.

import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

interface DeleteAccountDeps {
  /** The user id for a valid access token, or null. */
  getUserId(jwt: string): Promise<string | null>;
  /** Removes every file under avatars/{uid}/. */
  removeAvatars(uid: string): Promise<void>;
  /** Deletes the auth user; database rows go with it (on delete cascade / set null). */
  deleteUser(uid: string): Promise<void>;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function handle(req: Request, deps: DeleteAccountDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
  const auth = req.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(auth);
  if (!match) return json(401, { error: 'Sign in first.' });
  const uid = await deps.getUserId(match[1]!);
  if (!uid) return json(401, { error: 'Sign in first.' });
  try {
    await deps.removeAvatars(uid);
    await deps.deleteUser(uid);
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
  return json(200, { deleted: true });
}

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve((req) =>
  handle(req, {
    async getUserId(jwt) {
      const { data, error } = await admin.auth.getUser(jwt);
      return error || !data.user ? null : data.user.id;
    },
    async removeAvatars(uid) {
      const bucket = admin.storage.from('avatars');
      const { data, error } = await bucket.list(uid);
      if (error) throw new Error(error.message);
      if (data.length === 0) return;
      const { error: removeError } = await bucket.remove(data.map((f) => `${uid}/${f.name}`));
      if (removeError) throw new Error(removeError.message);
    },
    async deleteUser(uid) {
      const { error } = await admin.auth.admin.deleteUser(uid);
      if (error) throw new Error(error.message);
    },
  }),
);
