import { expect, onboard, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await onboard(page);
  await page.evaluate(() => { location.hash = '#/settings'; });
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
});

test('changing the theme applies immediately and is saved', async ({ page }) => {
  await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => window.devtalk.settings.get())).toMatchObject({ ok: true, data: { theme: 'light' } });
});

test('removing the key updates the key status', async ({ page }) => {
  await expect(page.getByText('Key saved for Google Gemini')).toBeVisible();
  await page.getByRole('button', { name: 'Remove key' }).click();
  await expect(page.getByText('No key saved for Google Gemini')).toBeVisible();
  expect(await page.evaluate(() => window.devtalk.keys.status('gemini'))).toEqual({ ok: true, data: { hasKey: false } });
});

test('switching the coach to Claude resets the model and updates the sidebar', async ({ page }) => {
  await page.getByRole('radiogroup', { name: 'Provider' }).getByRole('radio', { name: 'Claude' }).click();
  await expect(page.getByLabel('Model')).toHaveValue('claude-opus-5-5');
  await expect(page.getByText('Coach: Anthropic Claude')).toBeVisible();
});

test('profile changes are saved', async ({ page }) => {
  await page.getByRole('radiogroup', { name: 'Target level' }).getByRole('radio', { name: 'C1' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  expect(await page.evaluate(() => window.devtalk.profile.get())).toMatchObject({ ok: true, data: { targetLevel: 'C1' } });
});

test('choosing Ollama hides the key and checks the local connection', async ({ page }) => {
  await page.getByRole('radiogroup', { name: 'Provider' }).getByRole('radio', { name: 'Ollama (on this computer)' }).click();
  await expect(page.getByLabel('Model')).toHaveValue('qwen3:4b');
  await expect(page.getByLabel('API key')).toBeHidden();
  await page.getByRole('button', { name: 'Check connection' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Ollama is (not running|running)/ })).toBeVisible();
});
