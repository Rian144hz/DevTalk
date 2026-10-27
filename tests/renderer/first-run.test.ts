import {
  displayNameHint,
  firstRunStep,
  joinStepLabel,
  SIGN_IN_NOT_FINISHED,
  signInFailure,
  signInNotice,
  suggestedDisplayName,
  type FirstRunState,
} from '../../src/renderer/lib/first-run';
import { prepareSuggestedAvatar, type AvatarDeps } from '../../src/renderer/lib/image';
import { stackIconFor } from '../../src/renderer/lib/stack-icons';

const SIGNED_OUT: FirstRunState = { configured: true, signedIn: false, needsDocuments: false, hasProfile: false };
const NEEDS_DOCS: FirstRunState = { configured: true, signedIn: true, needsDocuments: true, hasProfile: false };
const NEEDS_PROFILE: FirstRunState = { configured: true, signedIn: true, needsDocuments: false, hasProfile: false };
const COMPLETE: FirstRunState = { configured: true, signedIn: true, needsDocuments: false, hasProfile: true };
const NOT_CONFIGURED: FirstRunState = { configured: false, signedIn: false, needsDocuments: false, hasProfile: false };

describe('firstRunStep', () => {
  test('nothing chosen yet: the welcome screen, signed in or not', () => {
    for (const s of [SIGNED_OUT, NEEDS_DOCS, COMPLETE, NOT_CONFIGURED]) expect(firstRunStep(s, 'none', false)).toBe('welcome');
  });

  test('a community that is not set up in this build only ever shows the welcome screen, whatever was chosen', () => {
    expect(firstRunStep(NOT_CONFIGURED, 'none', false)).toBe('welcome');
    expect(firstRunStep(NOT_CONFIGURED, 'github', false)).toBe('welcome');
    expect(firstRunStep(NOT_CONFIGURED, 'email', false)).toBe('welcome');
  });

  test('practising without an account goes to the coach setup, signed in or not', () => {
    for (const s of [SIGNED_OUT, NEEDS_DOCS, COMPLETE, NOT_CONFIGURED]) expect(firstRunStep(s, 'local', false)).toBe('coach');
  });

  test('e-mail: the join steps from the e-mail field on', () => {
    expect(firstRunStep(SIGNED_OUT, 'email', false)).toBe('join');
    expect(firstRunStep(NEEDS_DOCS, 'email', false)).toBe('join');
    expect(firstRunStep(NEEDS_PROFILE, 'email', false)).toBe('join');
  });

  test('GitHub: still waiting in the browser means the welcome screen stays', () => {
    expect(firstRunStep(SIGNED_OUT, 'github', false)).toBe('welcome');
  });

  test('GitHub signed in: the rules first, then the profile', () => {
    expect(firstRunStep(NEEDS_DOCS, 'github', false)).toBe('join');
    expect(firstRunStep(NEEDS_PROFILE, 'github', false)).toBe('join');
  });

  test('signed in with the documents accepted and a profile: straight to the coach setup', () => {
    expect(firstRunStep(COMPLETE, 'github', false)).toBe('coach');
    expect(firstRunStep(COMPLETE, 'email', false)).toBe('coach');
  });

  test('the coach set up ends the first run, whatever came before', () => {
    for (const choice of ['none', 'github', 'email', 'local'] as const) {
      for (const s of [SIGNED_OUT, NEEDS_DOCS, COMPLETE, NOT_CONFIGURED]) expect(firstRunStep(s, choice, true)).toBe('done');
    }
  });
});

describe('signInNotice', () => {
  test("the member's own Cancel returns to the buttons without a banner", () => {
    expect(signInNotice({ kind: 'internal', message: SIGN_IN_NOT_FINISHED }, true)).toBeNull();
  });

  test('the same message without a Cancel (the five minutes ran out) is shown', () => {
    expect(signInNotice({ kind: 'internal', message: SIGN_IN_NOT_FINISHED }, false)).toBe('Sign-in was not finished. Try again.');
  });

  test('any other failure is shown as the main process worded it, even after a Cancel', () => {
    const busy = 'Could not start GitHub sign-in. Close other apps that use ports 53682–53684 and try again.';
    expect(signInNotice({ kind: 'internal', message: busy }, false)).toBe(busy);
    expect(signInNotice({ kind: 'internal', message: busy }, true)).toBe(busy);
    expect(signInNotice({ kind: 'offline', message: 'You are offline.' }, true)).toBe('You are offline.');
    expect(signInNotice({ kind: 'offline', message: SIGN_IN_NOT_FINISHED }, true)).toBe(SIGN_IN_NOT_FINISHED);
  });
});

describe('joinStepLabel', () => {
  test('the e-mail way has four steps: e-mail, code, rules, profile', () => {
    expect([1, 2, 3, 4].map((n) => joinStepLabel(n as 1 | 2 | 3 | 4, false))).toEqual(['Step 1 of 4', 'Step 2 of 4', 'Step 3 of 4', 'Step 4 of 4']);
  });

  test('GitHub has no code step: the rules are step 2 of 3 and the profile step 3 of 3', () => {
    expect(joinStepLabel(3, true)).toBe('Step 2 of 3');
    expect(joinStepLabel(4, true)).toBe('Step 3 of 3');
  });

  test('before the person has signed in the way is not known yet, so the count stays at four', () => {
    expect(joinStepLabel(1, true)).toBe('Step 1 of 4');
    expect(joinStepLabel(2, true)).toBe('Step 2 of 4');
  });
});

describe('signInFailure', () => {
  test('a sign-in that was not finished already says what failed: that sentence alone', () => {
    expect(signInFailure(SIGN_IN_NOT_FINISHED)).toEqual({ title: 'Sign-in was not finished. Try again.' });
  });

  test('any other message becomes the detail under a title that says what failed', () => {
    expect(signInFailure('You are offline.')).toEqual({ title: 'Sign-in was not finished.', detail: 'You are offline.' });
    expect(signInFailure('Something went wrong. Try again.')).toEqual({ title: 'Sign-in was not finished.', detail: 'Something went wrong. Try again.' });
  });
});

describe('displayNameHint', () => {
  test('says where the name comes from while the field still holds the GitHub name', () => {
    expect(displayNameHint('Octo Dev', 'Octo Dev')).toBe('From your GitHub account. How other members see you.');
  });

  test('goes back to the plain hint once the name is changed', () => {
    expect(displayNameHint('Octavia', 'Octo Dev')).toBe('How other members see you.');
    expect(displayNameHint('Octo Dev ', 'Octo Dev')).toBe('How other members see you.');
  });

  test('has nothing to say about a name nobody suggested (e-mail, or an empty suggestion)', () => {
    expect(displayNameHint('Rian', null)).toBe('How other members see you.');
    expect(displayNameHint('', '')).toBe('How other members see you.');
  });
});

describe('suggestedDisplayName', () => {
  test('keeps a normal name and trims the edges', () => {
    expect(suggestedDisplayName('  Octo Dev ')).toBe('Octo Dev');
  });

  test('nothing to suggest gives an empty field', () => {
    expect(suggestedDisplayName(null)).toBe('');
    expect(suggestedDisplayName('   ')).toBe('');
  });

  test('stops at the 40 characters the profile allows', () => {
    const long = 'A'.repeat(60);
    expect(suggestedDisplayName(long)).toHaveLength(40);
  });
});

describe('prepareSuggestedAvatar', () => {
  const PNG_B64 = 'iVBORw0KGgo=';
  const deps = (out: Uint8Array): AvatarDeps => ({
    decode: async () => ({ width: 64, height: 32 }),
    encode: async () => out,
  });

  test('turns the data URL into the same prepared WebP as a picked file', async () => {
    const webp = new Uint8Array([1, 2, 3]);
    expect(await prepareSuggestedAvatar(`data:image/png;base64,${PNG_B64}`, deps(webp))).toEqual(webp);
  });

  test('is null for anything that is not an accepted image data URL', async () => {
    const webp = new Uint8Array([1]);
    expect(await prepareSuggestedAvatar('https://avatars.githubusercontent.com/u/1', deps(webp))).toBeNull();
    expect(await prepareSuggestedAvatar(`data:image/gif;base64,${PNG_B64}`, deps(webp))).toBeNull();
    expect(await prepareSuggestedAvatar('data:image/png;base64,%%%', deps(webp))).toBeNull();
  });

  test('is null when the image cannot be decoded or stays too big', async () => {
    const broken: AvatarDeps = { decode: async () => { throw new Error('bad'); }, encode: async () => new Uint8Array() };
    expect(await prepareSuggestedAvatar(`data:image/png;base64,${PNG_B64}`, broken)).toBeNull();
    const big = new Uint8Array(300 * 1024);
    expect(await prepareSuggestedAvatar(`data:image/png;base64,${PNG_B64}`, deps(big))).toBeNull();
  });
});

test('the GitHub mark comes from Simple Icons', () => {
  const icon = stackIconFor('github');
  expect(icon?.title).toBe('GitHub');
  expect(icon?.path).toMatch(/^M12 \.297/);
});
