export interface SocialConfig {
  url: string;
  key: string;
}

function jwtRole(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/**
 * Reads the Supabase URL and the public key baked into the build. Returns null when they are missing or
 * malformed — and when the key is a secret one, which must never ship in the app.
 */
export function readSocialConfig(env: {
  readonly MAIN_VITE_SUPABASE_URL?: string;
  readonly MAIN_VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}): SocialConfig | null {
  const rawUrl = env['MAIN_VITE_SUPABASE_URL']?.trim();
  const key = env['MAIN_VITE_SUPABASE_PUBLISHABLE_KEY']?.trim();
  if (!rawUrl || !key) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
  const publishable = key.startsWith('sb_publishable_') || jwtRole(key) === 'anon';
  if (!publishable) return null;
  return { url: url.origin, key };
}
