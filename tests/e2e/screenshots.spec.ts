// Captures every screen in both themes and two window sizes into .impeccable/review/ for inspection.
import type { Page } from '@playwright/test';
import { join } from 'node:path';
import { answerOnce, expect, joinCommunity, onboard, SAMPLE_ANSWER, test } from './fixtures';

const OUT = '.impeccable/review';
const SIZES = [[1440, 900], [960, 640]] as const;
const THEMES = ['dark', 'light'] as const;

async function shoot(page: Page, name: string, theme: string) {
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/${name}-${theme}-${w}.png` });
  }
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.evaluate((t) => window.devtalk.settings.set({ theme: t }), theme);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function go(page: Page, hash: string, ready: string) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.getByRole('heading', { name: ready }).first().waitFor();
}

test('onboarding', async ({ page }) => {
  for (const theme of THEMES) {
    await page.evaluate((t) => { document.documentElement.dataset['theme'] = t; }, theme);
    await shoot(page, 'onboarding-1', theme);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await shoot(page, 'onboarding-3', theme);
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Back' }).click();
  }
});

test('screens', async ({ page }) => {
  test.setTimeout(240_000);
  await onboard(page);
  await answerOnce(page);
  const feedbackHash = await page.evaluate(() => location.hash);
  await page.getByRole('link', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Get a challenge' }).click();
  await page.getByRole('button', { name: 'Write it' }).waitFor();

  for (const theme of THEMES) {
    await setTheme(page, theme);
    await go(page, '#/home', 'Today');
    await page.getByRole('button', { name: 'Write it' }).waitFor();
    await shoot(page, 'home', theme);
    await page.evaluate(() => { location.hash = '#/practice'; });
    await page.getByRole('textbox', { name: 'Your answer' }).fill(
      'I think we should not add the Redis cache yet. The endpoint already answers in 40 ms, and a cache adds invalidation risk. Could we measure with real traffic first?',
    );
    await shoot(page, 'practice', theme);
    await go(page, feedbackHash, 'Your answer');
    await shoot(page, 'feedback', theme);
    await go(page, '#/review', 'Review');
    await page.getByText('1 of 2').waitFor();
    await shoot(page, 'review', theme);
    await page.keyboard.press('Space');
    await shoot(page, 'review-revealed', theme);
    await go(page, '#/progress', 'Progress');
    await shoot(page, 'progress', theme);
    await go(page, '#/settings', 'Settings');
    await shoot(page, 'settings', theme);
    await go(page, '#/rooms', 'Rooms');
    await shoot(page, 'rooms', theme);
    await page.keyboard.press('Control+k');
    await shoot(page, 'palette', theme);
    await page.keyboard.press('Escape');
  }
  await setTheme(page, 'dark');
  await go(page, '#/home', 'Today');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `${OUT}/desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 960, height: 640 });
  await page.screenshot({ path: `${OUT}/mobile.png`, fullPage: true });
});

test('coach states', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Get a challenge' }).click();
  await page.getByRole('button', { name: 'Write it' }).click();
  for (const theme of THEMES) {
    await page.evaluate((t) => { document.documentElement.dataset['theme'] = t; }, theme);
    await page.getByRole('textbox', { name: 'Your answer' }).fill(`${SAMPLE_ANSWER} I also need to ask about the rate limit on staging.`);
    await page.getByRole('button', { name: 'Get feedback' }).click();
    await page.getByRole('status').filter({ hasText: 'The coach is reading your answer' }).waitFor();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: `${OUT}/feedback-waiting-${theme}-1440.png` });
    await page.getByRole('alert').filter({ hasText: 'usage limit' }).waitFor();
    await shoot(page, 'feedback-error', theme);
    await page.getByRole('button', { name: 'Edit answer' }).click();
  }
});

test('long content does not overflow at 960 px', async ({ page }) => {
  await onboard(page);
  await page.setViewportSize({ width: 960, height: 640 });
  const noOverflow = async () =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.evaluate(() => window.devtalk.settings.set({ model: 'a-very-long-model-name-that-someone-might-type-'.repeat(2).slice(0, 99) }));
  await page.reload();
  await noOverflow();
  await page.getByRole('button', { name: 'Get a challenge' }).click();
  await page.getByRole('button', { name: 'Write it' }).click();
  const long = `${'Supercalifragilisticexpialidocious'.repeat(20)} ${'word '.repeat(700)}`.slice(0, 3999);
  await page.getByRole('textbox', { name: 'Your answer' }).fill(long);
  await noOverflow();
  await page.keyboard.press('Control+Enter');
  await page.locator('.rewrite').waitFor();
  await noOverflow();
  // Coach text can hold long identifiers or URLs: every free-text block must be allowed to break anywhere.
  for (const sel of ['.line-notes', '.expr-meaning', '.expr-example', '.brief-situation', '.rewrite', '.line-text']) {
    expect(await page.locator(sel).first().evaluate((el) => getComputedStyle(el).overflowWrap), sel).toBe('anywhere');
  }
  await page.evaluate(() => { location.hash = '#/settings'; });
  await page.getByRole('heading', { level: 1, name: 'Settings' }).waitFor();
  await noOverflow();
  await page.evaluate(() => { location.hash = '#/progress'; });
  await page.getByRole('heading', { level: 1, name: 'Progress' }).waitFor();
  await noOverflow();
});

test.describe('community', () => {
  test.use({ social: '1' });

  test('join, people, edit profile and account', async ({ page }) => {
    test.setTimeout(240_000);
    await onboard(page);
    for (const theme of THEMES) {
      await setTheme(page, theme);
      await go(page, '#/people', 'People');
      await page.getByRole('button', { name: /Join the community|Edit profile/ }).waitFor();
      if (await page.getByRole('button', { name: 'Join the community' }).count()) {
        await shoot(page, 'people-signed-out', theme);
        await page.getByRole('button', { name: 'Join the community' }).click();
        await page.getByLabel('E-mail').fill('rian@example.com');
        await shoot(page, 'join-1', theme);
        await page.getByRole('button', { name: 'Send code' }).click();
        await page.getByLabel('Code').fill('123456');
        await shoot(page, 'join-2', theme);
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.getByRole('checkbox', { name: 'I accept the Terms of use' }).check();
        await shoot(page, 'join-3', theme);
        for (const l of ['I accept the Privacy policy', 'I accept the Code of conduct', 'I am 18 or older']) await page.getByRole('checkbox', { name: l }).check();
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.getByLabel('Display name').fill('Rian');
        await shoot(page, 'join-4', theme);
        await page.getByRole('button', { name: 'Join' }).click();
        await page.getByRole('heading', { level: 2, name: 'Rian' }).waitFor();
        await page.getByRole('button', { name: 'Edit profile' }).click();
        await page.locator('input[type="file"]').setInputFiles(join(__dirname, 'assets', 'photo.png'));
        await page.locator('.profile-form img.avatar').waitFor();
        const stack = page.getByLabel('Stack');
        for (const t of ['python', 'java', 'c++', 'docker', 'postgres', 'linux']) { await stack.fill(t); await stack.press('Enter'); }
        await page.getByRole('button', { name: 'Add a time' }).click();
        await page.getByLabel('About you (optional)').fill('CS student. I write Python and C++ and want to speak up in code reviews.');
        await page.getByRole('button', { name: 'Save profile' }).click();
        await page.locator('.profile img.avatar').waitFor();
      }
      await shoot(page, 'people', theme);
      await page.getByRole('button', { name: 'Edit profile' }).click();
      await page.getByRole('heading', { level: 1, name: 'Edit profile' }).waitFor();
      await shoot(page, 'edit-profile', theme);
      await go(page, '#/legal/privacy', 'Privacy policy');
      await shoot(page, 'legal-privacy', theme);
      await go(page, '#/settings', 'Settings');
      await page.getByRole('region', { name: 'Account' }).scrollIntoViewIfNeeded();
      await page.getByRole('button', { name: 'Delete my account…' }).click();
      await page.getByRole('region', { name: 'Account' }).scrollIntoViewIfNeeded();
      await shoot(page, 'settings-account', theme);
      await page.getByRole('button', { name: 'Cancel' }).click();
    }
  });

  test('worst-case profile does not overflow at 960 px', async ({ page }) => {
    await onboard(page);
    await joinCommunity(page, 'Maximiliano-Bartholomew-Wolfeschlegel-X');
    await page.getByRole('button', { name: 'Edit profile' }).click();
    const stack = page.getByLabel('Stack');
    for (const t of ['an-internal-library-with-a-long', 'kubernetes', 'react native', 'scikit-learn', 'apache kafka', 'tensorflow', 'postgresql', 'github actions', 'elasticsearch', 'typescript']) {
      await stack.fill(t);
      await stack.press('Enter');
    }
    await page.getByLabel('About you (optional)').fill('x'.repeat(160));
    await page.getByRole('button', { name: 'Save profile' }).click();
    await page.getByRole('heading', { level: 2, name: 'Maximiliano-Bartholomew-Wolfeschlegel-X' }).waitFor();
    await page.setViewportSize({ width: 960, height: 640 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `${OUT}/people-worst-dark-960.png`, fullPage: true });
  });
});

test.describe('moderation', () => {
  test.use({ social: 'moderation' });

  test('queue and a selected report', async ({ page }) => {
    await onboard(page);
    for (const theme of THEMES) {
      await setTheme(page, theme);
      await go(page, '#/moderation', 'Moderation');
      await page.getByRole('list', { name: 'Open reports' }).getByRole('listitem').first().getByRole('button').click();
      await page.getByRole('heading', { level: 2, name: /Report about/ }).waitFor();
      await shoot(page, 'moderation', theme);
    }
  });
});
