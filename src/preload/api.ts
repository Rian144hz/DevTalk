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
      pending: () => call('challenges:pending'),
    },
    feedback: {
      submit: (input) => call('feedback:submit', input),
      cancel: (requestId) => call('feedback:cancel', { requestId }),
      get: (feedbackId) => call('feedback:get', { feedbackId }),
    },
    llm: { onProgress: (cb) => subscribe(PROGRESS_EVENT, cb) },
    review: { queue: () => call('review:queue'), rate: (input) => call('review:rate', input) },
    progress: { summary: () => call('progress:summary'), history: (input) => call('progress:history', input), graph: () => call('progress:graph') },
    settings: { get: () => call('settings:get'), set: (partial) => call('settings:set', partial) },
    llmCheck: () => call('llm:check'),
    social: {
      status: () => call('social:status'),
      sendCode: (email) => call('social:sendCode', { email }),
      verifyCode: (email, code) => call('social:verifyCode', { email, code }),
      acceptDocuments: () => call('social:acceptDocuments'),
      getProfile: () => call('social:getProfile'),
      saveProfile: (draft) => call('social:saveProfile', draft),
      setAvatar: (bytes) => call('social:setAvatar', { bytes }),
      removeAvatar: () => call('social:removeAvatar'),
      avatar: (userId) => call('social:avatar', { userId }),
      notices: () => call('social:notices'),
      readNotice: (id) => call('social:readNotice', { id }),
      signOut: () => call('social:signOut'),
      exportData: (includeLocal) => call('social:export', { includeLocal }),
      deleteAccount: (input) => call('social:deleteAccount', input),
      badges: (userId) => call('social:badges', { userId }),
      practiceGraph: (userId) => call('social:practiceGraph', { userId }),
      setBanner: (bytes) => call('social:setBanner', { bytes }),
      removeBanner: () => call('social:removeBanner'),
      banner: (userId) => call('social:banner', { userId }),
    },
    safety: {
      block: (userId) => call('safety:block', { userId }),
      unblock: (userId) => call('safety:unblock', { userId }),
      report: (input) => call('safety:report', input),
    },
    moderation: {
      isModerator: () => call('moderation:isModerator'),
      reports: () => call('moderation:reports'),
      history: (userId) => call('moderation:history', { userId }),
      decide: (decision) => call('moderation:decide', decision),
      searchMembers: (query) => call('moderation:searchMembers', { query }),
      grantBadge: (change) => call('moderation:grantBadge', change),
      revokeBadge: (change) => call('moderation:revokeBadge', change),
    },
  };
}
