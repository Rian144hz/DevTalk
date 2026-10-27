// The launch splash: on every start, over everything, gone by itself or at once on a click or a key.
import type { Page } from '@playwright/test';
import { rmSync } from 'node:fs';
import { expect, launchApp, newDataDir, onboard, test } from './fixtures';

const splash = (page: Page) => page.getByRole('img', { name: 'DevTalk', exact: true });
const firstRun = (page: Page) => page.getByRole('heading', { level: 1, name: 'Set up your coach' });
const today = (page: Page) => page.getByRole('heading', { level: 1, name: 'Today' });
const running = (page: Page) => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);

/** Reloads with the page's timers frozen, so the splash stays until the test moves the clock or skips it. */
async function reloadFrozen(page: Page): Promise<void> {
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1000);
  await page.reload();
  await expect(splash(page)).toBeVisible();
}

test('the splash shows at launch, before the first screen, and goes by itself', async ({ app }) => {
  const page = await app.firstWindow();
  await expect(splash(page)).toBeVisible();
  const seen = Date.now();
  await expect(firstRun(page)).toHaveCount(0);
  await expect(splash(page)).toBeHidden({ timeout: 3000 });
  expect(Date.now() - seen).toBeGreaterThan(1000);
  await expect(firstRun(page)).toBeVisible();
});

test('it moves for 1.5 s, fades, and is gone at 1.75 s', async ({ page }) => {
  await reloadFrozen(page);
  expect(await running(page)).toBeGreaterThan(0);
  await page.clock.runFor(1700);
  await expect(splash(page)).toBeVisible();
  await page.clock.runFor(100);
  await expect(splash(page)).toBeHidden();
  await expect(firstRun(page)).toBeVisible();
});

test('a click skips it at once', async ({ page }) => {
  await reloadFrozen(page);
  await splash(page).click();
  await expect(splash(page)).toBeHidden({ timeout: 500 });
  await expect(firstRun(page)).toBeVisible();
});

for (const key of ['Enter', 'Space', 'Escape']) {
  test(`${key} skips it at once`, async ({ page }) => {
    await reloadFrozen(page);
    await page.keyboard.press(key);
    await expect(splash(page)).toBeHidden({ timeout: 500 });
    await expect(firstRun(page)).toBeVisible();
  });
}

test('other keys do not skip it', async ({ page }) => {
  await reloadFrozen(page);
  await page.keyboard.press('a');
  await page.keyboard.press('Tab');
  await expect(splash(page)).toBeVisible();
});

test('with reduced motion the name stands still for 0.3 s', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await reloadFrozen(page);
  expect(await running(page)).toBe(0);
  await page.clock.runFor(250);
  await expect(splash(page)).toBeVisible();
  await page.clock.runFor(100);
  await expect(splash(page)).toBeHidden();
  await expect(firstRun(page)).toBeVisible();
});

test('the first run follows the system theme from the first frame', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  // The theme must be set while <head> is still being read (no <body> yet): before anything can be painted.
  await page.addInitScript(() => {
    const seen = window as unknown as { themeFirstSet?: { theme: string; bodyExisted: boolean } };
    new MutationObserver(() => {
      const theme = document.documentElement.dataset['theme'];
      if (theme && !seen.themeFirstSet) seen.themeFirstSet = { theme, bodyExisted: document.body !== null };
    }).observe(document, { attributes: true, subtree: true });
  });
  await page.reload();
  await expect(splash(page)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { themeFirstSet?: unknown }).themeFirstSet)).toEqual({ theme: 'light', bodyExisted: false });
  await expect(splash(page)).toHaveCSS('background-color', 'rgb(238, 240, 243)');
  await expect(firstRun(page)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('an app that is set up shows the splash on the next launch in its own theme, then Today', async () => {
  const dataDir = newDataDir();
  try {
    let app = await launchApp({ dataDir });
    let page = await app.firstWindow();
    await onboard(page);
    await page.keyboard.press('Control+k');
    await page.keyboard.type('Switch to light');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await app.close();

    app = await launchApp({ dataDir });
    page = await app.firstWindow();
    await expect(splash(page)).toBeVisible();
    await expect(splash(page)).toHaveCSS('background-color', 'rgb(238, 240, 243)');
    await expect(today(page)).toHaveCount(0);
    await expect(splash(page)).toBeHidden({ timeout: 3000 });
    await expect(today(page)).toBeVisible();
    await app.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test.describe('offline', () => {
  test.use({ social: 'people', socialFail: 'session,conversations,isModerator,listNotices,getOwnProfile,hasAcceptedCurrentDocuments,publishPracticeDays,subscribe' });
  test('the splash does not wait for the network', async ({ page }) => {
    await onboard(page);
    await page.reload();
    await expect(splash(page)).toBeVisible();
    await expect(splash(page)).toBeHidden({ timeout: 3000 });
    await expect(today(page)).toBeVisible();
  });
});

test('a failed data load still ends the splash, then offers to try again', async ({ app, page }) => {
  // Make the profile load fail from the main process, as a broken IPC handler would; keep the real one to put back.
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, unknown> })._invokeHandlers;
    (globalThis as unknown as { realProfileGet: unknown }).realProfileGet = handlers.get('profile:get');
    ipcMain.removeHandler('profile:get');
    ipcMain.handle('profile:get', () => ({ ok: false, error: { kind: 'internal', message: 'Something went wrong. Try again.' } }));
  });
  await page.reload();
  await expect(splash(page)).toBeVisible();
  await expect(splash(page)).toBeHidden({ timeout: 3000 });
  await expect(page.getByRole('alert')).toContainText('Could not load your data.');
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('profile:get');
    ipcMain.handle('profile:get', (globalThis as unknown as { realProfileGet: Parameters<typeof ipcMain.handle>[1] }).realProfileGet);
  });
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(firstRun(page)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('screenshots of the splash, mid-animation and at the end, in both themes', async ({ page }) => {
  test.skip(!process.env['DEVTALK_SPLASH_SHOTS'], 'set DEVTALK_SPLASH_SHOTS=1 to capture');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1000);
  for (const theme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.reload();
    await expect(splash(page)).toBeVisible();
    for (const [name, ms] of [['mid', 420], ['marks', 1000], ['end', 1450]] as const) {
      await page.evaluate((t) => {
        for (const a of document.getAnimations()) {
          a.pause();
          a.currentTime = t;
        }
      }, ms);
      await page.screenshot({ path: `.impeccable/review/splash-${theme}-${name}.png` });
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const theme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.reload();
    await expect(splash(page)).toBeVisible();
    await page.screenshot({ path: `.impeccable/review/splash-${theme}-still.png` });
  }
});
