import { playAnimations, playAnimationsSetting, setPlayAnimations, type MotionEnv } from '../../src/renderer/lib/motion';

function env(stored: string | null, reduced = false): MotionEnv & { store: Map<string, string> } {
  const store = new Map<string, string>(stored === null ? [] : [['devtalk.playAnimations', stored]]);
  return { store, get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v), reducedMotion: () => reduced };
}

test('animations play by default', () => {
  expect(playAnimations(env(null))).toBe(true);
  expect(playAnimationsSetting(env(null))).toBe(true);
});

test('they stop when the setting is off or the system asks to reduce motion', () => {
  expect(playAnimations(env('off'))).toBe(false);
  expect(playAnimations(env(null, true))).toBe(false);
  expect(playAnimationsSetting(env(null, true))).toBe(true);
});

test('the setting is stored as on/off', () => {
  const e = env(null);
  setPlayAnimations(false, e);
  expect(e.store.get('devtalk.playAnimations')).toBe('off');
  expect(playAnimations(e)).toBe(false);
  setPlayAnimations(true, e);
  expect(playAnimations(e)).toBe(true);
});

test('storage that throws counts as the default', () => {
  const broken: MotionEnv = { get: () => { throw new Error('denied'); }, set: () => { throw new Error('denied'); }, reducedMotion: () => false };
  expect(playAnimations(broken)).toBe(true);
  expect(() => setPlayAnimations(false, broken)).not.toThrow();
});
