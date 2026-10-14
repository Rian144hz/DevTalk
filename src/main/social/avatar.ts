export const MAX_AVATAR_BYTES = 200 * 1024;

/** The renderer re-encodes photos to WebP; main still checks what it is about to upload. */
export function validateAvatar(bytes: Uint8Array): 'ok' | 'not_webp' | 'too_large' {
  const isWebp =
    bytes.byteLength >= 12 &&
    String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) === 'RIFF' &&
    String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!) === 'WEBP';
  if (!isWebp) return 'not_webp';
  return bytes.byteLength > MAX_AVATAR_BYTES ? 'too_large' : 'ok';
}
