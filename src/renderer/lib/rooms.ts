// What the Rooms screens say and allow: theme and level lines, seats, role labels, who may do what to whom, the
// microphone problems and how to fix them. Pure, so it is tested without a window.
import type { Level } from '../../core/domain/types';
import { ROOM_MAX, ROOM_THEME_LABELS, type RoomRole, type RoomTheme } from '../../core/social/rooms';

/** "Stand-up, B1"; a room with no suggested level is for any level. */
export function roomMeta(room: { theme: RoomTheme; level: Level | null }): string {
  return `${ROOM_THEME_LABELS[room.theme]}, ${room.level ?? 'any level'}`;
}

/** "2 / 6": live people out of the most a room holds. */
export const seatsText = (people: number): string => `${people} / ${ROOM_MAX}`;

export function roleLabel(role: RoomRole): string | null {
  return role === 'host' ? 'Host' : role === 'moderator' ? 'Room moderator' : null;
}

/** "Bia", "Bia and Caio", "Bia, Caio and Dani". */
export function namesList(names: readonly string[]): string {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The room powers you have over another live person, mirroring the database rules. Everyone can also mute someone
 * for themselves, report and block. The host mutes and removes anyone, gives and takes the moderator role and passes
 * the host role; a room moderator mutes anyone but the host and removes members only. Nobody acts on the host.
 */
export function roomActions(mine: RoomRole, theirs: RoomRole) {
  const host = mine === 'host';
  const power = host || mine === 'moderator';
  return {
    mute: power && theirs !== 'host',
    remove: theirs !== 'host' && (host || (power && theirs === 'member')),
    makeModerator: host && theirs === 'member',
    removeModerator: host && theirs === 'moderator',
    makeHost: host && theirs !== 'host',
  };
}

/** Why the microphone did not open, and what to do about it. */
export function micProblem(error: unknown): { title: string; detail: string } {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return { title: 'No microphone found.', detail: 'Connect a microphone or a headset, then try again.' };
  }
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return {
      title: 'DevTalk cannot use your microphone.',
      detail: 'Allow DevTalk to use the microphone in your system privacy or sound settings, then try again.',
    };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return { title: 'Your microphone is busy.', detail: 'Another app may be using it. Close that app, then try again.' };
  }
  return { title: 'The microphone did not start.', detail: 'Check that it is connected, then try again.' };
}

/** Why the room view closed by itself, shown on the room list. */
export const OUTCOME_TEXT = {
  removed: 'You were removed from this room.',
  ended: 'The room has ended.',
  gone: 'You are no longer in this room.',
} as const;
export type RoomOutcome = keyof typeof OUTCOME_TEXT;

/** Louder than this starts the speaking ring… */
const SPEAKING_ON = 0.45;
/** …and it stays until the level drops under this, so it does not flicker between words. */
const SPEAKING_OFF = 0.3;

/** Whether someone is speaking now, from their voice level (0..1) and whether they were a moment ago. */
export function speakingNow(level: number, was: boolean): boolean {
  if (!(level >= 0)) return false;
  return was ? level >= SPEAKING_OFF : level > SPEAKING_ON;
}
