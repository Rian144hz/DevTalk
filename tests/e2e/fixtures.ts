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
}

/** Launches the built app with the fixture coach and the given data directory. */
export async function launchApp(o: LaunchOptions): Promise<ElectronApplication> {
  const env = { ...process.env, DEVTALK_FAKE_LLM: '1', DEVTALK_USER_DATA: o.dataDir, DEVTALK_TEST_KEYRING: o.keyring ?? 'plain' } as Record<string, string>;
  if (o.social) env['DEVTALK_FAKE_SOCIAL'] = o.social;
  if (o.socialFail) env['DEVTALK_FAKE_SOCIAL_FAIL'] = o.socialFail;
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
  /** The throwaway user-data directory of this test's app. */
  dataDir: string;
  app: ElectronApplication;
  page: Page;
}>({
  keyring: ['plain', { option: true }],
  social: ['', { option: true }],
  socialFail: ['', { option: true }],
  dataDir: async ({}, use) => {
    const dir = newDataDir();
    await use(dir);
    rmSync(dir, { recursive: true, force: true });
  },
  app: async ({ keyring, social, socialFail, dataDir }, use) => {
    const app = await launchApp({ dataDir, keyring, social, socialFail });
    await use(app);
    await app.close();
  },
  page: async ({ app }, use) => {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },
});

/** Emulates a window size; Wayland compositors ignore programmatic window resizes. */
export async function setSize(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
}

/** Completes onboarding with defaults (Portuguese, B1 → B2, Gemini) and a test key. */
export async function onboard(page: Page, key = 'test-key'): Promise<void> {
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('API key').fill(key);
  await page.getByRole('button', { name: 'Start practising' }).click();
  await page.getByRole('heading', { level: 1, name: 'Today' }).waitFor();
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
