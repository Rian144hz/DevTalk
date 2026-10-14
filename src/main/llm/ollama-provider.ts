import { z } from 'zod';
import { LLMError } from '../../core/llm/errors';
import type { LLMProvider, LLMRequest } from '../../core/llm/provider';

export const OLLAMA_URL = 'http://127.0.0.1:11434';
const NOT_RUNNING = 'Ollama is not running. Start it, then check again.';

/** zod → JSON Schema for Ollama's structured outputs (`format`), minus the `$schema` marker. */
function toFormat(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

/** A model running on this computer through Ollama's local HTTP API. No key, nothing leaves the machine. */
export function createOllamaProvider(opts: { model: string; baseUrl?: string; fetch?: typeof fetch }): LLMProvider {
  const http = opts.fetch ?? fetch;
  const baseUrl = opts.baseUrl ?? OLLAMA_URL;
  return {
    id: 'ollama',
    model: opts.model,
    async generateJson(req: LLMRequest): Promise<string> {
      let res: Response;
      try {
        res = await http(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: opts.model,
            stream: false,
            format: toFormat(req.schema),
            messages: [
              { role: 'system', content: req.system },
              { role: 'user', content: req.user },
            ],
            options: { temperature: 0.4 },
          }),
          signal: req.signal,
        });
      } catch (err) {
        if (req.signal.aborted) throw new LLMError('cancelled', 'Request cancelled', { cause: err });
        throw new LLMError('unavailable', NOT_RUNNING, { cause: err });
      }
      if (res.status === 404) {
        throw new LLMError('config', `Model not found. Run: ollama pull ${opts.model}`);
      }
      if (!res.ok) throw new LLMError('unavailable', `Ollama answered ${res.status}.`);
      const body = (await res.json()) as { message?: { content?: string } };
      const content = body.message?.content;
      if (!content) throw new LLMError('invalid_output', 'The model reply had no text.');
      return content;
    },
  };
}

/** Is Ollama running, and is the chosen model installed? */
export async function checkOllama(opts: { model: string; baseUrl?: string; fetch?: typeof fetch }): Promise<{ ok: boolean; detail: string }> {
  const http = opts.fetch ?? fetch;
  try {
    const res = await http(`${opts.baseUrl ?? OLLAMA_URL}/api/tags`);
    const body = (await res.json()) as { models?: { name: string }[] };
    const installed = (body.models ?? []).some((m) => m.name === opts.model);
    return installed
      ? { ok: true, detail: `Ollama is running. ${opts.model} is installed.` }
      : { ok: false, detail: `Ollama is running, but ${opts.model} is not installed. Run: ollama pull ${opts.model}` };
  } catch {
    return { ok: false, detail: NOT_RUNNING };
  }
}
