import type { z } from 'zod';

export interface LLMRequest {
  system: string;
  user: string;
  schema: z.ZodType;
  schemaName: string;
  signal: AbortSignal;
}

export interface LLMProvider {
  readonly id: 'anthropic' | 'ollama' | 'fake';
  readonly model: string;
  /** Returns the raw model text; validation is the caller's job. */
  generateJson(req: LLMRequest): Promise<string>;
}
