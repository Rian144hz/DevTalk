// Profile extras: mascots, badges, practice graph and banners, against the fake community backend.
import { join } from 'node:path';
import { answerOnce, expect, joinCommunity, onboard, test } from './fixtures';

const go = (page: import('@playwright/test').Page, hash: string) => page.evaluate((h) => { location.hash = h; }, hash);

test.describe('as a new member', () => {
  test.use({ social: '1' });

  test('without a photo the mascot shows and can be changed; a photo wins', async ({ page }) => {
    await onboard(page);
    await joinCommunity(page);
    await expect(page.locator('.profile img.avatar-mascot')).toBeVisible();
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.getByRole('img', { name: 'Giant panda' }).click();
    await expect(page.getByRole('radio', { name: 'Giant panda' })).toBeChecked();
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.locator('.profile img.avatar-mascot')).toHaveAttribute('src', /bear-3/);

    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.locator('.photo-row input[type="file"]').setInputFiles(join(__dirname, 'assets', 'photo.png'));
    await expect(page.locator('.photo-row img.avatar')).toHaveAttribute('src', /^data:image\/webp;base64,/);
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.locator('.profile img.avatar')).toHaveAttribute('src', /^data:image\/webp;base64,/);
    await expect(page.locator('.profile img.avatar-mascot')).toHaveCount(0);
  });

  test('an animated banner is kept as a GIF and stays still when animations are off', async ({ page }) => {
    await onboard(page);
    await joinCommunity(page);
    await expect(page.locator('.profile .banner-empty')).toBeVisible();
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.locator('.banner-field input[type="file"]').setInputFiles(join(__dirname, 'assets', 'banner.gif'));
    await expect(page.locator('.banner-field .banner img')).toHaveAttribute('src', /^data:image\/gif;base64,/);
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.locator('.profile .banner img')).toHaveAttribute('src', /^data:image\/gif;base64,/);

    await go(page, '#/settings');
    await page.getByRole('checkbox', { name: 'Play animated banners' }).uncheck();
    await go(page, '#/people');
    await expect(page.locator('.profile .banner img')).toHaveAttribute('src', /^data:image\/webp;base64,/);
  });

  test('a banner of the wrong kind is refused with the plain message', async ({ page }) => {
    await onboard(page);
    await joinCommunity(page);
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.locator('.banner-field input[type="file"]').setInputFiles({ name: 'x.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
    await expect(page.getByText('Choose a GIF, WebP, JPEG or PNG image.')).toBeVisible();
  });

  test('an answer reaches the community graph a few seconds later', async ({ page }) => {
    test.setTimeout(60_000);
    await onboard(page);
    await joinCommunity(page);
    await expect(page.getByText('No practice shared yet.', { exact: false })).toBeVisible();
    await go(page, '#/home');
    await answerOnce(page);
    await expect(async () => {
      await go(page, '#/home');
      await go(page, '#/people');
      await expect(page.getByText('1 day practised in the last year.', { exact: false })).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
  });

  test('the Progress graph tells what was done on the focused day', async ({ page }) => {
    await onboard(page);
    await answerOnce(page);
    await go(page, '#/progress');
    await page.getByRole('grid', { name: 'Practice per day, last 53 weeks' }).focus();
    await expect(page.locator('.graph-tip')).toHaveText(/^\d{1,2} [A-Z][a-z]{2}: 1 answer, 0 reviews$/);
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.graph-tip')).toHaveText(/^\d{1,2} [A-Z][a-z]{2}: no practice$/);
  });
});

test.describe('as a seeded moderator', () => {
  test.use({ social: 'moderation' });

  test('badges show on People; a main language becomes a badge', async ({ page }) => {
    await onboard(page);
    await go(page, '#/people');
    const badges = page.locator('.profile').getByRole('list', { name: 'Badges', exact: true });
    for (const name of ['Moderator', 'Founding member', 'Back end', 'Python', '7-day streak']) await expect(badges.getByText(name, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.getByRole('button', { name: 'java as a main technology' }).click();
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(badges.getByText('Java', { exact: true })).toBeVisible();
  });

  test('hiding progress from others keeps it in the owner\'s own view', async ({ page }) => {
    await onboard(page);
    await go(page, '#/people');
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.getByRole('checkbox', { name: 'Show my practice graph and progress badges to other members' }).uncheck();
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Only you see this.', { exact: false })).toBeVisible();
    await expect(page.getByText('10 days practised in the last year.', { exact: false })).toBeVisible();
    await expect(page.locator('.profile').getByText('7-day streak')).toBeVisible();
  });
});

test('the whole year fits at 960 px; at 900 px it scrolls to the most recent weeks', async ({ page }) => {
  await onboard(page);
  await answerOnce(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await go(page, '#/progress');
  await page.locator('.graph').waitFor();
  // 900 px is the smallest window: the year is a little wider than the column there.
  await page.setViewportSize({ width: 900, height: 640 });
  await expect(async () => {
    const [left, width, client] = await page.locator('.graph-scroll').evaluate((e) => [e.scrollLeft, e.scrollWidth, e.clientWidth]);
    expect(width).toBeGreaterThan(client);
    expect(left + client).toBeGreaterThanOrEqual(width - 1);
  }).toPass({ timeout: 3_000 });
  await page.setViewportSize({ width: 960, height: 640 });
  await expect(async () => {
    const [width, client] = await page.locator('.graph-scroll').evaluate((e) => [e.scrollWidth, e.clientWidth]);
    expect(width).toBeLessThanOrEqual(client);
  }).toPass({ timeout: 3_000 });
});

test('member badges do not restyle the expression type pill', async ({ page }) => {
  await onboard(page);
  await answerOnce(page);
  const pill = page.locator('.badge[data-type]').first();
  await pill.waitFor();
  const style = await pill.evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.fontSize, s.paddingLeft, s.backgroundColor];
  });
  expect(style.slice(0, 2)).toEqual(['12px', '8px']);
});
