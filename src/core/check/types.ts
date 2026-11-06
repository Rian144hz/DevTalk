// Check text: what kinds of text there are, the length rule and the privacy note.
import type { MistakeCategory } from '../domain/categories';
import type { ExpressionDraft } from '../domain/types';
import type { ProviderId } from '../../shared/providers';

export const CHECK_TYPES = ['pull_request', 'slack', 'email', 'code_review_comment', 'commit_message', 'other'] as const;
export type CheckType = (typeof CHECK_TYPES)[number];

/** How a type reads in the interface, in the order of the list. */
export const CHECK_TYPE_LABELS: Record<CheckType, string> = {
  pull_request: 'Pull request description',
  slack: 'Slack message',
  email: 'E-mail',
  code_review_comment: 'Code review comment',
  commit_message: 'Commit message',
  other: 'Other',
};

/** One sentence for the coach: the register the natural version has to keep. */
export const CHECK_TYPE_TONES: Record<CheckType, string> = {
  pull_request: 'clear and neutral: what changed and why, in short sentences or bullet points',
  slack: 'casual and friendly: short, direct sentences, the way colleagues write in a chat',
  email: 'formal and polite: a greeting, complete sentences and a closing line',
  code_review_comment: 'direct but polite and constructive: one point at a time, suggesting instead of ordering',
  commit_message: 'short and factual: a subject line in the imperative mood, with no filler',
  other: 'the same tone as the original text',
};

export const CHECK_TEXT_MAX = 2000;

/** The text to check: trimmed; null when blank or longer than 2 000 characters (UTF-16 units, like chatText). Newlines stay. */
export function checkText(raw: string): string | null {
  const text = raw.trim();
  return text.length === 0 || text.length > CHECK_TEXT_MAX ? null : text;
}

/** Under the result's natural version: what the coach kept. "Keeps the tone of a slack message." */
export function checkToneHint(type: CheckType): string {
  if (type === 'other') return 'Keeps the tone of your text.';
  const label = CHECK_TYPE_LABELS[type].toLowerCase();
  return `Keeps the tone of ${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label}.`;
}

const PRIVACY_NOTE = 'Do not paste passwords, keys or private code.';
const GEMINI_FREE_NOTE = 'On the free Gemini plan, Google may use what you send to improve its models.';

/** The fixed note under the text field. The second sentence is true of the Gemini coach only. */
export function checkPrivacyNote(provider: ProviderId): string {
  return provider === 'gemini' ? `${PRIVACY_NOTE} ${GEMINI_FREE_NOTE}` : PRIVACY_NOTE;
}

export interface CheckResult {
  corrections: { original: string; corrected: string; explanation: string; category: MistakeCategory }[];
  naturalRewrite: string;
  /** Not in Review yet: the person keeps the ones they want. */
  expressions: ExpressionDraft[];
}
