// The live chat bridge: while a member is signed in, community changes reach the window as chat events.
import type { ChatLiveEvent } from '../../core/social/chat';
import type { SocialBackend } from './backend';

export type { ChatLiveEvent };

export interface ChatLive {
  /** (Re)subscribes for the current account; safe to call after any sign-in, sign-out or acceptance. Never throws. */
  start(): Promise<void>;
  stop(): void;
}

export function createChatLive(deps: { backend: SocialBackend; emit: (e: ChatLiveEvent) => void }): ChatLive {
  let unsubscribe: (() => void) | null = null;
  // Each start gets a number; a slower, older start never subscribes over a newer one.
  let generation = 0;

  const stop = () => {
    generation++;
    unsubscribe?.();
    unsubscribe = null;
  };

  return {
    async start() {
      stop();
      const mine = generation;
      try {
        const { backend } = deps;
        if (!backend.configured || !(await backend.session()) || !(await backend.hasAcceptedCurrentDocuments())) return;
        if (mine !== generation) return;
        let online: boolean | null = null;
        let open = true;
        const off = backend.subscribe(
          (e) => {
            if (open) deps.emit(e);
          },
          (now) => {
            if (!open || now === online) return;
            online = now;
            deps.emit({ kind: now ? 'online' : 'offline' });
          },
        );
        unsubscribe = () => {
          open = false;
          off();
        };
      } catch {
        // Offline or asleep: the next sign-in or app start tries again.
      }
    },
    stop,
  };
}
