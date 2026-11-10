// The daily challenge: the Home card, Start (the coach writes the day's challenge once) and Settings.
// The fixture coach writes the challenge; the day's theme is chosen without the coach. With an empty history and the
// fixture's tie-breaker (always the first) the theme of the first day is the stand-up.
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, launchApp, onboard, SAMPLE_ANSWER, test, waitForStart } from './fixtures';

const THEME = 'Stand-up update';
/** The fixture coach's stand-up challenge: its summary, capitalised, is the title of the challenge. */
const CHALLENGE_TITLE = 'Flaky payments integration test';
const NO_KEY = 'Add your API key in Settings to use the coach.';
const DONE_LINE = 'Done for today. Come back tomorrow.';

const card = (page: Page) => page.getByRole('region', { name: "Today's challenge" });
const writing = (page: Page) => page.getByRole('status').filter({ hasText: "The coach is writing today's challenge" });
const reminderTime = (page: Page) => page.getByLabel('Reminder time');
const dailySwitch = (page: Page) => page.getByRole('checkbox', { name: 'Daily challenge' });

test.beforeEach(async ({ page }) => {
  await onboard(page);
});

async function openSettings(page: Page) {
  // By the rail, not by a Ctrl+digit: the digits follow the menu, and the menu grows.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Daily challenge' })).toBeVisible();
}

async function openHome(page: Page) {
  await page.keyboard.press('Control+1');
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
}

/** Turns the daily challenge on in Settings and goes to Home, where the card is. */
async function turnOn(page: Page) {
  await openSettings(page);
  await dailySwitch(page).check();
  await expect(dailySwitch(page)).toBeChecked();
  await expect.poll(() => page.evaluate(async () => { const r = await window.devtalk.daily.settings(); return r.ok && r.data.enabled; })).toBe(true);
  await openHome(page);
  await expect(card(page)).toBeVisible();
}

/**
 * The next morning, for a window that stayed open: the main process's clock (`new Date()` and `Date.now()`) runs `ms` ahead
 * from now on. Nothing tells the window. Only in the test's own app, which closes with the test.
 */
async function advanceMainClock(app: ElectronApplication, ms: number) {
  await app.evaluate((_, offset) => {
    const RealDate = Date;
    globalThis.Date = new Proxy(RealDate, {
      construct: (target, args, newTarget) => (args.length === 0 ? new target(RealDate.now() + offset) : Reflect.construct(target, args, newTarget)),
      get: (target, prop, receiver) => (prop === 'now' ? () => RealDate.now() + offset : Reflect.get(target, prop, receiver)),
    });
  }, ms);
}

/** Starts the day's challenge, answers it and comes back to Home, where the card says the day is done. */
async function practiseToday(page: Page) {
  await card(page).getByRole('link', { name: 'Start' }).click();
  await expect(page.getByRole('textbox', { name: 'Your answer' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Your answer' }).fill(SAMPLE_ANSWER);
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.galley .line-text .mark-n').first()).toBeVisible();
  await openHome(page);
  await expect(card(page).getByText(DONE_LINE)).toBeVisible();
}

/** How many answers the history holds. */
const historyLength = (page: Page) =>
  page.evaluate(async () => {
    const r = await window.devtalk.progress.history({ before: null });
    return r.ok ? r.data.length : -1;
  });

/** The id of the challenge Practice would show now (the newest one with no answer). */
const pendingId = (page: Page) =>
  page.evaluate(async () => {
    const r = await window.devtalk.challenges.pending();
    return r.ok && r.data ? r.data.id : null;
  });

/** Counts the calls that reach a channel: the main process wraps its handler (dev and e2e builds only). */
async function countCalls(app: ElectronApplication, channel: string) {
  await app.evaluate(({ ipcMain }, name) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => Promise<unknown>> })._invokeHandlers;
    const real = handlers.get(name)!;
    const counts = ((globalThis as Record<string, unknown>)['__calls'] ??= {}) as Record<string, number>;
    counts[name] = 0;
    ipcMain.removeHandler(name);
    ipcMain.handle(name, (event, ...args) => {
      counts[name] = (counts[name] ?? 0) + 1;
      return real(event, ...args);
    });
  }, channel);
  return () => app.evaluate((_, name) => ((globalThis as Record<string, unknown>)['__calls'] as Record<string, number>)[name] ?? 0, channel);
}

test('off by default: no card on Home; Settings shows 19:00', async ({ page }) => {
  await openHome(page);
  // Home has finished loading, and no card came.
  await expect(page.getByText('Your first answer will appear here')).toBeVisible();
  await expect(page.getByRole('heading', { name: "Today's challenge" })).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.devtalk.daily.today())).toEqual({ ok: true, data: null });

  await openSettings(page);
  await expect(dailySwitch(page)).not.toBeChecked();
  await expect(page.getByText('One challenge a day, and a reminder at the time you choose.')).toBeVisible();
  await expect(reminderTime(page)).toHaveValue('19:00');
  await expect(reminderTime(page)).toHaveAttribute('type', 'time');
  expect(await page.evaluate(() => window.devtalk.daily.settings())).toEqual({ ok: true, data: { enabled: false, time: '19:00' } });
});

test('turning it on shows Today\'s challenge with the theme, "No streak yet" and Start', async ({ page }) => {
  await turnOn(page);
  await expect(card(page).getByRole('heading', { level: 2, name: "Today's challenge" })).toBeVisible();
  await expect(card(page).getByText(THEME)).toBeVisible();
  await expect(card(page).getByText('No streak yet')).toBeVisible();
  const start = card(page).getByRole('link', { name: 'Start' });
  await expect(start).toBeVisible();
  await expect(start).toHaveAttribute('href', '#/practice/daily');
  // The day's category is stored by the first look; the challenge itself is not written until Start.
  expect(await page.evaluate(() => window.devtalk.daily.today())).toMatchObject({
    ok: true, data: { category: 'daily_update', theme: THEME, streak: 0, practisedToday: false, challengeId: null },
  });
  expect(await pendingId(page)).toBeNull();

  // Off again: the card goes away (and the day's pick is kept for when it comes back).
  await openSettings(page);
  await dailySwitch(page).uncheck();
  await expect(page.getByText('Saved.')).toBeVisible();
  await openHome(page);
  await expect(page.getByText('Your first answer will appear here')).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});

test('Start writes the challenge once: Start again, and a restart of the app on the same data folder, give the same challenge and the same theme', async ({ app, page, dataDir }) => {
  const pendingCalls = await countCalls(app, 'challenges:pending');
  await turnOn(page);
  const before = await pendingCalls();

  await card(page).getByRole('link', { name: 'Start' }).click();
  await expect(page).toHaveURL(/#\/practice\/daily$/);
  await expect(page.getByRole('heading', { level: 1, name: "Today's challenge" })).toBeVisible();
  await expect(writing(page)).toBeVisible();
  // Practice stays marked in the rail while the challenge is written.
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Practice' })).toHaveAttribute('aria-current', 'page');
  // Then the challenge, ready to answer, on the plain Practice route.
  await expect(page.getByRole('heading', { level: 1, name: CHALLENGE_TITLE })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Your answer' })).toBeVisible();
  await expect(page).toHaveURL(/#\/practice$/);
  // The pending challenge was not read for it, neither while it was written nor afterwards.
  expect(await pendingCalls()).toBe(before);

  const first = await pendingId(page);
  expect(first).not.toBeNull();
  expect(await page.evaluate(() => window.devtalk.daily.today())).toMatchObject({ ok: true, data: { category: 'daily_update', challengeId: first } });

  // Home: the same theme (the stand-up is used now, so a new pick would have been another one). Start again: the same challenge.
  await openHome(page);
  await expect(card(page).getByText(THEME)).toBeVisible();
  await card(page).getByRole('link', { name: 'Start' }).click();
  await expect(page.getByRole('heading', { level: 1, name: CHALLENGE_TITLE })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Your answer' })).toBeVisible();
  expect(await pendingId(page)).toBe(first);

  // The app closed and opened again on the same data: the same theme, and Start gives the same challenge.
  await app.close();
  const again = await launchApp({ dataDir });
  try {
    const next = await again.firstWindow();
    await next.waitForLoadState('domcontentloaded');
    await waitForStart(next);
    await expect(next.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
    await expect(card(next).getByText(THEME)).toBeVisible();
    await card(next).getByRole('link', { name: 'Start' }).click();
    await expect(next.getByRole('heading', { level: 1, name: CHALLENGE_TITLE })).toBeVisible();
    await expect(next.getByRole('textbox', { name: 'Your answer' })).toBeVisible();
    expect(await pendingId(next)).toBe(first);
    expect(await next.evaluate(() => window.devtalk.daily.today())).toMatchObject({ ok: true, data: { category: 'daily_update', challengeId: first } });
  } finally {
    await again.close();
  }
});

test('one answer later the card says 1-day streak and "Done for today", with no Start', async ({ page }) => {
  await turnOn(page);
  await expect(card(page).getByText('No streak yet')).toBeVisible();
  // Before any practice the card offers Start and says nothing about being done.
  await expect(card(page).getByText(DONE_LINE)).toHaveCount(0);
  await card(page).getByRole('link', { name: 'Start' }).click();
  await expect(page.getByRole('textbox', { name: 'Your answer' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Your answer' }).fill(SAMPLE_ANSWER);
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.galley .line-text .mark-n').first()).toBeVisible();
  await expect(page).toHaveURL(/#\/feedback\/\d+$/);

  await openHome(page);
  await expect(card(page).getByText('1-day streak')).toBeVisible();
  await expect(card(page).getByText(THEME)).toBeVisible();
  // Done: the quiet line, and nothing left to press in the card (no Start, as a link or as a button).
  await expect(card(page).getByText(DONE_LINE)).toBeVisible();
  await expect(card(page).getByRole('link', { name: 'Start' })).toHaveCount(0);
  await expect(card(page).getByRole('button', { name: 'Start' })).toHaveCount(0);
  await expect(card(page).locator('a, button')).toHaveCount(0);
  await expect(card(page).getByRole('heading', { level: 2, name: "Today's challenge" })).toBeVisible();
  // The answer is on Home, right under the card.
  await expect(page.getByRole('heading', { name: 'Your last answer, marked by the coach' })).toBeVisible();
  expect(await page.evaluate(() => window.devtalk.daily.today())).toMatchObject({ ok: true, data: { streak: 1, practisedToday: true } });
  // The day keeps its one challenge: it was written once, and answering it did not make another.
  const id = await page.evaluate(async () => { const r = await window.devtalk.daily.today(); return r.ok && r.data ? r.data.challengeId : null; });
  expect(id).not.toBeNull();
});

test('a review is practice too: the card says done', async ({ page }) => {
  await turnOn(page);
  await expect(card(page).getByRole('link', { name: 'Start' })).toBeVisible();
  // One expression in Review, rated once: a review, with no answer at all.
  await page.evaluate(() => window.devtalk.review.keep({ text: 'track down', type: 'phrasal_verb', meaning: 'find', example: 'We track down bugs.' }));
  const expressionId = await page.evaluate(async () => { const q = await window.devtalk.review.queue(); return q.ok ? (q.data.items[0]?.expression.id ?? null) : null; });
  expect(expressionId).not.toBeNull();
  await page.evaluate((id) => window.devtalk.review.rate({ expressionId: id!, rating: 'good' }), expressionId);
  expect(await historyLength(page)).toBe(0);

  await openSettings(page);
  await openHome(page);
  await expect(card(page).getByText('1-day streak')).toBeVisible();
  await expect(card(page).getByText(THEME)).toBeVisible();
  await expect(card(page).getByText(DONE_LINE)).toBeVisible();
  await expect(card(page).locator('a, button')).toHaveCount(0);
});

test('a checked text is not practice: the card still offers Start', async ({ page }) => {
  await turnOn(page);
  const checked = await page.evaluate((text) => window.devtalk.check.run({ requestId: 'daily-check', type: 'slack', text }), SAMPLE_ANSWER);
  expect(checked.ok).toBe(true);
  await openSettings(page);
  await openHome(page);
  await expect(card(page).getByText('No streak yet')).toBeVisible();
  await expect(card(page).getByRole('link', { name: 'Start' })).toBeVisible();
  await expect(card(page).getByText(DONE_LINE)).toHaveCount(0);
  expect(await page.evaluate(() => window.devtalk.daily.today())).toMatchObject({ ok: true, data: { streak: 0, practisedToday: false } });
});

test('the card is read again when the window gets the focus: after a night it is a new day', async ({ app, page }) => {
  await turnOn(page);
  await practiseToday(page);
  await expect(card(page).getByText(THEME)).toBeVisible();

  // The window stays open on Home overnight: the next morning is a new day for the main process, and nothing tells the window.
  await advanceMainClock(app, 24 * 3_600_000);
  expect(await page.evaluate(() => window.devtalk.daily.today())).toMatchObject({ ok: true, data: { practisedToday: false, streak: 1 } });
  // The person comes back to the window: the card is read again. A new day has no practice yet, a new theme, and Start.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(card(page).getByText(DONE_LINE)).toHaveCount(0);
  await expect(card(page).getByRole('link', { name: 'Start' })).toBeVisible();
  await expect(card(page).getByText('1-day streak')).toBeVisible();
  await expect(card(page).getByText('Code review')).toBeVisible();
  await expect(card(page).getByText(THEME)).toHaveCount(0);
  // Nothing flashed away on the way: it is the same card, and Start leads to the new day's challenge.
  await card(page).getByRole('link', { name: 'Start' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Disagree with redis cache in PR' })).toBeVisible();
});

test('the card is read again when the window is shown again', async ({ page }) => {
  await turnOn(page);
  await expect(card(page).getByRole('link', { name: 'Start' })).toBeVisible();
  // The stored state changes behind the window's back (the challenge is turned off elsewhere).
  await page.evaluate(() => window.devtalk.daily.setSettings({ enabled: false }));
  await expect(card(page).getByText(THEME)).toBeVisible();
  // A window that is hidden reads nothing; shown again, it reads.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByText('Your first answer will appear here')).toBeVisible();
});

test('a window left open across midnight reads the card again by itself', async ({ app, page }) => {
  await turnOn(page);
  await practiseToday(page);
  const calls = await countCalls(app, 'daily:today');
  // The window's own clock says 23:59:50; Home is opened afresh on it, so the card arms its timer for midnight.
  const lateAtNight = new Date();
  lateAtNight.setHours(23, 59, 50, 0);
  await page.clock.install({ time: lateAtNight });
  await openSettings(page);
  await openHome(page);
  await expect(card(page).getByText(DONE_LINE)).toBeVisible();
  const before = await calls();
  // Main agrees it is the next morning, but nothing has told the window and midnight is ten seconds away on its clock.
  await advanceMainClock(app, 24 * 3_600_000);
  await page.waitForTimeout(500);
  expect(await calls()).toBe(before);
  await expect(card(page).getByText(DONE_LINE)).toBeVisible();
  // Midnight passes with the window open and focused (the computer's lid was closed for a minute): the timer fires, once.
  await page.clock.fastForward('01:00');
  await expect.poll(calls).toBeGreaterThan(before);
  await expect(card(page).getByText(DONE_LINE)).toHaveCount(0);
  await expect(card(page).getByRole('link', { name: 'Start' })).toBeVisible();
  await expect(card(page).getByText('Code review')).toBeVisible();
});

test('Back from the challenge goes to Home, not into the Start again', async ({ page }) => {
  await turnOn(page);
  await card(page).getByRole('link', { name: 'Start' }).click();
  await expect(page.getByRole('heading', { level: 1, name: CHALLENGE_TITLE })).toBeVisible();
  await expect(page).toHaveURL(/#\/practice$/);
  // The Start page took the place of the challenge's in the history, so Back is the page before it.
  await page.goBack();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await expect(card(page)).toBeVisible();
  // Forward is the challenge, the one that was written (nothing was written again).
  const id = await pendingId(page);
  await page.goForward();
  await expect(page).toHaveURL(/#\/practice$/);
  await expect(page.getByRole('heading', { level: 1, name: CHALLENGE_TITLE })).toBeVisible();
  expect(await pendingId(page)).toBe(id);
});

test('no key → "Add your API key in Settings to use the coach." with Open Settings', async ({ page }) => {
  await page.evaluate(() => window.devtalk.keys.clear('gemini'));
  await turnOn(page);
  await card(page).getByRole('link', { name: 'Start' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText(NO_KEY);
  await expect(page.getByRole('heading', { level: 1, name: "Today's challenge" })).toBeVisible();
  // The day keeps its theme and has no challenge yet.
  expect(await page.evaluate(() => window.devtalk.daily.today())).toMatchObject({ ok: true, data: { category: 'daily_update', challengeId: null } });

  await alert.getByRole('button', { name: 'Open Settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await page.getByLabel('API key').fill('test-key');
  await page.getByRole('button', { name: 'Save key' }).click();
  await expect(page.getByText('Key saved for Google Gemini')).toBeVisible();

  // With the key back, Start writes the day's challenge.
  await openHome(page);
  await card(page).getByRole('link', { name: 'Start' }).click();
  await expect(page.getByRole('heading', { level: 1, name: CHALLENGE_TITLE })).toBeVisible();
  expect(await pendingId(page)).not.toBeNull();
});

test('a limit error from the coach says so and Try again works', async ({ app, page }) => {
  await turnOn(page);
  // The coach is out of quota until the test says otherwise; then the real handler answers again.
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => Promise<unknown>> })._invokeHandlers;
    const real = handlers.get('daily:start')!;
    const state = globalThis as Record<string, unknown>;
    state['__outOfQuota'] = true;
    ipcMain.removeHandler('daily:start');
    ipcMain.handle('daily:start', (event, ...args) =>
      state['__outOfQuota']
        ? { ok: false, error: { kind: 'rate_limited', message: "You reached the provider's usage limit for now. Wait a minute and try again, or come back later today." } }
        : real(event, ...args));
  });
  await card(page).getByRole('link', { name: 'Start' }).click();
  await expect(page.getByRole('alert')).toContainText('usage limit');
  expect(await pendingId(page)).toBeNull();
  await app.evaluate(() => { (globalThis as Record<string, unknown>)['__outOfQuota'] = false; });
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { level: 1, name: CHALLENGE_TITLE })).toBeVisible();
});

test('Esc while the coach writes cancels and Start works again', async ({ page }) => {
  await turnOn(page);
  await card(page).getByRole('link', { name: 'Start' }).click();
  await expect(writing(page)).toBeVisible();
  await page.keyboard.press('Escape');
  // Cancelled: nothing is written, the screen does not ask again by itself and offers Start.
  await expect(writing(page)).toHaveCount(0);
  const start = page.getByRole('button', { name: 'Start' });
  await expect(start).toBeVisible();
  await expect(page).toHaveURL(/#\/practice\/daily$/);
  await page.waitForTimeout(1500); // longer than the fixture coach's delay: a cancelled call must not save a challenge
  expect(await pendingId(page)).toBeNull();
  expect(await page.evaluate(() => window.devtalk.daily.today())).toMatchObject({ ok: true, data: { challengeId: null } });
  await expect(writing(page)).toHaveCount(0);

  // Start works again at once, and the day gets one challenge.
  await start.click();
  await expect(writing(page)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: CHALLENGE_TITLE })).toBeVisible();
  const id = await pendingId(page);
  expect(id).not.toBeNull();
  expect(await page.evaluate(() => window.devtalk.daily.today())).toMatchObject({ ok: true, data: { challengeId: id } });
});

test('Esc and Start straight away, without a pause, writes one challenge', async ({ page }) => {
  await turnOn(page);
  await card(page).getByRole('link', { name: 'Start' }).click();
  await expect(writing(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('heading', { level: 1, name: CHALLENGE_TITLE })).toBeVisible();
  await page.waitForTimeout(1500);
  const id = await pendingId(page);
  expect(await page.evaluate(() => window.devtalk.daily.today())).toMatchObject({ ok: true, data: { challengeId: id } });
});

test('leaving the daily start for plain Practice shows Practice, not a loading screen, and a started call is cancelled', async ({ page }) => {
  await turnOn(page);
  await card(page).getByRole('link', { name: 'Start' }).click();
  await expect(writing(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
  // The Practice row in the rail: the same mounted screen is now plain Practice and reads the pending challenge (none).
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Practice' }).click();
  await expect(page).toHaveURL(/#\/practice$/);
  await expect(page.getByText('No challenge yet')).toBeVisible();

  // Leaving while the coach writes cancels it: no challenge appears later.
  await openHome(page);
  await card(page).getByRole('link', { name: 'Start' }).click();
  await expect(writing(page)).toBeVisible();
  await openHome(page);
  await page.waitForTimeout(1500);
  expect(await pendingId(page)).toBeNull();
});

test('the time is saved when it is a whole time, and an unfinished one goes back to the saved time', async ({ page }) => {
  await openSettings(page);
  await reminderTime(page).fill('08:30');
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.devtalk.daily.settings())).toEqual({ ok: true, data: { enabled: false, time: '08:30' } });

  // It is on disk: it is there after leaving Settings and coming back.
  await openHome(page);
  await openSettings(page);
  await expect(reminderTime(page)).toHaveValue('08:30');

  // Nothing in the field is no time: it is not saved, and leaving the field puts the saved time back.
  await reminderTime(page).fill('');
  await reminderTime(page).blur();
  await expect(reminderTime(page)).toHaveValue('08:30');
  expect(await page.evaluate(() => window.devtalk.daily.settings())).toEqual({ ok: true, data: { enabled: false, time: '08:30' } });

  // The edges of the day are times too; the main process refuses anything else.
  await reminderTime(page).fill('00:00');
  await expect.poll(() => page.evaluate(() => window.devtalk.daily.settings())).toEqual({ ok: true, data: { enabled: false, time: '00:00' } });
  await reminderTime(page).fill('23:59');
  await expect.poll(() => page.evaluate(() => window.devtalk.daily.settings())).toEqual({ ok: true, data: { enabled: false, time: '23:59' } });
  for (const time of ['24:00', '25:99', '7:30', '']) {
    expect(await page.evaluate((t) => window.devtalk.daily.setSettings({ time: t }), time), time).toMatchObject({ ok: false, error: { kind: 'validation' } });
  }
  expect(await page.evaluate(() => window.devtalk.daily.settings())).toEqual({ ok: true, data: { enabled: false, time: '23:59' } });
});

test('a settings change that cannot be saved is undone and says so', async ({ app, page }) => {
  await openSettings(page);
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('daily:setSettings');
    ipcMain.handle('daily:setSettings', () => ({ ok: false, error: { kind: 'internal', message: 'Something went wrong. Try again.' } }));
  });
  await dailySwitch(page).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong. Try again.' })).toBeVisible();
  await expect(dailySwitch(page)).not.toBeChecked();
  await reminderTime(page).fill('08:30');
  await expect(reminderTime(page)).toHaveValue('19:00');
  expect(await page.evaluate(() => window.devtalk.daily.settings())).toEqual({ ok: true, data: { enabled: false, time: '19:00' } });
});

test('a card that cannot load shows a quiet line and Try again, and the rest of Home is there', async ({ app, page }) => {
  await turnOn(page);
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => Promise<unknown>> })._invokeHandlers;
    (globalThis as Record<string, unknown>)['__realDailyToday'] = handlers.get('daily:today');
    ipcMain.removeHandler('daily:today');
    ipcMain.handle('daily:today', () => ({ ok: false, error: { kind: 'internal', message: 'Something went wrong. Try again.' } }));
  });
  await openSettings(page);
  await openHome(page);
  await expect(page.getByText("Could not load today's challenge.")).toBeVisible();
  // Home itself loaded: its own parts are there.
  await expect(page.getByText('Your first answer will appear here')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Due for review' })).toBeVisible();
  await expect(card(page)).toHaveCount(0);

  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('daily:today');
    ipcMain.handle('daily:today', (globalThis as Record<string, unknown>)['__realDailyToday'] as never);
  });
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(card(page).getByText(THEME)).toBeVisible();
  await expect(page.getByText("Could not load today's challenge.")).toHaveCount(0);
});
