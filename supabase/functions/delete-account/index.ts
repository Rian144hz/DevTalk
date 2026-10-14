// Supabase Edge Function (Deno): deletes the calling user's account.
// The service-role key exists only here, in the function's environment; it never ships with the app.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { handle } from './handler.ts';

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
