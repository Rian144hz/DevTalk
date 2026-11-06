import { MISTAKE_CATEGORIES, type ChallengeCategory } from '../domain/categories';
import type { Challenge, Expression, LearnerProfile } from '../domain/types';

export const FEEDBACK_SCHEMA_EXAMPLE = `{
  "corrections": [{"original": "...", "corrected": "...", "explanation": "...", "category": "..."}],
  "natural_rewrite": "...",
  "new_expressions": [{"expression": "...", "type": "chunk | phrasal_verb | collocation", "meaning": "...", "example": "..."}],
  "required_expressions_check": [{"expression": "...", "used": true, "used_correctly": true, "note": "..."}]
}`;

export const CHALLENGE_SCHEMA_EXAMPLE = `{
  "category": "daily_update | code_review | bug_explanation | tech_interview",
  "situation": "...",
  "interlocutor": "...",
  "task": "...",
  "required_expressions": [{"expression": "...", "hint": "..."}],
  "summary": "..."
}`;

export type FeedbackContext = { kind: 'challenge'; challenge: Challenge } | { kind: 'free'; situation?: string };

export function learnerVars(learner: LearnerProfile): Record<string, string> {
  return {
    native_language: learner.nativeLanguage,
    current_level: learner.currentLevel,
    target_level: learner.targetLevel,
    explanation_language: learner.explanationLanguage,
  };
}

export function coachSystemVars(learner: LearnerProfile): Record<string, string> {
  return {
    ...learnerVars(learner),
    mistake_categories: MISTAKE_CATEGORIES.join(', '),
    feedback_schema: FEEDBACK_SCHEMA_EXAMPLE,
  };
}

export function challengePromptVars(args: {
  learner: LearnerProfile;
  category: ChallengeCategory;
  required: Expression[];
  recentSummaries: string[];
}): Record<string, string> {
  return {
    ...learnerVars(args.learner),
    category: args.category,
    required_expressions: args.required.length
      ? '\n' + args.required.map((e) => `- ${e.text} (${e.type}): ${e.meaning}`).join('\n') + '\n'
      : 'none',
    recent_situations: args.recentSummaries.length ? args.recentSummaries.join('; ') : 'none',
    challenge_schema: CHALLENGE_SCHEMA_EXAMPLE,
  };
}

const DELIMITER = '"""';

/** The text between triple quotes. A triple quote inside it is replaced, so it cannot close the block. */
export function fenced(text: string): string {
  return [DELIMITER, text.split(DELIMITER).join('“””'), DELIMITER].join('\n');
}

export function buildFeedbackUserMessage(input: { text: string; context: FeedbackContext }): string {
  const { context } = input;
  const header =
    context.kind === 'challenge'
      ? [
          `Challenge category: ${context.challenge.category}`,
          `Situation: ${context.challenge.situation}`,
          `Interlocutor: ${context.challenge.interlocutor}`,
          `Task: ${context.challenge.task}`,
          `Required expressions: ${
            context.challenge.required.length
              ? context.challenge.required.map((r) => r.expression.text).join('; ')
              : 'none'
          }`,
        ]
      : [`Context: ${context.situation ?? 'a chat message to another developer'}`, 'Required expressions: none'];
  return [...header, '', "Learner's answer:", fenced(input.text)].join('\n');
}
