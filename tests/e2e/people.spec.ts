// Phase 2B.1 — member list, other people's profiles, follow, like — against the seeded fake community.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, onboard, test } from './fixtures';

interface FakeState {
  profiles: Record<string, { id: string; displayName: string; listed?: boolean }>;
  notices: { userId: string; message: string; kind?: string; actor?: string | null }[];
}
const fakeState = (dataDir: string) => JSON.parse(readFileSync(join(dataDir, 'fake-social.json'), 'utf8')) as FakeState;
const idOf = (s: FakeState, name: string) => Object.values(s.profiles).find((p) => p.displayName === name)!.id;
const go = (page: Page, hash: string) => page.evaluate((h) => { location.hash = h; }, hash);
const members = (page: Page) => page.getByRole('list', { name: 'Members' }).getByRole('listitem');

test.use({ social: 'people' });

test('filter the member list by level and open a profile', async ({ page }) => {
  await onboard(page);
  await page.getByRole('link', { name: 'People' }).click();
  await expect(members(page).first()).toContainText('Bia');
  await page.getByLabel('English level').selectOption('B2');
  await expect(members(page)).toHaveCount(2);
  await expect(members(page).nth(0)).toContainText('Caio');
  await expect(members(page).nth(1)).toContainText('Lia');
  await members(page).filter({ hasText: 'Caio' }).getByRole('link').click();
  await expect(page.getByRole('heading', { level: 2, name: 'Caio' })).toBeVisible();
});

test('follow and unfollow: the count, the Following tab and a notice for the other person', async ({ page, dataDir }) => {
  await onboard(page);
  await go(page, '#/people');
  await members(page).filter({ hasText: 'Bia' }).getByRole('link').click();
  await expect(page.getByRole('link', { name: '2 followers' })).toBeVisible();
  await page.getByRole('button', { name: 'Follow' }).click();
  await expect(page.getByRole('button', { name: 'Following' })).toBeVisible();
  await expect(page.getByRole('link', { name: '3 followers' })).toBeVisible();
  const state = fakeState(dataDir);
  expect(state.notices.filter((n) => n.userId === idOf(state, 'Bia')).map((n) => n.message)).toEqual(['Rian followed you.']);
  await page.getByRole('link', { name: 'Following', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Following' }).getByRole('link')).toHaveCount(1);
  await page.getByRole('list', { name: 'Following' }).getByRole('link', { name: /Bia/ }).click();
  await page.getByRole('button', { name: 'Following' }).click();
  await expect(page.getByRole('link', { name: '2 followers' })).toBeVisible();
  await page.getByRole('link', { name: 'Following', exact: true }).click();
  await expect(page.getByText('You do not follow anyone yet.')).toBeVisible();
});

test('like and unlike a profile', async ({ page }) => {
  await onboard(page);
  await go(page, '#/people');
  await members(page).filter({ hasText: 'Ana' }).getByRole('link').click();
  const like = page.getByRole('button', { name: /Like Ana's profile/ });
  await expect(like).toHaveAttribute('aria-pressed', 'false');
  await like.click();
  await expect(page.getByRole('button', { name: "Unlike Ana's profile, 1 like" })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /Unlike Ana's profile/ }).click();
  await expect(page.getByRole('button', { name: "Like Ana's profile, 0 likes" })).toBeVisible();
});

test('a member\'s followers list', async ({ page }) => {
  await onboard(page);
  await go(page, '#/people');
  await members(page).filter({ hasText: 'Bia' }).getByRole('link').click();
  await page.getByRole('link', { name: '2 followers' }).click();
  await expect(page.getByRole('heading', { name: "Bia's followers" })).toBeVisible();
  const list = page.getByRole('list', { name: "Bia's followers" }).getByRole('listitem');
  await expect(list).toHaveCount(2);
  await expect(list.nth(0)).toContainText('Ana');
  await expect(list.nth(1)).toContainText('Caio');
});

test('a follow notice shows the follower\'s picture and links to their profile', async ({ page }) => {
  await onboard(page);
  await go(page, '#/people');
  await expect(page.locator('.follow-notice img.avatar-mascot')).toHaveAttribute('src', /axolotl-2/);
  await page.getByRole('link', { name: 'Hugo', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Hugo' })).toBeVisible();
});

test('turning off "Show me in the member list" is saved with the profile', async ({ page, dataDir }) => {
  await onboard(page);
  await go(page, '#/people/me');
  await page.getByRole('button', { name: 'Edit profile' }).click();
  await page.getByRole('checkbox', { name: 'Show me in the member list' }).uncheck();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Rian' })).toBeVisible();
  const state = fakeState(dataDir);
  expect(state.profiles[idOf(state, 'Rian')]!.listed).toBe(false);
});

test('blocked and suspended members stay out of reach', async ({ page, dataDir }) => {
  await onboard(page);
  await go(page, '#/people');
  await page.getByLabel('Search by name').fill('Gil');
  await expect(page.getByText('No members match these filters.')).toBeVisible();
  await go(page, `#/people/u/${idOf(fakeState(dataDir), 'Fabi')}`);
  await expect(page.getByText('This profile is not available.')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Members' }).click();
  await expect(members(page).first()).toContainText('Bia');
});

test('the palette opens Members and Following', async ({ page }) => {
  await onboard(page);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Go to Following');
  await page.keyboard.press('Enter');
  await expect(page.getByText('You do not follow anyone yet.')).toBeVisible();
});

test('a double click on Follow or on the heart ends in one consistent state', async ({ page, dataDir }) => {
  await onboard(page);
  await go(page, '#/people');
  await members(page).filter({ hasText: 'Dani' }).getByRole('link').click();
  await page.getByRole('button', { name: 'Follow' }).dblclick();
  await page.getByRole('button', { name: /Like Dani's profile/ }).dblclick();
  await expect(page.getByRole('button', { name: 'Following' })).toBeVisible();
  await expect(page.getByRole('link', { name: '1 follower' })).toBeVisible();
  await expect(page.getByRole('button', { name: "Unlike Dani's profile, 1 like" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Following' })).toBeVisible();
  await expect(page.getByRole('link', { name: '1 follower' })).toBeVisible();
  await expect(page.getByRole('button', { name: "Unlike Dani's profile, 1 like" })).toBeVisible();
  const state = JSON.parse(readFileSync(join(dataDir, 'fake-social.json'), 'utf8')) as { follows: { followee: string }[] };
  expect(state.follows.filter((f) => f.followee === idOf(fakeState(dataDir), 'Dani'))).toHaveLength(1);
});
