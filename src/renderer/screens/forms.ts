import type { Level } from '../../core/domain/types';
import type { ProviderId } from '../../shared/providers';

export const LANGUAGE_OPTIONS = [
  'Portuguese (Brazil)', 'Portuguese (Portugal)', 'Spanish', 'French', 'German', 'Italian', 'Japanese', 'Chinese', 'Korean',
  'Russian', 'Turkish', 'Arabic', 'Hindi', 'Other',
].map((l) => ({ value: l, label: l }));

/** The list plus the saved value when it is not one of the presets. */
export const languageOptions = (current: string) =>
  LANGUAGE_OPTIONS.some((o) => o.value === current) ? LANGUAGE_OPTIONS : [{ value: current, label: current }, ...LANGUAGE_OPTIONS];

export const CURRENT_LEVELS: Level[] = ['A2', 'B1', 'B2', 'C1'];
export const TARGET_LEVELS: Level[] = ['B1', 'B2', 'C1', 'C2'];
const RANK: Record<Level, number> = { A2: 0, B1: 1, B2: 2, C1: 3, C2: 4 };
export const isTargetAbove = (current: Level, target: Level) => RANK[target] > RANK[current];
export const TARGET_ERROR = 'Your target must be above your current level.';

export const PROVIDER_OPTIONS: { value: ProviderId; label: string }[] = [
  { value: 'gemini', label: 'Gemini (free)' },
  { value: 'anthropic', label: 'Claude' },
  { value: 'ollama', label: 'Ollama (on this computer)' },
];

/** Where to create a key; Ollama runs locally and needs none. */
export const KEY_LINKS: Partial<Record<ProviderId, { href: string; label: string }>> = {
  gemini: { href: 'https://aistudio.google.com/apikey', label: 'Get a free key' },
  anthropic: { href: 'https://console.anthropic.com/settings/keys', label: 'Get a key' },
};
