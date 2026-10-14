import type { Challenge } from '../../core/domain/types';

// A one-shot hand-off from Feedback ("Write it again") to Practice.
let draft: { challenge: Challenge; text: string } | null = null;

export function setRetryDraft(next: { challenge: Challenge; text: string }): void {
  draft = next;
}

export function takeRetryDraft(): { challenge: Challenge; text: string } | null {
  const d = draft;
  draft = null;
  return d;
}

// Unsent answers per challenge, so leaving Practice (e.g. to fix the key in Settings) keeps the text.
const answers = new Map<number, string>();

export const loadAnswer = (challengeId: number): string => answers.get(challengeId) ?? '';

export function saveAnswer(challengeId: number, text: string): void {
  if (text) answers.set(challengeId, text);
  else answers.delete(challengeId);
}

export const clearAnswer = (challengeId: number): void => {
  answers.delete(challengeId);
};
