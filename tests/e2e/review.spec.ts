import { answerOnce, expect, onboard, queueSize, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await onboard(page);
});

test('an empty queue explains where expressions come from', async ({ page }) => {
  await page.getByRole('link', { name: 'Review' }).click();
  await expect(page.getByRole('heading', { name: 'Nothing to review now' })).toBeVisible();
  await expect(page.getByText('Expressions from your feedback will appear here.')).toBeVisible();
});

test('rate cards with the keyboard, then see when the next review is', async ({ page }) => {
  await answerOnce(page);
  await page.getByRole('link', { name: 'Review' }).click();
  await expect(page.getByText('1 of 2')).toBeVisible();
  await expect(page.getByText('Lançar aos poucos', { exact: false })).toBeHidden();
  await page.keyboard.press('Space');
  await expect(page.locator('.review-card .expr-meaning')).toBeVisible();
  await page.keyboard.press('3');
  await expect(page.getByText('2 of 2')).toBeVisible();
  await page.keyboard.press('Space');
  await page.keyboard.press('4');
  await expect(page.getByRole('heading', { name: 'Done for now' })).toBeVisible();
  await expect(page.getByText(/Next review (in \d+ min|tomorrow|in \d+ days)/)).toBeVisible();
});

test('holding a rating key rates once', async ({ page }) => {
  await answerOnce(page);
  await page.getByRole('link', { name: 'Review' }).click();
  await expect(page.getByText('1 of 2')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.locator('.review-card .expr-meaning')).toBeVisible();
  await page.evaluate(() => {
    for (const repeat of [false, true, true, true]) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', repeat, bubbles: true }));
    }
  });
  await expect(page.getByText('2 of 2')).toBeVisible();
  expect(await queueSize(page)).toBe(1);
});

test('each rating shows when the card comes back', async ({ page }) => {
  await answerOnce(page);
  await page.getByRole('link', { name: 'Review' }).click();
  await page.getByRole('button', { name: 'Show meaning' }).click();
  for (const name of ['Again', 'Hard', 'Good', 'Easy']) {
    await expect(page.getByRole('button', { name: new RegExp(`^${name}`) })).toContainText(/now|min|h|tomorrow|days/);
  }
});

test('typing in the palette on Review does not reveal or rate the card', async ({ page }) => {
  await answerOnce(page);
  await page.getByRole('link', { name: 'Review' }).click();
  await expect(page.getByText('1 of 2')).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('go to settings 3');
  await expect(page.getByRole('combobox')).toHaveValue('go to settings 3');
  await page.keyboard.press('Escape');
  await expect(page.locator('.review-card .expr-meaning')).toBeHidden();
  expect(await queueSize(page)).toBe(2);
});
