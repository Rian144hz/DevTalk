import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, joinCommunity, launchApp, newDataDir, onboard, test } from './fixtures';

test.use({ social: '1' });

test('People invites you to join when signed out', async ({ page }) => {
  await onboard(page);
  await page.getByRole('link', { name: 'People' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join the community' })).toBeVisible();
});

test('full join: e-mail, code, documents, profile, then People shows the profile', async ({ page }) => {
  await onboard(page);
  await page.getByRole('link', { name: 'People' }).click();
  await page.getByRole('button', { name: 'Join the community' }).click();
  await expect(page.getByText('Step 1 of 4')).toBeVisible();
  await page.getByLabel('E-mail').fill('rian@example.com');
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByText('Step 2 of 4')).toBeVisible();
  await expect(page.getByRole('button', { name: /Send a new code/ })).toBeDisabled();
  await page.getByLabel('Code').fill('123456');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText('Step 3 of 4')).toBeVisible();
  const cont = page.getByRole('button', { name: 'Continue' });
  await page.getByRole('checkbox', { name: 'I accept the Terms of use' }).check();
  await page.getByRole('checkbox', { name: 'I accept the Privacy policy' }).check();
  await page.getByRole('checkbox', { name: 'I accept the Code of conduct' }).check();
  await expect(cont).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I am 18 or older' }).check();
  await cont.click();

  await expect(page.getByText('Step 4 of 4')).toBeVisible();
  await expect(page.getByLabel('Native language')).toHaveValue('Portuguese (Brazil)');
  await page.getByLabel('Display name').fill('Rian');
  const stack = page.getByLabel('Stack');
  await stack.fill('Python');
  await stack.press('Enter');
  await stack.fill('c++');
  await stack.press('Enter');
  await page.getByRole('button', { name: 'Join' }).click();

  await expect(page.getByRole('heading', { level: 2, name: 'Rian' })).toBeVisible();
  await expect(page.locator('.stack-tag', { hasText: 'Python' })).toBeVisible();
  await expect(page.locator('.stack-tag', { hasText: 'C++' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit profile' })).toBeVisible();
});

test('a wrong code says what to do', async ({ page }) => {
  await onboard(page);
  await page.evaluate(() => { location.hash = '#/join'; });
  await page.getByLabel('E-mail').fill('rian@example.com');
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Code').fill('000000');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('That code did not work. Check it or send a new one.')).toBeVisible();
});

test('a legal document opens in full and coming back keeps the ticks', async ({ page }) => {
  await onboard(page);
  await page.evaluate(() => { location.hash = '#/join'; });
  await page.getByLabel('E-mail').fill('rian@example.com');
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Code').fill('123456');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('checkbox', { name: 'I am 18 or older' }).check();
  await page.getByRole('link', { name: 'Read the Privacy policy' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible();
  await expect(page.getByText('LGPD')).not.toHaveCount(0);
  await page.getByRole('link', { name: 'Back to joining' }).click();
  await expect(page.getByRole('checkbox', { name: 'I am 18 or older' })).toBeChecked();
});

test('quitting after the code resumes at the documents step', async () => {
  const dataDir = newDataDir();
  try {
    let app = await launchApp({ dataDir, social: '1' });
    let page = await app.firstWindow();
    await onboard(page);
    await page.evaluate(() => { location.hash = '#/join'; });
    await page.getByLabel('E-mail').fill('rian@example.com');
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByLabel('Code').fill('123456');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Step 3 of 4')).toBeVisible();
    await app.close();

    app = await launchApp({ dataDir, social: '1' });
    page = await app.firstWindow();
    await page.getByRole('link', { name: 'People' }).click();
    await expect(page.getByText('Finish joining')).toBeVisible();
    await page.getByRole('button', { name: 'Continue joining' }).click();
    await expect(page.getByText('Step 3 of 4')).toBeVisible();
    await app.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a profile photo shows on People; an SVG is refused', async ({ page }) => {
  await onboard(page);
  await joinCommunity(page);
  await page.getByRole('button', { name: 'Edit profile' }).click();
  const input = page.locator('.photo-row input[type="file"]');
  await input.setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
  await expect(page.getByText('Choose a JPEG, PNG or WebP image.')).toBeVisible();
  await input.setInputFiles(join(__dirname, 'assets', 'photo.png'));
  await expect(page.locator('.photo-row img.avatar')).toHaveAttribute('src', /^data:image\/webp;base64,/);
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.locator('.profile img.avatar')).toHaveAttribute('src', /^data:image\/webp;base64,/);
});

test('new document versions: a member who accepted older ones accepts again before using the community', async () => {
  const dataDir = newDataDir();
  try {
    let app = await launchApp({ dataDir, social: '1' });
    let page = await app.firstWindow();
    await onboard(page);
    await joinCommunity(page);
    await app.close();

    // The documents accepted at sign-up become an older version.
    const file = join(dataDir, 'fake-social.json');
    const state = JSON.parse(readFileSync(file, 'utf8')) as { consents: { version: string }[] };
    for (const c of state.consents) c.version = '2026-10-14';
    writeFileSync(file, JSON.stringify(state));

    app = await launchApp({ dataDir, social: '1' });
    page = await app.firstWindow();
    await page.getByRole('link', { name: 'People' }).click();
    await expect(page.getByText('Finish joining')).toBeVisible();
    await page.getByRole('button', { name: 'Continue joining' }).click();
    await expect(page.getByText('Step 3 of 4')).toBeVisible();
    await app.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
