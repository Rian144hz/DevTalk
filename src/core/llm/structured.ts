import type { z } from 'zod';
import { LLMError } from './errors';
import type { LLMProvider } from './provider';

export type ProgressStage = 'sending' | 'waiting' | 'validating' | 'retrying';

export interface StructuredArgs<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  schemaName: string;
  signal: AbortSignal;
  /** Semantic check after schema validation; returns an error message or null. */
  refine?: (value: T) => string | null;
  onProgress?: (stage: ProgressStage) => void;
}

const MAX_ATTEMPTS = 2;

/** Calls the provider and validates the JSON with zod, retrying once on invalid output. */
export async function generateStructured<T>(
  provider: LLMProvider,
  args: StructuredArgs<T>,
): Promise<{ value: T; raw: string; attempts: 1 | 2 }> {
  let user = args.user;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (args.signal.aborted) throw new LLMError('cancelled', 'Request cancelled');
    args.onProgress?.('sending');
    const pending = provider.generateJson({
      system: args.system,
      user,
      schema: args.schema,
      schemaName: args.schemaName,
      signal: args.signal,
    });
    args.onProgress?.('waiting');
    const raw = await pending;
    if (args.signal.aborted) throw new LLMError('cancelled', 'Request cancelled');

    args.onProgress?.('validating');
    const result = validate(raw, args.schema, args.refine);
    if (result.ok) return { value: result.value, raw, attempts: attempt as 1 | 2 };

    if (attempt === MAX_ATTEMPTS) {
      throw new LLMError('invalid_output', `The model returned invalid output twice: ${result.error}`);
    }
    args.onProgress?.('retrying');
    user = `${args.user}\n\nYour previous reply was invalid: ${result.error}. Reply again with only valid JSON for the schema.`;
  }
  throw new Error('unreachable');
}

function validate<T>(
  raw: string,
  schema: z.ZodType<T>,
  refine?: (value: T) => string | null,
): { ok: true; value: T } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'not valid JSON' };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const summary = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return { ok: false, error: summary };
  }
  const problem = refine?.(parsed.data);
  return problem ? { ok: false, error: problem } : { ok: true, value: parsed.data };
}
