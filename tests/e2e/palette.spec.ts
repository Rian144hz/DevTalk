import { expect, onboard, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await onboard(page);
});

test('Ctrl+K then "set" and Enter opens Settings', async ({ page }) => {
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search or jump to' });
  await expect(dialog).toBeVisible();
  await page.keyboard.type('set');
  await expect(dialog.getByRole('option').first()).toHaveText(/Go to Settings/);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(dialog).toBeHidden();
});

test('arrow keys move the selection', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { selected: true })).toHaveText(/Go to Practice/);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/practice$/);
});

test('Ctrl+3 opens Review and Ctrl+1 goes back to Today', async ({ page }) => {
  await page.keyboard.press('Control+3');
  await expect(page.getByRole('heading', { level: 1, name: 'Review' })).toBeVisible();
  await page.keyboard.press('Control+1');
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
});

test('Esc closes the palette and returns focus to the opener', async ({ page }) => {
  await page.getByRole('button', { name: /Search or jump to/ }).click();
  await expect(page.getByRole('dialog', { name: 'Search or jump to' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Search or jump to' })).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.textContent ?? '')).toContain('Search or jump to');
});

test('the theme can be switched from the palette', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await page.keyboard.type('light');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
