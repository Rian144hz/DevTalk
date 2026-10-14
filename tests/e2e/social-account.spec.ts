import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerOnce, expect, joinCommunity, onboard, test } from './fixtures';

test.use({ social: '1' });

const account = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Account' });

test('signed out, Account offers to join', async ({ page }) => {
  await onboard(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await account(page).getByRole('button', { name: 'Join the community' }).click();
  await expect(page.getByText('Step 1 of 4')).toBeVisible();
});

test('sign out returns People to the join invitation', async ({ page }) => {
  await onboard(page);
  await joinCommunity(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(account(page).getByText('rian@example.com')).toBeVisible();
  await account(page).getByRole('button', { name: 'Sign out' }).click();
  await expect(account(page).getByRole('button', { name: 'Join the community' })).toBeVisible();
  await page.getByRole('link', { name: 'People' }).click();
  await expect(page.getByRole('button', { name: 'Join the community' })).toBeVisible();
});

test('export writes the community data, and the practice history when ticked', async ({ app, page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'devtalk-export-'));
  const out = join(dir, 'export.json');
  try {
    await onboard(page);
    await answerOnce(page);
    await joinCommunity(page);
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
    }, out);
    await page.getByRole('link', { name: 'Settings' }).click();
    await account(page).getByRole('checkbox', { name: 'Include my practice history' }).check();
    await account(page).getByRole('button', { name: 'Export my data' }).click();
    await expect(account(page).getByText(`Saved to ${out}`)).toBeVisible();
    const data = JSON.parse(readFileSync(out, 'utf8')) as { community: { profile: { displayName: string } }; practice: Record<string, unknown[]> };
    expect(data.community.profile.displayName).toBe('Rian');
    expect(Object.keys(data.practice)).toContain('attempts');
    expect(data.practice['attempts']!.length).toBeGreaterThan(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('delete needs the account e-mail typed exactly', async ({ page }) => {
  await onboard(page);
  await joinCommunity(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await account(page).getByRole('button', { name: 'Delete my account…' }).click();
  const confirm = account(page).getByRole('button', { name: 'Delete my account', exact: true });
  await expect(confirm).toBeDisabled();
  await account(page).getByLabel('Type your e-mail to confirm').fill('someone@example.com');
  await expect(confirm).toBeDisabled();
  await account(page).getByLabel('Type your e-mail to confirm').fill('rian@example.com');
  await expect(confirm).toBeEnabled();
});

test('delete succeeds and returns to the join invitation', async ({ page }) => {
  await onboard(page);
  await joinCommunity(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await account(page).getByRole('button', { name: 'Delete my account…' }).click();
  await account(page).getByLabel('Type your e-mail to confirm').fill('rian@example.com');
  await account(page).getByRole('button', { name: 'Delete my account', exact: true }).click();
  await expect(account(page).getByText('Your community account was deleted.')).toBeVisible();
  await expect(account(page).getByRole('button', { name: 'Join the community' })).toBeVisible();
});

test.describe('while the server cannot delete', () => {
  test.use({ socialFail: 'deleteAccount:offline' });

  test('delete offline explains and keeps you signed in', async ({ page }) => {
    await onboard(page);
    await joinCommunity(page);
    await page.getByRole('link', { name: 'Settings' }).click();
    await account(page).getByRole('button', { name: 'Delete my account…' }).click();
    await account(page).getByLabel('Type your e-mail to confirm').fill('rian@example.com');
    await account(page).getByRole('button', { name: 'Delete my account', exact: true }).click();
    await expect(account(page).getByText('You are offline. Your practice still works; the community needs a connection.')).toBeVisible();
    await expect(account(page).getByText('Signed in as rian@example.com')).toBeVisible();
  });
});
