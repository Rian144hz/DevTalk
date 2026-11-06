import type { ChallengeCategory, ExpressionType } from './categories';

export const LEVELS = ['A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type Level = (typeof LEVELS)[number];

export interface LearnerProfile {
  nativeLanguage: string;
  currentLevel: Level;
  targetLevel: Level;
  explanationLanguage: string;
}

/** An expression the coach suggested that is not in Review yet (no id until the person keeps it). */
export interface ExpressionDraft {
  text: string;
  type: ExpressionType;
  meaning: string;
  example: string;
}

export interface Expression extends ExpressionDraft {
  id: number;
}

export interface Challenge {
  id: number;
  category: ChallengeCategory;
  situation: string;
  interlocutor: string;
  task: string;
  summary: string;
  required: { expression: Expression; hint: string }[];
  createdAt: string;
}
