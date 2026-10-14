export type LLMErrorKind = 'no_key' | 'auth' | 'unavailable' | 'invalid_output' | 'refusal' | 'truncated' | 'cancelled';

export class LLMError extends Error {
  constructor(
    readonly kind: LLMErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'LLMError';
  }
}
