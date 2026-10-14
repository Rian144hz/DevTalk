import { expect, onboard, SAMPLE_ANSWER, test } from './fixtures';
import type { Page } from '@playwright/test';

async function answer(page: Page, text: string) {
  await page.getByRole('button', { name: 'Get a challenge' }).click();
  await page.getByRole('button', { name: 'Write it' }).click();
  await page.getByRole('textbox', { name: 'Your answer' }).fill(text);
  await page.keyboard.press('Control+Enter');
}

test.beforeEach(async ({ page }) => {
  await onboard(page);
});

test('a usage limit keeps the answer and offers Try again', async ({ page }) => {
  await answer(page, `${SAMPLE_ANSWER} #ratelimit`);
  await expect(page.getByRole('alert').filter({ hasText: 'usage limit' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit answer' }).click();
  await expect(page.getByRole('textbox', { name: 'Your answer' })).toHaveValue(`${SAMPLE_ANSWER} #ratelimit`);
});

test('no key sends you to Settings', async ({ page }) => {
  await page.getByRole('button', { name: 'Get a challenge' }).click();
  await page.getByRole('button', { name: 'Write it' }).click();
  await page.evaluate(() => window.devtalk.keys.clear('gemini'));
  await page.getByRole('textbox', { name: 'Your answer' }).fill(SAMPLE_ANSWER);
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'Add your API key in Settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Open Settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
});

test('Copy puts the rewrite on the clipboard', async ({ app, page }) => {
  await answer(page, SAMPLE_ANSWER);
  const rewrite = page.locator('.rewrite');
  await expect(rewrite).toBeVisible();
  await page.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(await rewrite.innerText());
});

test('Write it again reopens the same challenge with your answer', async ({ page }) => {
  await answer(page, SAMPLE_ANSWER);
  await expect(page.locator('.galley .mark-n')).toHaveCount(2);
  await page.getByRole('button', { name: 'Write it again' }).click();
  await expect(page.getByRole('textbox', { name: 'Your answer' })).toHaveValue(SAMPLE_ANSWER);
});
