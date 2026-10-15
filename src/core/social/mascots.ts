import { MASCOTS, type MascotId } from './types';

/** 32-bit FNV-1a over the UTF-8 bytes of `s`. */
export function fnv1a32(s: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(s)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The mascot shown for an account: the chosen one, else a stable pick from the account id. */
export function mascotFor(userId: string, chosen: MascotId | null): MascotId {
  return chosen ?? MASCOTS[fnv1a32(userId) % MASCOTS.length]!;
}
