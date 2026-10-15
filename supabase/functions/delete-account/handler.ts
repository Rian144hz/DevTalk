// Pure request handling for the delete-account Edge Function. No Deno APIs here, so it can be tested in Node.

/** Storage buckets that hold a member's files under {uid}/ (profile photo, profile banner). */
export const USER_BUCKETS = ['avatars', 'banners'] as const;

export interface DeleteAccountDeps {
  /** The user id for a valid access token, or null. */
  getUserId(jwt: string): Promise<string | null>;
  /** Removes every file under {bucket}/{uid}/. */
  removeFiles(bucket: (typeof USER_BUCKETS)[number], uid: string): Promise<void>;
  /** Deletes the auth user; database rows go with it (on delete cascade / set null). */
  deleteUser(uid: string): Promise<void>;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handle(req: Request, deps: DeleteAccountDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
  const auth = req.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(auth);
  if (!match) return json(401, { error: 'Sign in first.' });
  const uid = await deps.getUserId(match[1]!);
  if (!uid) return json(401, { error: 'Sign in first.' });
  try {
    // Files first: once the user is gone, nothing links them to the account any more.
    for (const bucket of USER_BUCKETS) await deps.removeFiles(bucket, uid);
    await deps.deleteUser(uid);
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
  return json(200, { deleted: true });
}
