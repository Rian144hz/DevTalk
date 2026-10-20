import { answerOnce, expect, onboard, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await onboard(page);
});

test('an empty history invites the first answer', async ({ page }) => {
  await page.getByRole('link', { name: 'Progress' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Progress' })).toBeVisible();
  await expect(page.getByText('Your answers will be listed here.')).toBeVisible();
});

test('edits by category and the history appear after one answer', async ({ page }) => {
  await answerOnce(page);
  await page.getByRole('link', { name: 'Progress' }).click();
  const edits = page.getByRole('region', { name: 'Edits by category' });
  await expect(edits.getByText('verb tense')).toBeVisible();
  await expect(edits.getByText('prepositions')).toBeVisible();
  await expect(page.getByText('2 expressions learned.')).toBeVisible();
});

test('history opens a past feedback', async ({ page }) => {
  await answerOnce(page);
  await page.getByRole('link', { name: 'Progress' }).click();
  await page.getByRole('region', { name: 'History' }).getByRole('link').first().click();
  await expect(page).toHaveURL(/#\/feedback\/\d+$/);
  await expect(page.getByRole('heading', { name: 'Your answer' })).toBeVisible();
});

test('Rooms and People invite you to join the community', async ({ page }) => {
  // Without a community account Rooms invites you to join, or says the build has no community server (no .env at build time).
  await page.getByRole('link', { name: 'Rooms' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Rooms' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Join the community to talk in rooms|Community is not set up in this build/ })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).not.toContainText('Later');
  await page.getByRole('link', { name: 'People' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Coming in a later version' })).toHaveCount(0);
});
