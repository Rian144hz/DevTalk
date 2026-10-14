export const CHALLENGE_CATEGORIES = ['daily_update', 'code_review', 'bug_explanation', 'tech_interview'] as const;
export type ChallengeCategory = (typeof CHALLENGE_CATEGORIES)[number];

export const MISTAKE_CATEGORIES = [
  'articles',
  'verb_tense',
  'prepositions',
  'word_order',
  'word_choice',
  'collocation',
  'subject_verb_agreement',
  'plurals',
  'missing_word',
  'register',
  'off_task',
] as const;
export type MistakeCategory = (typeof MISTAKE_CATEGORIES)[number];

export const EXPRESSION_TYPES = ['chunk', 'phrasal_verb', 'collocation'] as const;
export type ExpressionType = (typeof EXPRESSION_TYPES)[number];

export const TEXT_SOURCES = ['typed', 'chat', 'transcript', 'selection'] as const;
export type TextSource = (typeof TEXT_SOURCES)[number];
