import { useEffect, useMemo, useState } from 'react';
import type { Result } from '../../shared/ipc-contract';
import { api, newRequestId } from './api';
import { createCoachRequestController, type CoachState } from './coachRequest';

/** React binding for one cancellable coach call; cancels on unmount. */
export function useCoachRequest<T>(cancel: (requestId: string) => Promise<unknown>) {
  const [state, setState] = useState<CoachState<T>>({ status: 'idle' });
  const controller = useMemo(
    () => createCoachRequestController<T>({ cancel: (id) => void cancel(id), now: Date.now, newId: newRequestId, onChange: setState }),
    // The cancel function is stable per call site.
    [],
  );
  useEffect(() => {
    const off = api().llm.onProgress((e) => controller.progress(e.requestId, e.stage));
    return () => {
      off();
      controller.dispose();
    };
  }, [controller]);
  return {
    state,
    run: (call: (requestId: string) => Promise<Result<T>>) => controller.run(call),
    cancel: () => controller.cancel(),
  };
}
