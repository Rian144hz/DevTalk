/// <reference lib="dom" />
// "Play animated banners": a local preference (on unless turned off) that also yields to the system's
// reduce-motion setting.
import { useSyncExternalStore } from 'react';

const KEY = 'devtalk.playAnimations';
const CHANGED = 'devtalk:motion';
const REDUCE = '(prefers-reduced-motion: reduce)';

export interface MotionEnv {
  get(key: string): string | null;
  set(key: string, value: string): void;
  reducedMotion(): boolean;
}

const browserEnv: MotionEnv = {
  get: (k) => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
  reducedMotion: () => typeof matchMedia === 'function' && matchMedia(REDUCE).matches,
};

/** The person's choice in Settings, ignoring the system setting. */
export function playAnimationsSetting(env: MotionEnv = browserEnv): boolean {
  try {
    return env.get(KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Whether animated banners should move right now. */
export function playAnimations(env: MotionEnv = browserEnv): boolean {
  return playAnimationsSetting(env) && !env.reducedMotion();
}

export function setPlayAnimations(on: boolean, env: MotionEnv = browserEnv): void {
  try {
    env.set(KEY, on ? 'on' : 'off');
  } catch {
    // Storage can be unavailable; the banner then keeps the default.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void): () => void {
  const query = matchMedia(REDUCE);
  window.addEventListener(CHANGED, onChange);
  query.addEventListener('change', onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    query.removeEventListener('change', onChange);
  };
}

/** Live value of playAnimations(): follows Settings and the system setting. */
export const usePlayAnimations = () => useSyncExternalStore(subscribe, () => playAnimations());
/** Live value of the Settings choice alone. */
export const usePlayAnimationsSetting = () => useSyncExternalStore(subscribe, () => playAnimationsSetting());
