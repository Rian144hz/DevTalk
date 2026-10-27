import { useEffect, useState } from 'react';
import { api } from './api';
import { suggestedDisplayName } from './first-run';
import { prepareSuggestedAvatar } from './image';
import { browserAvatarDeps } from './image-browser';

/** What GitHub suggests for the profile form: a name for the field, and a photo already prepared for upload. */
export interface Prefill {
  displayName: string;
  photo: Uint8Array | null;
}

const NOTHING: Prefill = { displayName: '', photo: null };
/** The main process stops its photo download after a few seconds; this keeps the form from ever waiting on it for long. */
const GIVE_UP_MS = 6000;

async function load(): Promise<Prefill> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answer = await Promise.race([
      api().social.githubSuggestion(),
      new Promise<null>((resolve) => void (timer = setTimeout(() => resolve(null), GIVE_UP_MS))),
    ]);
    if (!answer || !answer.ok) return NOTHING;
    const { displayName, avatarDataUrl } = answer.data;
    const photo = avatarDataUrl ? await prepareSuggestedAvatar(avatarDataUrl, browserAvatarDeps) : null;
    return { displayName: suggestedDisplayName(displayName), photo };
  } catch {
    // The suggestion is a convenience: any failure just leaves the form empty.
    return NOTHING;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The GitHub suggestion for the profile step, or null while it loads. The main process answers with nothing unless
 * the account has a GitHub identity, so an e-mail member gets an empty form. Nothing is uploaded here.
 */
export function useGitHubPrefill(active: boolean): Prefill | null {
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  useEffect(() => {
    if (!active) {
      setPrefill(null);
      return;
    }
    let alive = true;
    void load().then((p) => alive && setPrefill(p));
    return () => {
      alive = false;
    };
  }, [active]);
  return prefill;
}
