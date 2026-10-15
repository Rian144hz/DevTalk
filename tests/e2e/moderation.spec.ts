import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, joinCommunity, onboard, test } from './fixtures';

interface FakeState {
  notices: { userId: string; message: string }[];
  profiles: Record<string, { displayName: string; suspendedUntil: string | null }>;
}
const fakeState = (dataDir: string) => JSON.parse(readFileSync(join(dataDir, 'fake-social.json'), 'utf8')) as FakeState;
const idOf = (s: FakeState, name: string) => Object.values(s.profiles).find((p) => p.displayName === name) as unknown as { id: string };

test.describe('as a moderator', () => {
  test.use({ social: 'moderation' });

  test('lists open reports; a warning closes one and reaches the person', async ({ page, dataDir }) => {
    await onboard(page);
    await page.getByRole('link', { name: 'Moderation' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Moderation' })).toBeVisible();
    const reports = page.getByRole('list', { name: 'Open reports' }).getByRole('listitem');
    await expect(reports).toHaveCount(2);
    await reports.filter({ hasText: 'Sam' }).getByRole('button').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Report about Sam' })).toBeVisible();
    await expect(page.getByText('No earlier actions.')).toBeVisible();
    await page.getByLabel('Warning message').fill('Please stop sending the same link to everyone.');
    await page.getByRole('button', { name: 'Send warning' }).click();
    await expect(reports).toHaveCount(1);
    const state = fakeState(dataDir);
    const sam = idOf(state, 'Sam');
    expect(state.notices.filter((n) => n.userId === sam.id).map((n) => n.message)).toEqual([
      'Please stop sending the same link to everyone.',
    ]);
  });

  test('a 7-day suspension shows in the history and can be lifted', async ({ page, dataDir }) => {
    await onboard(page);
    await page.getByRole('link', { name: 'Moderation' }).click();
    const reports = page.getByRole('list', { name: 'Open reports' }).getByRole('listitem');
    await reports.filter({ hasText: 'Alex' }).getByRole('button').click();
    await page.getByRole('radio', { name: '7 days' }).click();
    await page.getByLabel('Reason for the suspension').fill('Harassment after being asked to stop.');
    await page.getByRole('button', { name: 'Suspend Alex' }).click();
    await expect(page.getByText('Decision saved. The report is closed.')).toBeVisible();
    await expect(reports).toHaveCount(1);
    const history = page.getByRole('list', { name: 'Earlier actions' });
    await expect(history.getByText(/^Suspended until /)).toBeVisible();
    const alex = idOf(fakeState(dataDir), 'Alex');
    expect(fakeState(dataDir).profiles[alex.id]!.suspendedUntil).not.toBeNull();
    await page.getByRole('button', { name: 'Lift suspension' }).click();
    await expect(history.getByText('Suspension lifted')).toBeVisible();
    expect(fakeState(dataDir).profiles[alex.id]!.suspendedUntil).toBeNull();
  });

  test('an avatar that cannot be decoded falls back to the mascot', async ({ page }) => {
    await onboard(page);
    await page.getByRole('link', { name: 'Moderation' }).click();
    const sam = page.getByRole('list', { name: 'Open reports' }).getByRole('listitem').filter({ hasText: 'Sam' });
    await expect(sam.locator('img.avatar-mascot')).toBeVisible();
    await expect(sam.locator('img.avatar-mascot')).not.toHaveAttribute('src', /^data:/);
    await expect(sam.locator('.avatar-initial')).toHaveCount(0);
  });

  test('a moderator finds a member and gives and takes a badge with a reason', async ({ page, dataDir }) => {
    await onboard(page);
    await page.getByRole('link', { name: 'Moderation' }).click();
    const badges = page.getByRole('region', { name: 'Badges', exact: true });
    await badges.getByLabel('Find a member').fill('Sam');
    const found = badges.getByRole('list', { name: 'Members found' }).getByRole('listitem');
    await expect(found).toHaveCount(1);
    await found.getByRole('button', { name: /Sam/ }).click();
    const row = badges.getByRole('list', { name: 'Badges', exact: true });
    await expect(row.getByText('Mentor')).toBeVisible();
    await badges.getByRole('button', { name: 'Remove Mentor' }).click();
    await expect(badges.getByText('Write a reason first.')).toBeVisible();
    await badges.getByLabel('Reason').fill('Stopped mentoring');
    await badges.getByRole('button', { name: 'Remove Mentor' }).click();
    await expect(row.getByText('Mentor')).toHaveCount(0);
    await badges.getByLabel('Reason').fill('Helped three people this week');
    await badges.getByRole('button', { name: 'Give Mentor' }).click();
    await expect(row.getByText('Mentor')).toBeVisible();
    const state = fakeState(dataDir);
    const sam = idOf(state, 'Sam');
    expect(state.notices.filter((n) => n.userId === sam.id).map((n) => n.message)).toContain('You received the Mentor badge.');
    await expect(badges.getByRole('list', { name: 'Badge history' }).getByText('Gave Mentor')).toBeVisible();
    await expect(badges.getByRole('list', { name: 'Badge history' }).getByText('Removed Mentor')).toBeVisible();
  });

  test('choosing yourself explains that your own badges are changed by another moderator', async ({ page }) => {
    await onboard(page);
    await page.getByRole('link', { name: 'Moderation' }).click();
    const badges = page.getByRole('region', { name: 'Badges', exact: true });
    await badges.getByLabel('Find a member').fill('Mod');
    await badges.getByRole('list', { name: 'Members found' }).getByRole('button', { name: /Mod/ }).click();
    await expect(badges.getByText('This is you. You cannot change your own badges; another moderator can do it.')).toBeVisible();
    await expect(badges.getByRole('button', { name: /^(Give|Remove) / })).toHaveCount(3);
    for (const b of await badges.getByRole('button', { name: /^(Give|Remove) / }).all()) await expect(b).toBeDisabled();
  });

  test('the palette can open Moderation', async ({ page }) => {
    await onboard(page);
    await page.keyboard.press('Control+k');
    await page.keyboard.type('moderation');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Moderation' })).toBeVisible();
  });
});

test.describe('as a member', () => {
  test.use({ social: '1' });

  test('there is no Moderation item and the page says so', async ({ page }) => {
    await onboard(page);
    await joinCommunity(page);
    await expect(page.getByRole('link', { name: 'Moderation' })).toHaveCount(0);
    await page.evaluate(() => { location.hash = '#/moderation'; });
    await expect(page.getByText('Only moderators can see this.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Badges' })).toHaveCount(0);
  });
});
