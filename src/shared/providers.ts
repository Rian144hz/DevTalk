// LLM providers the app can use. No runtime dependencies (bundled into the preload too).
export const PROVIDERS = ['gemini', 'anthropic', 'ollama'] as const;
export type ProviderId = (typeof PROVIDERS)[number];

/** Gemini's free tier needs no credit card, so it is the default. */
export const DEFAULT_PROVIDER: ProviderId = 'gemini';

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  // A moving alias: always the latest Gemini Flash release.
  gemini: 'gemini-flash-latest',
  anthropic: 'claude-opus-5-5',
  ollama: 'qwen3:4b',
};

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: 'Google Gemini',
  anthropic: 'Anthropic Claude',
  ollama: 'Ollama (local)',
};
