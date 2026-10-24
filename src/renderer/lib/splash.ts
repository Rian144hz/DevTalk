// The launch splash: how long it stays and which keys skip it. Splash.tsx and its CSS read these values.

export interface SplashTiming {
  /** How long the splash is fully shown (its animation plays inside this time). */
  showMs: number;
  /** The fade-out after it; the next screen appears when it ends. */
  fadeMs: number;
}

/** 1.5 s plus a 0.25 s fade; with reduced motion, the still name for 0.3 s and no fade. */
export function splashTiming(reducedMotion: boolean): SplashTiming {
  return reducedMotion ? { showMs: 300, fadeMs: 0 } : { showMs: 1500, fadeMs: 250 };
}

/** Enter, Space and Escape skip the splash (so does a click). */
export const isSkipKey = (key: string): boolean => key === 'Enter' || key === ' ' || key === 'Escape';
