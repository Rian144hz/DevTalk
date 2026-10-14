import { ApiError, GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from '@google/genai';
import { z } from 'zod';
import { LLMError } from '../../core/llm/errors';
import type { LLMProvider, LLMRequest } from '../../core/llm/provider';

/** The slice of the SDK client this provider uses (injectable for tests). */
export interface GeminiClient {
  models: { generateContent(params: GenerateContentParameters): Promise<Pick<GenerateContentResponse, 'text' | 'candidates' | 'promptFeedback'>> };
}

const MAX_OUTPUT_TOKENS = 8192;
const REFUSAL_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION']);

export function createGeminiProvider(opts: { apiKey: string; model: string; client?: GeminiClient }): LLMProvider {
  const client: GeminiClient = opts.client ?? new GoogleGenAI({ apiKey: opts.apiKey });

  return {
    id: 'gemini',
    model: opts.model,
    async generateJson(req: LLMRequest): Promise<string> {
      let response;
      try {
        response = await client.models.generateContent({
          model: opts.model,
          contents: req.user,
          config: {
            systemInstruction: req.system,
            responseMimeType: 'application/json',
            responseJsonSchema: toGeminiSchema(req.schema),
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            abortSignal: req.signal,
          },
        });
      } catch (err) {
        throw toLLMError(err, req.signal);
      }

      if (response.promptFeedback?.blockReason) throw new LLMError('refusal', 'The model declined to answer this request.');
      const finish = response.candidates?.[0]?.finishReason;
      if (finish === 'MAX_TOKENS') throw new LLMError('truncated', 'The model reply was cut off.');
      if (finish && REFUSAL_REASONS.has(finish)) throw new LLMError('refusal', 'The model declined to answer this request.');
      const text = response.text;
      if (!text) throw new LLMError('invalid_output', 'The model reply had no text.');
      return text;
    },
  };
}

/** zod → JSON Schema, minus the `$schema` marker the API does not need. */
function toGeminiSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

function toLLMError(err: unknown, signal: AbortSignal): LLMError {
  if (err instanceof LLMError) return err;
  if (signal.aborted) return new LLMError('cancelled', 'Request cancelled', { cause: err });
  if (err instanceof ApiError) {
    if (err.status === 429) return new LLMError('rate_limited', err.message, { cause: err });
    // An invalid key comes back as 400 with this wording.
    if (err.status === 401 || err.status === 403 || (err.status === 400 && /api key/i.test(err.message))) {
      return new LLMError('auth', 'Your API key was rejected.', { cause: err });
    }
    if (err.status === 400 || err.status === 404) {
      return new LLMError('config', `The API rejected the request: ${err.message}`, { cause: err });
    }
  }
  return new LLMError('unavailable', 'The coach is unavailable right now.', { cause: err });
}
