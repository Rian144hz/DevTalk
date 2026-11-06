import type { ProgressStage } from '../../core/llm/structured';
import { AppFailure } from './handle';

/** The coach calls that can be cancelled by request id. Every handler group that calls the coach shares one. */
export interface InFlight {
  /** Runs a job that can be cancelled. The same id while it is running is refused as 'busy'; the id is free again afterwards. */
  run<T>(requestId: string, job: (signal: AbortSignal, onProgress: (s: ProgressStage) => void) => Promise<T>): Promise<T>;
  /** Aborts the job with this id; an id that is not running is ignored. */
  cancel(requestId: string): void;
}

export function createInFlight(emitProgress: (requestId: string, stage: ProgressStage) => void): InFlight {
  const running = new Map<string, AbortController>();
  return {
    async run(requestId, job) {
      if (running.has(requestId)) throw new AppFailure('busy');
      const controller = new AbortController();
      running.set(requestId, controller);
      try {
        return await job(controller.signal, (stage) => emitProgress(requestId, stage));
      } finally {
        running.delete(requestId);
      }
    },
    cancel(requestId) {
      running.get(requestId)?.abort();
    },
  };
}
