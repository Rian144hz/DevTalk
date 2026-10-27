import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test';

export { expect } from '@playwright/test';

const ROOT = join(__dirname, '..', '..');

export interface LaunchOptions {
  dataDir: string;
  keyring?: 'plain' | 'unavailable';
  /** '1' = empty fake community, 'moderation' = seeded and signed in as a moderator. */
  social?: '' | '1' | 'moderation' | 'people';
  /** e.g. 'deleteAccount' or 'deleteAccount:offline' */
  socialFail?: string;
  /** Chromium's fake microphone (voice rooms without hardware). */
  fakeMedia?: boolean;
  /** How long a room peer may take to connect, in milliseconds (e.g. '3000'); empty keeps 20 s. */
  roomTimeoutMs?: string;
}

/** Launches the built app with the fixture coach and the given data directory. */
export async function launchApp(o: LaunchOptions): Promise<ElectronApplication> {
  const env = { ...process.env, DEVTALK_FAKE_LLM: '1', DEVTALK_USER_DATA: o.dataDir, DEVTALK_TEST_KEYRING: o.keyring ?? 'plain' } as Record<string, string>;
  if (o.social) env['DEVTALK_FAKE_SOCIAL'] = o.social;
  if (o.socialFail) env['DEVTALK_FAKE_SOCIAL_FAIL'] = o.socialFail;
  if (o.fakeMedia) env['DEVTALK_FAKE_MEDIA'] = '1';
  if (o.roomTimeoutMs) env['DEVTALK_ROOM_TIMEOUT_MS'] = o.roomTimeoutMs;
  delete env['ELECTRON_RUN_AS_NODE'];
  delete env['ELECTRON_RENDERER_URL'];
  return electron.launch({ args: ['.'], cwd: ROOT, env });
}

export const newDataDir = () => mkdtempSync(join(tmpdir(), 'devtalk-e2e-'));

/** Launches the built app with the fixture coach and a throwaway data directory. */
export const test = base.extend<{
  keyring: 'plain' | 'unavailable';
  social: '' | '1' | 'moderation' | 'people';
  socialFail: string;
  fakeMedia: boolean;
  roomTimeoutMs: string;
  /** The throwaway user-data directory of this test's app. */
  dataDir: string;
  app: ElectronApplication;
  page: Page;
}>({
  keyring: ['plain', { option: true }],
  social: ['', { option: true }],
  socialFail: ['', { option: true }],
  fakeMedia: [false, { option: true }],
  roomTimeoutMs: ['', { option: true }],
  dataDir: async ({}, use) => {
    const dir = newDataDir();
    await use(dir);
    rmSync(dir, { recursive: true, force: true });
  },
  app: async ({ keyring, social, socialFail, fakeMedia, roomTimeoutMs, dataDir }, use) => {
    const app = await launchApp({ dataDir, keyring, social, socialFail, fakeMedia, roomTimeoutMs });
    await use(app);
    await app.close();
  },
  page: async ({ app }, use) => {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await waitForStart(page);
    await use(page);
  },
});

/**
 * Waits until the launch splash is gone and a screen is shown (the splash runs on every start and reload).
 * The splash is the only thing in #root until it ends, so any other child means the app has started.
 */
export async function waitForStart(page: Page): Promise<void> {
  await page.locator('#root > :not(.splash)').first().waitFor({ state: 'attached', timeout: 15_000 });
}

/** Emulates a window size; Wayland compositors ignore programmatic window resizes. */
export async function setSize(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
}

/**
 * Leaves the first-run welcome screen with "Practise without an account", which opens the coach setup.
 * An app that already shows the coach setup (nothing to leave) is left as it is.
 */
export async function practiseWithoutAccount(page: Page): Promise<void> {
  await waitForStart(page);
  const local = page.getByRole('button', { name: 'Practise without an account' });
  const setup = page.getByRole('heading', { level: 1, name: 'Set up your coach' });
  await local.or(setup).first().waitFor();
  if (await local.isVisible()) await local.click();
  await setup.waitFor();
}

/** Completes onboarding with defaults (Portuguese, B1 → B2, Gemini) and a test key, starting from the first-run welcome. */
export async function onboard(page: Page, key = 'test-key'): Promise<void> {
  await practiseWithoutAccount(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('API key').fill(key);
  await page.getByRole('button', { name: 'Start practising' }).click();
  await page.getByRole('heading', { level: 1, name: 'Today' }).waitFor();
}

/**
 * Holds the next GitHub sign-in in the main process like a browser tab that is still open. Cancel ends the wait the
 * way the real listener does ('not-finished'), or lets a sign-in that was already exchanging finish ('signed-in').
 * `globalThis.__releaseSignIn` ends the wait without a Cancel, like the five minutes running out.
 */
export async function holdSignIn(app: ElectronApplication, onCancel: 'not-finished' | 'signed-in'): Promise<void> {
  await app.evaluate(({ ipcMain }, mode) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => Promise<unknown>> })._invokeHandlers;
    const real = handlers.get('social:signInWithGitHub')!;
    let open!: (outcome: 'not-finished' | 'signed-in') => void;
    const gate = new Promise<'not-finished' | 'signed-in'>((resolve) => { open = resolve; });
    ipcMain.removeHandler('social:signInWithGitHub');
    ipcMain.handle('social:signInWithGitHub', async (event, ...args) => {
      const outcome = await gate;
      return outcome === 'signed-in'
        ? real(event, ...args)
        : { ok: false, error: { kind: 'internal', message: 'Sign-in was not finished. Try again.' } };
    });
    ipcMain.removeHandler('social:cancelSignIn');
    ipcMain.handle('social:cancelSignIn', () => {
      open(mode);
      return { ok: true, data: null };
    });
    (globalThis as unknown as { __releaseSignIn: typeof open }).__releaseSignIn = open;
  }, onCancel);
}

/** An answer the fixture coach marks twice ("have fixed", "discuss about"). */
export const SAMPLE_ANSWER =
  'Yesterday I have fixed the flaky test in the payments service. We need to discuss about the shared database row. Today I will add a fixture per test.';

export const historyCount = (page: Page) =>
  page.evaluate(async () => {
    const r = await window.devtalk.progress.history({ before: null });
    return r.ok ? r.data.length : -1;
  });

/** Gets a challenge and answers it, so the fixture coach adds two new expressions. */
export async function answerOnce(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Get a challenge' }).click();
  await page.getByRole('button', { name: 'Write it' }).click();
  await page.getByRole('textbox', { name: 'Your answer' }).fill(SAMPLE_ANSWER);
  await page.keyboard.press('Control+Enter');
  await page.locator('.galley .line-text .mark-n').first().waitFor();
}

export const queueSize = (page: Page) =>
  page.evaluate(async () => {
    const r = await window.devtalk.review.queue();
    return r.ok ? r.data.items.length : -1;
  });

/** Signs up in the fake community: e-mail, code 123456, documents, then a profile named `name`. */
export async function joinCommunity(page: Page, name = 'Rian', email = 'rian@example.com'): Promise<void> {
  await page.evaluate(() => { location.hash = '#/join'; });
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Code').fill('123456');
  await page.getByRole('button', { name: 'Continue' }).click();
  for (const label of ['I accept the Terms of use', 'I accept the Privacy policy', 'I accept the Code of conduct', 'I am 18 or older']) {
    await page.getByRole('checkbox', { name: label }).check();
  }
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Join' }).click();
  await page.getByRole('heading', { level: 2, name }).waitFor();
}
