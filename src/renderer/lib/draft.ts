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
