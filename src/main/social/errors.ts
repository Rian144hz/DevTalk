export type SocialErrorKind =
  | 'not_configured'
  | 'offline'
  | 'invalid_code'
  | 'rate_limited'
  | 'asleep'
  | 'suspended'
  | 'not_signed_in'
  | 'forbidden'
  | 'unknown';

export class SocialError extends Error {
  constructor(
    readonly kind: SocialErrorKind,
    message: string,
    /** For `suspended`: when the suspension ends (ISO date, or 'infinity'). */
    readonly until?: string,
  ) {
    super(message);
    this.name = 'SocialError';
  }
}

/** Maps a PostgREST / Storage error (plus the HTTP status, 0 when the request never got an answer). */
export function mapSupabaseError(err: { code?: string; message?: string } | null | undefined, status: number): SocialError {
  const message = err?.message ?? 'Unknown error';
  const code = err?.code ?? '';
  if (status === 0) return new SocialError('offline', message);
  if (/report limit|follow limit|like limit|request limit|message limit|correction limit/i.test(message)) return new SocialError('rate_limited', message);
  if (code === 'PGRST301' || code === 'PGRST303') return new SocialError('not_signed_in', message);
  if (code === '42501' || status === 401 || status === 403) return new SocialError('forbidden', message);
  if (status >= 500) return new SocialError('asleep', message);
  return new SocialError('unknown', message);
}
