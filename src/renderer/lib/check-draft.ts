import { CHECK_TYPES, type CheckType } from '../../core/check/types';

/**
 * What is being written in Check, kept so that leaving the screen (Open Settings to fix the key, a Ctrl+digit, a click in
 * the rail) does not lose it. It lives in this module's memory only: it is never written to browser storage, sent over
 * IPC or saved to disk, and a reload or quitting the app empties it. A check does not clear it: the field still holds the
 * text beside the result, so the draft does too.
 */
export interface CheckDraft {
  type: CheckType;
  text: string;
}

let draft: CheckDraft = { type: CHECK_TYPES[0], text: '' };

export const loadCheckDraft = (): CheckDraft => draft;

export function saveCheckDraft(next: CheckDraft): void {
  draft = next;
}
