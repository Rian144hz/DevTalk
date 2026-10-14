import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { LLMError } from '../../core/llm/errors';
import type { LLMProvider, LLMRequest } from '../../core/llm/provider';

export type Effort = 'low' | 'medium' | 'high';

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_TOKENS = 16_000;

export function createAnthropicProvider(opts: {
  apiKey: string;
  model: string;
  effort?: Effort;
  /** Injectable for tests. */
  client?: Pick<Anthropic, 'beta'>;
}): LLMProvider {
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });
  const effort = opts.effort ?? 'medium';

  return {
    id: 'anthropic',
    model: opts.model,
    async generateJson(req: LLMRequest): Promise<string> {
      const { type, schema } = betaZodOutputFormat(req.schema);
      let message;
      try {
        message = await client.beta.messages.create(
          {
            model: opts.model,
            max_tokens: MAX_TOKENS,
            system: req.system,
            messages: [{ role: 'user', content: req.user }],
            output_config: { effort, format: { type, schema } },
            // Re-runs a wrongly refused request on a fallback model inside the same call.
            fallbacks: 'default',
            betas: [FALLBACK_BETA],
          },
          { signal: req.signal },
        );
      } catch (err) {
        throw toLLMError(err);
      }

      if (message.stop_reason === 'refusal') throw new LLMError('refusal', 'The model declined to answer this request.');
      if (message.stop_reason === 'max_tokens') throw new LLMError('truncated', 'The model reply was cut off.');
      const text = message.content.find((b) => b.type === 'text');
      if (!text || text.type !== 'text') throw new LLMError('invalid_output', 'The model reply had no text.');
      return text.text;
    },
  };
}

function toLLMError(err: unknown): LLMError {
  if (err instanceof LLMError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new LLMError('cancelled', 'Request cancelled', { cause: err });
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new LLMError('auth', 'Your API key was rejected.', { cause: err });
  }
  // Connection errors are APIError subclasses in the TS SDK, so they need no separate branch.
  return new LLMError('unavailable', 'The coach is unavailable right now.', { cause: err });
}
