import { useState } from 'react';
import { mascotFor } from '../../core/social/mascots';
import type { MascotId } from '../../core/social/types';
import { MASCOT_URLS } from '../lib/mascots';

/**
 * A profile photo; without one, the member's mascot (chosen, or picked from their id); without an id, the first
 * letter of the name in a circle. The name is always shown next to it.
 */
export function Avatar({
  src,
  name,
  size = 40,
  userId,
  mascot = null,
}: {
  src: string | null;
  name: string;
  size?: number;
  userId?: string | null;
  mascot?: MascotId | null;
}) {
  // A photo that cannot be decoded (corrupt upload, wrong type) falls back instead of showing a broken image.
  // Remember which src failed: a data: URL can fail before effects run, so a reset-on-change effect would undo it.
  const [failed, setFailed] = useState<string | null>(null);
  const style = { width: size, height: size };
  if (src && src !== failed) {
    return <img className="avatar" src={src} alt="" width={size} height={size} style={style} onError={() => setFailed(src)} />;
  }
  if (userId) {
    return <img className="avatar avatar-mascot" src={MASCOT_URLS[mascotFor(userId, mascot)]} alt="" width={size} height={size} style={style} />;
  }
  const initial = Array.from(name.trim())[0]?.toLocaleUpperCase('en') ?? '?';
  return (
    <span className="avatar avatar-initial" aria-hidden="true" style={{ ...style, fontSize: Math.round(size * 0.42) }}>
      {initial}
    </span>
  );
}
