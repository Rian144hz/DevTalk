import { LLMError } from './errors';
import type { LLMProvider, LLMRequest } from './provider';

type FakeResponse = string | ((req: LLMRequest) => string | Promise<string>);

/** Scripted provider for tests and offline UI work. Responses are consumed in order. */
export class FakeProvider implements LLMProvider {
  readonly id = 'fake' as const;
  readonly model = 'fake';
  readonly calls: LLMRequest[] = [];

  constructor(private readonly responses: FakeResponse[]) {}

  async generateJson(req: LLMRequest): Promise<string> {
    if (req.signal.aborted) throw new LLMError('cancelled', 'Request cancelled');
    this.calls.push(req);
    const next = this.responses.shift();
    if (next === undefined) throw new Error('FakeProvider: no response left');
    return typeof next === 'string' ? next : next(req);
  }
}
