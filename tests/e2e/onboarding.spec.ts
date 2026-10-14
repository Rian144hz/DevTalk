import { expect, test } from './fixtures';

test('onboarding saves profile and key, then lands on Home', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 2, name: 'Your languages' })).toBeVisible();
  await page.getByLabel('Native language').selectOption('Spanish');
  await page.getByRole('radio', { name: 'English' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Your level' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Your coach' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get a free key' })).toHaveAttribute('href', 'https://aistudio.google.com/apikey');
  await page.getByLabel('API key').fill('test-key');
  await page.getByRole('button', { name: 'Start practising' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  const profile = await page.evaluate(() => window.devtalk.profile.get());
  expect(profile).toMatchObject({ ok: true, data: { nativeLanguage: 'Spanish', explanationLanguage: 'English', currentLevel: 'B1', targetLevel: 'B2', provider: 'gemini', theme: 'dark' } });
  expect(await page.evaluate(() => window.devtalk.keys.status('gemini'))).toEqual({ ok: true, data: { hasKey: true } });
});

test('target level must be above current', async ({ page }) => {
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radiogroup', { name: 'Current level' }).getByRole('radio', { name: 'C1' }).click();
  await page.getByRole('radiogroup', { name: 'Target level' }).getByRole('radio', { name: 'B2' }).click();
  await expect(page.getByText('Your target must be above your current level.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
});

test('the key can be added later', async ({ page }) => {
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Start practising' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  expect(await page.evaluate(() => window.devtalk.keys.status('gemini'))).toEqual({ ok: true, data: { hasKey: false } });
  await page.getByRole('button', { name: 'Get a challenge' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Add your API key in Settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Open Settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
});

test.describe('without a system keyring', () => {
  test.use({ keyring: 'unavailable' });
  test('saving the key explains why it cannot be stored', async ({ page }) => {
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('API key').fill('test-key');
    await page.getByRole('button', { name: 'Start practising' }).click();
    await expect(page.getByRole('alert')).toContainText('keyring is not available');
  });
});
