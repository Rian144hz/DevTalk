export const CHALLENGE_CATEGORIES = ['daily_update', 'code_review', 'bug_explanation', 'tech_interview'] as const;
export type ChallengeCategory = (typeof CHALLENGE_CATEGORIES)[number];

export const CHALLENGE_CATEGORY_LABELS: Record<ChallengeCategory, string> = {
  daily_update: 'Stand-up update',
  code_review: 'Code review',
  bug_explanation: 'Explain a bug',
  tech_interview: 'Interview',
};

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

/** How a category reads in the interface. */
export const MISTAKE_LABELS: Record<MistakeCategory, string> = {
  articles: 'articles',
  verb_tense: 'verb tense',
  prepositions: 'prepositions',
  word_order: 'word order',
  word_choice: 'word choice',
  collocation: 'collocation',
  subject_verb_agreement: 'subject–verb agreement',
  plurals: 'plurals',
  missing_word: 'missing word',
  register: 'register',
  off_task: 'off topic',
};

export const EXPRESSION_TYPES = ['chunk', 'phrasal_verb', 'collocation'] as const;
export type ExpressionType = (typeof EXPRESSION_TYPES)[number];

export const EXPRESSION_TYPE_LABELS: Record<ExpressionType, string> = {
  chunk: 'chunk',
  phrasal_verb: 'phrasal verb',
  collocation: 'collocation',
};

export const TEXT_SOURCES = ['typed', 'chat', 'transcript', 'selection'] as const;
export type TextSource = (typeof TEXT_SOURCES)[number];
