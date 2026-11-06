// Check text: a real text corrected with the fixture coach; the local secret detector; nothing is saved.
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, historyCount, onboard, queueSize, SAMPLE_ANSWER, test, waitForStart } from './fixtures';

const MAIN_NAV = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const typeSelect = (page: Page) => page.getByLabel('What are you writing?');
const field = (page: Page) => page.getByRole('textbox', { name: 'Your text' });
/** The primary button; its name carries the key hint ("Check Ctrl Enter"). */
const checkButton = (page: Page, again = false) => page.getByRole('button', { name: new RegExp(`^Check${again ? ' again' : ''}\\s?Ctrl Enter$`) });
const reading = (page: Page) => page.getByRole('status').filter({ hasText: 'The coach is reading your text' });
/** The marked text of a result; each edit is a numbered mark in it. */
const marks = (page: Page) => page.getByRole('article', { name: 'Your text' }).locator('.line-text .mark-n');

const SECRET_MESSAGE = 'This looks like a password or key. Remove it before you check the text.';
const GEMINI_NOTE = 'Do not paste passwords, keys or private code. On the free Gemini plan, Google may use what you send to improve its models.';
/** The fixture coach marks "have fixed" and "discuss about" in this text: two edits. */
const TEXT = SAMPLE_ANSWER;

test.beforeEach(async ({ page }) => {
  await onboard(page);
});

async function openCheck(page: Page) {
  await page.keyboard.press('Control+3');
  await expect(page.getByRole('heading', { level: 1, name: 'Check' })).toBeVisible();
}

/** Picks the type, writes the text and presses Ctrl+Enter in the field. */
async function check(page: Page, type: string, text: string) {
  await typeSelect(page).selectOption({ label: type });
  await write(page, text);
  await page.keyboard.press('Control+Enter');
}

/**
 * Replaces the text in the field and checks that it took. Playwright's fill selects everything and then inserts; if the
 * window's focus changes between the two (it can, on a busy desktop) Chromium appends instead, so the step is retried.
 */
async function write(page: Page, text: string) {
  await expect(async () => {
    await field(page).fill(text);
    await expect(field(page)).toHaveValue(text, { timeout: 1000 });
  }).toPass();
}

/** Counts what reaches the coach: the main process wraps the check:run handler (dev and e2e builds only). */
async function countChecks(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => Promise<unknown>> })._invokeHandlers;
    const real = handlers.get('check:run')!;
    (globalThis as unknown as { __checkRuns: number }).__checkRuns = 0;
    ipcMain.removeHandler('check:run');
    ipcMain.handle('check:run', (event, ...args) => {
      (globalThis as unknown as { __checkRuns: number }).__checkRuns++;
      return real(event, ...args);
    });
  });
  return () => app.evaluate(() => (globalThis as unknown as { __checkRuns: number }).__checkRuns);
}

const selection = (page: Page) =>
  field(page).evaluate((el: HTMLTextAreaElement) => ({ start: el.selectionStart, end: el.selectionEnd, text: el.value.slice(el.selectionStart, el.selectionEnd) }));

test('Check opens from the rail and with Ctrl+3, in the menu order the spec gives', async ({ page }) => {
  const rail = MAIN_NAV(page);
  await expect(rail.getByRole('link')).toHaveText(['Home', 'Practice', 'Check', 'Review', 'People', 'Messages', 'Rooms', 'Progress', 'Settings']);

  await rail.getByRole('link', { name: 'Check', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Check' })).toBeVisible();
  await expect(page).toHaveURL(/#\/check$/);
  await expect(rail.getByRole('link', { name: 'Check', exact: true })).toHaveAttribute('aria-current', 'page');
  // The type, the six kinds of text in the spec order, the text field with its counter, and the fixed note with the Gemini sentence.
  await expect(typeSelect(page)).toBeVisible();
  await expect(typeSelect(page).locator('option')).toHaveText([
    'Pull request description', 'Slack message', 'E-mail', 'Code review comment', 'Commit message', 'Other',
  ]);
  await expect(field(page)).toBeVisible();
  await expect(page.getByText('0 / 2000 characters')).toBeVisible();
  await expect(page.getByText(GEMINI_NOTE)).toBeVisible();
  await expect(checkButton(page)).toBeDisabled();

  // Ctrl+1 goes home, Ctrl+3 comes back; the digits follow the rail (Ctrl+4 is Review, Ctrl+9 is Settings).
  await page.keyboard.press('Control+1');
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await page.keyboard.press('Control+3');
  await expect(page.getByRole('heading', { level: 1, name: 'Check' })).toBeVisible();
  await page.keyboard.press('Control+4');
  await expect(page.getByRole('heading', { level: 1, name: 'Review' })).toBeVisible();
  await page.keyboard.press('Control+9');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
});

test('the palette lists Go to Check with Ctrl 3, and the other rows with their new numbers', async ({ page }) => {
  await page.keyboard.press('Control+k');
  const options = page.getByRole('dialog', { name: 'Search or jump to' }).getByRole('option');
  const hint = async (name: string) => (await options.filter({ hasText: name }).first().locator('kbd').textContent())?.trim();
  expect(await hint('Go to Check')).toBe('Ctrl 3');
  expect(await hint('Go to Home')).toBe('Ctrl 1');
  expect(await hint('Go to Review')).toBe('Ctrl 4');
  expect(await hint('Go to Rooms')).toBe('Ctrl 7');
  expect(await hint('Go to Settings')).toBe('Ctrl 9');
  await page.keyboard.type('check');
  await expect(options.first()).toHaveText(/Go to Check/);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Check' })).toBeVisible();
});

test('a Slack text comes back marked, with a natural version that opens "Hey", 2 marks and 2 expressions; as an E-mail it opens "Hello"', async ({ page }) => {
  await openCheck(page);
  await check(page, 'Slack message', TEXT);
  await expect(reading(page)).toBeVisible();

  const galley = page.getByRole('article', { name: 'Your text' });
  await expect(marks(page)).toHaveCount(2);
  await expect(galley.getByRole('heading', { name: 'Your text' })).toBeVisible();
  await expect(galley).toContainText('2 edits');
  await expect(galley.locator('del')).toHaveText([/have fixed$/, /discuss about$/]);
  await expect(page.getByRole('heading', { level: 2, name: 'Natural version' })).toBeVisible();
  await expect(page.locator('.rewrite')).toHaveText(/^Hey\b/);
  await expect(page.getByText('Keeps the tone of a slack message.')).toBeVisible();
  await expect(page.locator('.exprs .expr')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Keep in Review' })).toHaveCount(2);
  // The button now offers a second check of the same text.
  await expect(checkButton(page, true)).toBeVisible();
  await expect(checkButton(page)).toHaveCount(0);

  // The same text as an e-mail.
  await typeSelect(page).selectOption({ label: 'E-mail' });
  await checkButton(page, true).click();
  await expect(page.locator('.rewrite')).toHaveText(/^Hello\b/);
  await expect(marks(page)).toHaveCount(2);
  await expect(page.getByText('Keeps the tone of an e-mail.')).toBeVisible();
  await expect(page.locator('.exprs .expr')).toHaveCount(2);
});

test('Copy puts the natural version on the clipboard', async ({ app, page }) => {
  await openCheck(page);
  await check(page, 'Slack message', TEXT);
  const rewrite = page.locator('.rewrite');
  await expect(rewrite).toBeVisible();
  await page.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(await rewrite.innerText());
});

test('nothing is saved: no history, no card, no expression, and the field is empty after a reload', async ({ page }) => {
  await openCheck(page);
  await check(page, 'Pull request description', TEXT);
  await expect(marks(page)).toHaveCount(2);
  expect(await historyCount(page)).toBe(0);
  expect(await queueSize(page)).toBe(0);
  const summary = await page.evaluate(() => window.devtalk.progress.summary());
  expect(summary).toMatchObject({ ok: true, data: { totalExpressions: 0, mistakes: [] } });

  // Away and back: the text was only ever in the field.
  await page.keyboard.press('Control+1');
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await page.keyboard.press('Control+3');
  await expect(field(page)).toHaveValue('');
  await expect(marks(page)).toHaveCount(0);

  await field(page).fill(TEXT);
  await page.reload();
  await waitForStart(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Check' })).toBeVisible();
  await expect(field(page)).toHaveValue('');
  expect(await historyCount(page)).toBe(0);
  expect(await queueSize(page)).toBe(0);
});

test('Keep in Review adds one expression', async ({ page }) => {
  await openCheck(page);
  await check(page, 'Slack message', TEXT);
  await expect(page.locator('.exprs .expr')).toHaveCount(2);
  expect(await queueSize(page)).toBe(0);

  const first = page.locator('.exprs .expr').first();
  await first.getByRole('button', { name: 'Keep in Review' }).click();
  await expect(first.getByRole('button', { name: 'Kept' })).toBeDisabled();
  expect(await queueSize(page)).toBe(1);
  // The other suggestion is still there to keep, and the rail counts the new card.
  await expect(page.getByRole('button', { name: 'Keep in Review' })).toHaveCount(1);
  await expect(MAIN_NAV(page).getByRole('link', { name: /Review/ })).toContainText('1');
  // Kept is not practice: still no history.
  expect(await historyCount(page)).toBe(0);

  await MAIN_NAV(page).getByRole('link', { name: /Review/ }).click();
  await expect(page.getByText('1 of 1')).toBeVisible();
});

test('a key stops the check and selects the passage', async ({ app, page }) => {
  const sent = await countChecks(app);
  await openCheck(page);
  const key = `sk-ant-api03-${'abcdefghij'.repeat(4)}`;
  const text = `Use ${key} here.`;
  await write(page, text);

  // At once, as a field error with the exact message.
  const alert = page.getByRole('alert').filter({ hasText: SECRET_MESSAGE });
  await expect(alert).toBeVisible();
  await expect(field(page)).toHaveAttribute('aria-invalid', 'true');

  // Ctrl+Enter selects exactly the key, sends nothing, and the coach never starts.
  await page.keyboard.press('Control+Enter');
  expect(await selection(page)).toEqual({ start: 4, end: 4 + key.length, text: key });
  await expect(field(page)).toBeFocused();
  await expect(reading(page)).toHaveCount(0);
  // The button does the same from anywhere else on the page: focus goes back to the field.
  await page.getByLabel('What are you writing?').focus();
  await checkButton(page).click();
  expect(await selection(page)).toEqual({ start: 4, end: 4 + key.length, text: key });
  await expect(field(page)).toBeFocused();
  await page.waitForTimeout(1200); // longer than the fixture coach's delay, in case anything was sent
  await expect(reading(page)).toHaveCount(0);
  await expect(page.locator('.rewrite')).toHaveCount(0);
  expect(await sent()).toBe(0);

  // Take the key out and the same text goes through.
  await write(page, 'Use the key from the vault here, in the fixture that sets up the payments service.');
  await expect(alert).toHaveCount(0);
  await page.keyboard.press('Control+Enter');
  await expect(reading(page)).toBeVisible();
  await expect(page.locator('.rewrite')).toBeVisible();
  expect(await sent()).toBe(1);
});

test('each kind of secret is marked where it is', async ({ page }) => {
  await openCheck(page);
  const cases: [string, string][] = [
    ['My token is ghp_abcdefghijklmnopqrstuvwxyz0123456789 and then more.', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['Line one.\nLine two has password=hunter2 in it.', 'password=hunter2'],
    ["const db = { PASSWD = 'hunter2' };", "PASSWD = 'hunter2'"],
    ['aws (AKIAABCDEFGHIJKLMNOP) is old', 'AKIAABCDEFGHIJKLMNOP'],
    ['header eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk end', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'],
    // a name that says what it holds, then its value: the whole name, sign and value is marked
    ['Config: client_secret=abc123xyz in the deploy.', 'client_secret=abc123xyz'],
    ['Body {"apiKey": "AbC123dEf456"} ok', '"apiKey": "AbC123dEf456"'],
    ['database:\n  password: hunter2\n  host: db', 'password: hunter2'],
    ['Set db.password = s3cr3t! before Friday.', 'db.password = s3cr3t!'],
    ['Send the header X-API-Key: 7f3a9c21d4 to the proxy', 'X-API-Key: 7f3a9c21d4'],
  ];
  for (const [text, secret] of cases) {
    await write(page, text);
    await expect(page.getByRole('alert').filter({ hasText: SECRET_MESSAGE })).toBeVisible();
    await page.keyboard.press('Control+Enter');
    expect((await selection(page)).text).toBe(secret);
  }
});

test('a key far down a long text is scrolled into view when it is selected', async ({ page }) => {
  await openCheck(page);
  const key = `sk-ant-api03-${'abcdefghij'.repeat(4)}`;
  await field(page).fill(`${'Some words to fill the field. '.repeat(55)}\n${key} is at the end.`);
  expect(await field(page).evaluate((el: HTMLTextAreaElement) => el.scrollHeight > el.clientHeight)).toBe(true);
  await field(page).evaluate((el: HTMLTextAreaElement) => { el.scrollTop = 0; });
  await page.keyboard.press('Control+Enter');
  expect((await selection(page)).text).toBe(key);
  expect(await field(page).evaluate((el: HTMLTextAreaElement) => el.scrollTop)).toBeGreaterThan(0);
});

test('ordinary prose is not stopped', async ({ page }) => {
  await openCheck(page);
  const prose = 'A risk-free, task-based plan for the desk-top and disk-bound jobs. Reset your password and rotate the token before Friday. ' +
    'Set password= the way the docs say, and use `token=` in the URL. My sk-learn notes say ghp_ is the prefix of a GitHub token. ' +
    'Password: please use the one I sent you. The token: we refresh it daily. Secret sauce, token-based auth, and the access token expired yesterday. ' +
    'Set max_tokens=1000 for the model, and keep `token=` and `password=` out of the logs.';
  await field(page).fill(prose);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(field(page)).not.toHaveAttribute('aria-invalid', 'true');
  await page.keyboard.press('Control+Enter');
  await expect(reading(page)).toBeVisible();
  await expect(page.locator('.rewrite')).toBeVisible();
});

test('2001 characters cannot be checked; 2000 can', async ({ page }) => {
  await openCheck(page);
  await field(page).fill('a'.repeat(2001));
  await expect(page.getByText('2001 / 2000 characters')).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Use 2000 characters or fewer (now 2001).' })).toBeVisible();
  await expect(checkButton(page)).toBeDisabled();
  await page.keyboard.press('Control+Enter');
  await expect(reading(page)).toHaveCount(0);
  await write(page, 'a'.repeat(2000));
  await expect(page.getByText('2000 / 2000 characters')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(checkButton(page)).toBeEnabled();
});

test('the Gemini sentence is gone with the Claude coach', async ({ page }) => {
  await openCheck(page);
  await expect(page.getByText('On the free Gemini plan, Google may use what you send to improve its models.')).toBeVisible();
  await page.keyboard.press('Control+9');
  await page.getByRole('radiogroup', { name: 'Provider' }).getByRole('radio', { name: 'Claude' }).click();
  await expect(page.getByText('Coach: Anthropic Claude')).toBeVisible();
  await page.keyboard.press('Control+3');
  await expect(page.getByRole('heading', { level: 1, name: 'Check' })).toBeVisible();
  await expect(page.getByText('Do not paste passwords, keys or private code.')).toBeVisible();
  await expect(page.getByText('On the free Gemini plan')).toHaveCount(0);
});

test('no key sends you to Settings', async ({ page }) => {
  await openCheck(page);
  await page.evaluate(() => window.devtalk.keys.clear('gemini'));
  await check(page, 'Slack message', TEXT);
  await expect(page.getByRole('alert').filter({ hasText: 'Add your API key in Settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(field(page)).toHaveValue(TEXT);
  await page.getByRole('button', { name: 'Open Settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
});

test('a text that mentions the rate limit shows the usage-limit message and Try again, and the text is kept', async ({ page }) => {
  const limited = `${TEXT} I also need to ask about the rate limit on staging.`;
  await openCheck(page);
  await check(page, 'Slack message', limited);
  await expect(page.getByRole('alert').filter({ hasText: 'usage limit' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Settings' })).toHaveCount(0);
  await expect(field(page)).toHaveValue(limited);
  // Without the words that trip the fixture's quota, Try again goes through.
  await write(page, TEXT);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(marks(page)).toHaveCount(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Esc cancels the coach and keeps the text', async ({ page }) => {
  await openCheck(page);
  await check(page, 'Slack message', TEXT);
  await expect(reading(page)).toBeVisible();
  await expect(field(page)).toHaveAttribute('readonly', '');
  await page.keyboard.press('Escape');
  await expect(reading(page)).toBeHidden();
  await expect(field(page)).toHaveValue(TEXT);
  await expect(field(page)).not.toHaveAttribute('readonly', '');
  await page.waitForTimeout(1500); // longer than the fixture coach's delay: nothing arrives for a cancelled call
  await expect(page.locator('.rewrite')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(checkButton(page)).toBeEnabled();
});

test('leaving Check while the coach works cancels it', async ({ app, page }) => {
  const sent = await countChecks(app);
  await openCheck(page);
  await check(page, 'Slack message', TEXT);
  await expect(reading(page)).toBeVisible();
  await page.keyboard.press('Control+1');
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await sent()).toBe(1);
  expect(await historyCount(page)).toBe(0);
  expect(await queueSize(page)).toBe(0);
});
