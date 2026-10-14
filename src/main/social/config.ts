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

/** Prefixes electron-vite bundles into main, preload or renderer code. */
const BUNDLED_PREFIXES = ['MAIN_VITE_', 'PRELOAD_VITE_', 'RENDERER_VITE_', 'VITE_'];

/**
 * Build guard: the names of bundled variables holding a secret Supabase key (sb_secret_… or a service_role JWT).
 * electron.vite.config.ts refuses to build when this is not empty, so a secret pasted into .env never ships.
 */
export function findShippedSecrets(env: Record<string, string | undefined>): string[] {
  return Object.entries(env)
    .filter(([name, value]) => BUNDLED_PREFIXES.some((p) => name.startsWith(p)) && value)
    .filter(([, value]) => value!.trim().startsWith('sb_secret_') || jwtRole(value!.trim()) === 'service_role')
    .map(([name]) => name);
}
