import { CHECK_TYPE_LABELS } from '../../core/check/types';
import { LLMError } from '../../core/llm/errors';
import type { LLMProvider, LLMRequest } from '../../core/llm/provider';

// Offline provider for UI work and e2e screenshots (DEVTALK_FAKE_LLM=1, never in packaged builds).
// It reads what the prompts ask for, so its replies always pass the core's validation.

const EXPRESSIONS = [
  { expression: 'track down', type: 'phrasal_verb', meaning: 'encontrar algo depois de procurar', example: 'It took me a day to track down the memory leak.' },
  { expression: 'root cause', type: 'collocation', meaning: 'a causa principal de um problema', example: 'The root cause was a missing index.' },
  { expression: 'on my plate', type: 'chunk', meaning: 'tarefas que estão comigo agora', example: 'I have the migration on my plate this week.' },
  { expression: 'push back on', type: 'phrasal_verb', meaning: 'discordar ou resistir a uma proposta', example: 'I would push back on adding another cache layer.' },
  { expression: 'roll out', type: 'phrasal_verb', meaning: 'lançar aos poucos', example: 'We will roll out the feature to 10% of users first.' },
  { expression: 'trade-off', type: 'collocation', meaning: 'uma escolha com prós e contras', example: 'The trade-off is more memory for fewer queries.' },
] as const;

const SITUATIONS: Record<string, { situation: string; interlocutor: string; task: string; summary: string }> = {
  daily_update: {
    situation: 'Yesterday you spent most of the day on a flaky integration test in the payments service. The test passes locally but fails about one in five runs on CI.',
    interlocutor: 'Your team in the morning stand-up, led by Maya, the engineering manager',
    task: 'Give your stand-up update: what you did, what you will do today, and what is blocking you.',
    summary: 'flaky payments integration test',
  },
  code_review: {
    situation: 'A teammate opened a PR that adds a Redis cache in front of the user profile endpoint. You think the endpoint is already fast and the cache adds invalidation risk.',
    interlocutor: 'Leo, a mid-level backend developer who wrote the PR',
    task: 'Write a review comment that disagrees politely and suggests an alternative.',
    summary: 'disagree with redis cache in PR',
  },
  bug_explanation: {
    situation: 'Users in Brazil saw orders dated one day early. You found that the API stored local dates as UTC midnight and the frontend converted them again.',
    interlocutor: 'Priya, the product manager who reported the bug',
    task: 'Explain what caused the bug and how you fixed it, without heavy jargon.',
    summary: 'orders dated one day early',
  },
  tech_interview: {
    situation: 'You are in a technical interview for a backend role. The interviewer asks about a project where things went wrong.',
    interlocutor: 'Daniel, a senior engineer interviewing you',
    task: 'Answer "Tell me about a hard project you worked on" in 3 to 5 sentences.',
    summary: 'interview hard project question',
  },
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new LLMError('cancelled', 'Request cancelled'));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new LLMError('cancelled', 'Request cancelled'));
    }, { once: true });
  });
}

export function createFixtureProvider(opts: { delayMs?: number } = {}): LLMProvider {
  let turn = 0;
  return {
    id: 'fake',
    model: 'fixtures',
    async generateJson(req: LLMRequest): Promise<string> {
      if (opts.delayMs) await sleep(opts.delayMs, req.signal);
      if (req.signal.aborted) throw new LLMError('cancelled', 'Request cancelled');
      turn++;
      // e2e switch: an answer or a text that mentions a "rate limit" behaves like a provider that hit its quota.
      if ((req.schemaName === 'feedback' || req.schemaName === 'check') && /rate limit/i.test(req.user)) {
        throw new LLMError('rate_limited', 'Fixture rate limit');
      }
      if (req.schemaName === 'challenge') return challengeReply(req);
      return req.schemaName === 'check' ? checkReply(req, turn) : feedbackReply(req, turn);
    },
  };
}

function challengeReply(req: LLMRequest): string {
  const category = /for the category "(\w+)"/.exec(req.system)?.[1] ?? 'daily_update';
  const required = [...req.system.matchAll(/^- (.+?) \((?:chunk|phrasal_verb|collocation)\):/gm)].map((m) => m[1]!);
  return JSON.stringify({
    category,
    ...(SITUATIONS[category] ?? SITUATIONS['daily_update']!),
    required_expressions: required.map((expression) => ({ expression, hint: `Use "${expression}" when you describe the main problem.` })),
  });
}

/** Opens the way the type of text does: a greeting in a chat, a letter in an e-mail, none elsewhere. */
const CHECK_OPENINGS: Record<string, string> = {
  [CHECK_TYPE_LABELS.slack]: 'Hey team, yesterday',
  [CHECK_TYPE_LABELS.email]: 'Hello Maya, yesterday',
};

function checkReply(req: LLMRequest, turn: number): string {
  const type = /^Text type: (.*)$/m.exec(req.user)?.[1] ?? '';
  const first = (turn * 2) % EXPRESSIONS.length;
  return JSON.stringify({
    corrections: [
      { original: 'have fixed', corrected: 'fixed', explanation: 'Com "yesterday" usamos o passado simples, não o present perfect.', category: 'verb_tense' },
      { original: 'discuss about', corrected: 'discuss', explanation: '"Discuss" não leva preposição.', category: 'prepositions' },
    ],
    natural_rewrite:
      `${CHECK_OPENINGS[type] ?? 'Yesterday'} I tracked down the root cause of the flaky test: two tests were sharing the same database row. I fixed it by giving each test its own fixture, and we need to discuss the shared data.`,
    new_expressions: [EXPRESSIONS[first]!, EXPRESSIONS[(first + 1) % EXPRESSIONS.length]!],
  });
}

function feedbackReply(req: LLMRequest, turn: number): string {
  const line = /^Required expressions: (.*)$/m.exec(req.user)?.[1] ?? 'none';
  const required = line === 'none' ? [] : line.split('; ');
  const first = (turn * 2) % EXPRESSIONS.length;
  return JSON.stringify({
    corrections: [
      { original: 'have fixed', corrected: 'fixed', explanation: 'Com "yesterday" usamos o passado simples, não o present perfect.', category: 'verb_tense' },
      { original: 'discuss about', corrected: 'discuss', explanation: '"Discuss" não leva preposição.', category: 'prepositions' },
    ],
    natural_rewrite:
      'Yesterday I tracked down the root cause of the flaky test: two tests were sharing the same database row. I fixed it by giving each test its own fixture. Today I want to roll out the fix to the other suites, and I am not blocked.',
    new_expressions: [EXPRESSIONS[first]!, EXPRESSIONS[(first + 1) % EXPRESSIONS.length]!],
    required_expressions_check: required.map((expression) => ({ expression, used: true, used_correctly: true, note: 'Natural and correct.' })),
  });
}
