import { expect, historyCount, onboard, SAMPLE_ANSWER, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await onboard(page);
});

async function getChallenge(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Get a challenge' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'The coach is writing a challenge' })).toBeVisible();
  await page.getByRole('button', { name: 'Write it' }).click();
  await expect(page.getByLabel('Your answer')).toBeVisible();
}

test('get a challenge, answer it, see feedback', async ({ page }) => {
  await expect(page.getByText('Your first answer will appear here')).toBeVisible();
  await getChallenge(page);
  await page.getByLabel('Your answer').fill(SAMPLE_ANSWER);
  await expect(page.getByText('3 sentences. Aim for 3 to 5.')).toBeVisible();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('status').filter({ hasText: 'The coach is reading your answer' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your answer' })).toBeVisible();
  await expect(page.locator('.galley .mark-n')).toHaveCount(2);
  await expect(page).toHaveURL(/#\/feedback\/\d+$/);
  // Home now shows the last answer and no longer the first-run state.
  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByRole('heading', { name: 'Your last answer, marked by the coach' })).toBeVisible();
});

test('Ctrl+Enter twice saves one answer', async ({ page }) => {
  await getChallenge(page);
  await page.getByLabel('Your answer').fill(SAMPLE_ANSWER);
  await page.keyboard.press('Control+Enter');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.galley .mark-n')).toHaveCount(2);
  expect(await historyCount(page)).toBe(1);
});

test('leaving Practice while the coach works cancels it', async ({ page }) => {
  await getChallenge(page);
  await page.getByLabel('Your answer').fill(SAMPLE_ANSWER);
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('status').filter({ hasText: 'The coach is reading your answer' })).toBeVisible();
  await page.getByRole('link', { name: 'Home' }).click();
  await page.waitForTimeout(2000); // longer than the fixture coach's delay
  await expect(page).toHaveURL(/#\/home$/);
  expect(await historyCount(page)).toBe(0);
});

test('an answer over 4000 characters cannot be submitted', async ({ page }) => {
  await getChallenge(page);
  await page.getByLabel('Your answer').fill('a'.repeat(4001));
  await expect(page.getByText('Keep it under 4000 characters (now 4001).')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get feedback' })).toBeDisabled();
});
