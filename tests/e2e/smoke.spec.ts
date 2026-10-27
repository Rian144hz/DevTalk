import { expect, test } from './fixtures';

test('first launch shows the welcome screen, and practising without an account opens the coach setup', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1, name: 'Practise the English you use at work.' })).toBeVisible();
  await page.getByRole('button', { name: 'Practise without an account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Set up your coach' })).toBeVisible();
});
