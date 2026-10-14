import { PROGRESS_EVENT, type DevtalkApi, type InvokeChannel, type ProgressEvent, type Result } from '../shared/ipc-contract';

type Invoke = (channel: InvokeChannel, payload: unknown) => Promise<unknown>;
type Subscribe = (event: string, cb: (payload: ProgressEvent) => void) => () => void;

/** Pure mapping from the typed API to IPC channels; the preload only wires it to ipcRenderer. */
export function buildApi(invoke: Invoke, subscribe: Subscribe): DevtalkApi {
  // Main validates every payload and always answers with a Result for that channel.
  const call = (channel: InvokeChannel, payload: unknown = {}) => invoke(channel, payload) as Promise<Result<never>>;
  return {
    profile: { get: () => call('profile:get'), save: (p) => call('profile:save', p) },
    keys: {
      status: (provider) => call('keys:status', provider ? { provider } : {}),
      set: (key, provider) => call('keys:set', provider ? { key, provider } : { key }),
      clear: (provider) => call('keys:clear', provider ? { provider } : {}),
    },
    challenges: {
      next: (requestId) => call('challenges:next', { requestId }),
      cancel: (requestId) => call('challenges:cancel', { requestId }),
    },
    feedback: {
      submit: (input) => call('feedback:submit', input),
      cancel: (requestId) => call('feedback:cancel', { requestId }),
    },
    llm: { onProgress: (cb) => subscribe(PROGRESS_EVENT, cb) },
    review: { queue: () => call('review:queue'), rate: (input) => call('review:rate', input) },
    progress: { summary: () => call('progress:summary'), history: (input) => call('progress:history', input) },
    settings: { get: () => call('settings:get'), set: (partial) => call('settings:set', partial) },
  };
}
