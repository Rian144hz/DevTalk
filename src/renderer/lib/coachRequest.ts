import type { ProgressStage } from '../../core/llm/structured';
import type { AppError, Result } from '../../shared/ipc-contract';

export type CoachState<T> =
  | { status: 'idle' }
  | { status: 'running'; requestId: string; stage: ProgressStage | null; startedAt: number }
  | { status: 'done'; data: T }
  | { status: 'error'; error: AppError };

/**
 * One cancellable coach call at a time. Starting a new call or leaving the screen cancels the
 * running one, and a result that arrives for a cancelled call is ignored.
 */
export function createCoachRequestController<T>(deps: {
  cancel(requestId: string): void;
  now(): number;
  newId(): string;
  onChange(state: CoachState<T>): void;
}) {
  let state: CoachState<T> = { status: 'idle' };
  const set = (next: CoachState<T>) => {
    state = next;
    deps.onChange(next);
  };
  const runningId = () => (state.status === 'running' ? state.requestId : null);

  function cancel() {
    const id = runningId();
    if (!id) return;
    deps.cancel(id);
    set({ status: 'idle' });
  }

  return {
    get state() {
      return state;
    },
    run(call: (requestId: string) => Promise<Result<T>>) {
      cancel();
      const requestId = deps.newId();
      set({ status: 'running', requestId, stage: null, startedAt: deps.now() });
      void call(requestId).then(
        (result) => {
          if (runningId() !== requestId) return;
          if (result.ok) set({ status: 'done', data: result.data });
          else if (result.error.kind === 'cancelled') set({ status: 'idle' });
          else set({ status: 'error', error: result.error });
        },
        () => {
          if (runningId() === requestId) set({ status: 'error', error: { kind: 'internal', message: 'Something went wrong. Try again.' } });
        },
      );
    },
    progress(requestId: string, stage: ProgressStage) {
      if (state.status === 'running' && state.requestId === requestId) set({ ...state, stage });
    },
    cancel,
    /** Back to idle after a finished or failed call (a running call is cancelled first). */
    reset() {
      cancel();
      if (state.status !== 'idle') set({ status: 'idle' });
    },
    dispose: cancel,
  };
}
