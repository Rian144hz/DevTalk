export type LLMErrorKind =
  | 'no_key'
  | 'auth'
  /** The request itself was rejected (unknown model, unsupported option, no credit): retrying will not help. */
  | 'config'
  | 'unavailable'
  /** The provider's free or paid quota is used up for now. */
  | 'rate_limited'
  | 'invalid_output'
  | 'refusal'
  | 'truncated'
  | 'cancelled';

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
