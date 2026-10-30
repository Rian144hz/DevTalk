// The launch splash: on every start, over everything, gone by itself or at once on a click or a key.
import type { Page } from '@playwright/test';
import { rmSync } from 'node:fs';
import { expect, launchApp, newDataDir, onboard, test } from './fixtures';

const splash = (page: Page) => page.getByRole('img', { name: 'DevTalk', exact: true });
/** The first screen of a first run, after the splash. */
const firstRun = (page: Page) => page.getByRole('heading', { level: 1, name: 'Practise the English you use at work.' });
const today = (page: Page) => page.getByRole('heading', { level: 1, name: 'Today' });
const running = (page: Page) => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
/** The duck on the splash. */
const duck = (page: Page) => page.locator('.splash svg.duck-mark');
/** Holds every animation on the page at `ms` after its start, so a picture or a measure does not depend on timing. */
const atTime = (page: Page, ms: number) =>
  page.evaluate((t) => {
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = t;
    }
  }, ms);

/**
 * Where the pieces of the lockup are on screen, in px. The name is set at 100 SVG units with its baseline at the start
 * position of its first letter, and Public Sans's capitals are 0.723 of that.
 */
const lockup = (page: Page) =>
  page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>('.splash-art')!;
    const text = svg.querySelector<SVGTextElement>('.splash-word')!;
    const ctm = text.getScreenCTM()!;
    const start = text.getStartPositionOfChar(0).matrixTransform(ctm);
    const at = (selector: string) => {
      const r = svg.querySelector(selector)!.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    return {
      cap: 72.3 * ctm.a,
      /** The right side bearing of the "k" in Public Sans Bold (1.74 units at size 100): the ink ends this far before the advance. */
      kBearing: 1.74 * ctm.a,
      start: { x: start.x, y: start.y },
      text: at('.splash-word'),
      /** The duck's 256-unit box (its drawing fills 188 of the 256 units in height). */
      boxSize: svg.querySelector<SVGSVGElement>('svg.duck-mark')!.width.baseVal.value * ctm.a,
      lead: at('.duck-lead'),
      hull: at('.duck-hull'),
      head: at('.duck-head'),
      window: { width: window.innerWidth, height: window.innerHeight },
    };
  });

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
  // The still lockup is the duck and "DevTalk", without the marks.
  await expect(duck(page)).toBeVisible();
  await expect(duck(page).locator('.duck-lead')).toHaveCount(1);
  await expect(page.locator('.splash-word')).toHaveText('DevTalk');
  await expect(page.locator('.splash-del, .splash-del-wash, .splash-strike, .splash-ins')).toHaveCount(0);
  await page.clock.runFor(250);
  await expect(splash(page)).toBeVisible();
  await page.clock.runFor(100);
  await expect(splash(page)).toBeHidden();
  await expect(firstRun(page)).toBeVisible();
});

test('the duck is on the splash and slides in from 24 units to the left, fading in over 180 ms from the start', async ({ page }) => {
  await reloadFrozen(page);
  await expect(duck(page)).toBeVisible();
  // The full cut: the pencil's wood and a separate lead.
  await expect(duck(page).locator('path')).toHaveCount(4);
  const slide = page.locator('.splash-duck');
  const state = async (ms: number) => {
    await atTime(page, ms);
    return slide.evaluate((el) => {
      const style = getComputedStyle(el);
      const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
      return { opacity: Number(style.opacity), x: matrix.m41 };
    });
  };
  expect(await state(0)).toEqual({ opacity: 0, x: -24 });
  const middle = await state(90);
  expect(middle.opacity).toBeGreaterThan(0);
  expect(middle.opacity).toBeLessThan(1);
  expect(middle.x).toBeGreaterThan(-24);
  expect(middle.x).toBeLessThan(0);
  expect(await state(180)).toEqual({ opacity: 1, x: 0 });
  expect(await state(1450)).toEqual({ opacity: 1, x: 0 });
});

test('the name is written from the duck\'s bill tip to its end, between 80 and 780 ms', async ({ page }) => {
  await reloadFrozen(page);
  /** How much of the name the wipe has uncovered, 0 to 1: the clip's right inset runs from 100 % to 0. */
  const written = async (ms: number) => {
    await atTime(page, ms);
    const inset = await page.locator('.splash-name').evaluate((el) => getComputedStyle(el).clipPath);
    const right = /^inset\(\S+ ([\d.]+)%/.exec(inset);
    expect(right, inset).not.toBeNull();
    return 1 - Number(right![1]) / 100;
  };
  expect(await written(0)).toBe(0);
  expect(await written(80)).toBe(0);
  const half = await written(430);
  expect(half).toBeGreaterThan(0.45);
  expect(half).toBeLessThan(0.55);
  expect(await written(780)).toBe(1);
  expect(await written(1450)).toBe(1);
  // It starts at the bill tip, which is left of the first letter: the wipe's box begins at the tip.
  const wipe = await page.locator('.splash-name').evaluate((el) => {
    const group = el as unknown as SVGGraphicsElement;
    const svg = group.ownerSVGElement!;
    const ctm = group.getScreenCTM()!;
    const bbox = group.getBBox();
    return { left: ctm.e + bbox.x * ctm.a, tip: svg.querySelector('.duck-lead')!.getBoundingClientRect().right };
  });
  expect(Math.abs(wipe.left - wipe.tip)).toBeLessThan(1);
});

for (const mode of ['full motion, at the end', 'reduced motion'] as const) {
  test(`the lockup is the official one: the bill tip just before the first letter, centred, the correction above (${mode})`, async ({ page }) => {
    if (mode === 'reduced motion') await page.emulateMedia({ reducedMotion: 'reduce' });
    await reloadFrozen(page);
    if (mode !== 'reduced motion') await atTime(page, 1450);
    const g = await lockup(page);
    const px = (n: number) => Math.round(n * 10) / 10;

    // The duck is about 2.38 capitals tall (its 256-unit box), and its bill tip is about 0.46 capitals before the first letter.
    expect(px(g.boxSize / g.cap), 'duck box in capitals').toBeGreaterThan(2.3);
    expect(px(g.boxSize / g.cap), 'duck box in capitals').toBeLessThan(2.46);
    const gap = (g.start.x - g.lead.right) / g.cap;
    expect(gap, 'tip to first letter, in capitals').toBeGreaterThan(0.42);
    expect(gap, 'tip to first letter, in capitals').toBeLessThan(0.5);
    // The duck's middle sits about 4 % of its height above the middle of the capitals.
    const capMiddle = g.start.y - g.cap / 2;
    const duckMiddle = (g.head.top + g.hull.bottom) / 2;
    const lift = (capMiddle - duckMiddle) / (g.hull.bottom - g.head.top);
    expect(lift, 'duck above the capitals middle').toBeGreaterThan(0.02);
    expect(lift, 'duck above the capitals middle').toBeLessThan(0.06);

    // Centred: the lockup runs from the duck's hull to the "k", and the capitals' middle is the middle of the window.
    const inkLeft = g.hull.left;
    const inkRight = g.text.right - g.kBearing;
    expect(Math.abs((inkLeft + inkRight) / 2 - g.window.width / 2), 'horizontal centre').toBeLessThan(2);
    expect(Math.abs(capMiddle - g.window.height / 2), 'vertical centre').toBeLessThan(2);
  });
}

test('the correction is still above the name, over the struck "d"', async ({ page }) => {
  await reloadFrozen(page);
  await atTime(page, 1450);
  const marks = await page.evaluate(() => {
    const at = (selector: string) => {
      const r = document.querySelector(selector)!.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    return { insWash: at('.splash-ins-wash'), delWash: at('.splash-del-wash'), strike: at('.splash-strike'), word: at('.splash-word') };
  });
  expect(marks.insWash.bottom).toBeLessThan(marks.delWash.top);
  const centre = (r: { left: number; right: number }) => (r.left + r.right) / 2;
  expect(Math.abs(centre(marks.insWash) - centre(marks.delWash))).toBeLessThan(1);
  expect(Math.abs(centre(marks.strike) - centre(marks.delWash))).toBeLessThan(1);
  // The marks stand over the first letter, the first thing after the duck.
  expect(marks.delWash.left).toBeGreaterThanOrEqual(marks.word.left - 3);
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
  await expect(splash(page)).toHaveCSS('background-color', 'rgb(245, 249, 255)');
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
    await expect(splash(page)).toHaveCSS('background-color', 'rgb(245, 249, 255)');
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
    for (const [name, ms] of [['duck', 40], ['mid', 420], ['marks', 1000], ['end', 1450]] as const) {
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
