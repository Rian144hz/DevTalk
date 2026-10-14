import { expect, test } from './fixtures';

test('first launch shows onboarding', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1, name: 'Set up your coach' })).toBeVisible();
});
