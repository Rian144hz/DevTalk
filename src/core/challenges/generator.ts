import { normalizeExpression } from '../domain/text';
import type { Challenge, LearnerProfile } from '../domain/types';
import { generateStructured, type ProgressStage } from '../llm/structured';
import type { LLMProvider } from '../llm/provider';
import type { Clock, StudyStore } from '../ports';
import { challengePromptVars } from '../prompts/messages';
import { renderTemplate } from '../prompts/render';
import { ChallengeSchema } from './schema';
import { CATEGORY_WINDOW, pickCategory } from './select';

const RECENT_SITUATIONS = 10;
const MAX_REQUIRED = 2;

export class ChallengeGenerator {
  constructor(
    private readonly deps: {
      provider: LLMProvider;
      store: StudyStore;
      clock: Clock;
      challengeTemplate: string;
      rng?: () => number;
    },
  ) {}

  async next(learner: LearnerProfile, signal: AbortSignal, onProgress?: (s: ProgressStage) => void): Promise<Challenge> {
    const { provider, store, clock } = this.deps;
    const now = clock.now();
    const recent = store.recentChallenges(RECENT_SITUATIONS);
    const category = pickCategory(
      recent.slice(0, CATEGORY_WINDOW).map((c) => c.category),
      this.deps.rng ?? Math.random,
    );
    // Only cards already reviewed at least once are required; brand-new ones wait for Review.
    const required = store.dueCards(now, { excludeNew: true, limit: MAX_REQUIRED }).map((d) => d.expression);
    const wanted = required.map((e) => normalizeExpression(e.text));

    const { value } = await generateStructured(provider, {
      system: renderTemplate(
        this.deps.challengeTemplate,
        challengePromptVars({ learner, category, required, recentSummaries: recent.map((c) => c.summary) }),
      ),
      user: 'Write the challenge now.',
      schema: ChallengeSchema,
      schemaName: 'challenge',
      signal,
      onProgress,
      refine: (payload) => {
        if (payload.category !== category) return `category must be "${category}"`;
        const got = payload.required_expressions.map((r) => normalizeExpression(r.expression));
        const sameSet = got.length === wanted.length && wanted.every((w) => got.includes(w));
        if (!sameSet) {
          return `required_expressions must be exactly: ${wanted.length ? wanted.map((w) => `"${w}"`).join(', ') : 'an empty list'}`;
        }
        return null;
      },
    });

    const hintFor = (text: string) =>
      value.required_expressions.find((r) => normalizeExpression(r.expression) === normalizeExpression(text))!.hint;
    return store.saveChallenge(
      {
        category: value.category,
        situation: value.situation,
        interlocutor: value.interlocutor,
        task: value.task,
        summary: value.summary,
        required: required.map((e) => ({ expressionId: e.id, hint: hintFor(e.text) })),
      },
      now,
    );
  }
}
