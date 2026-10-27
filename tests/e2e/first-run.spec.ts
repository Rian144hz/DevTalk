// The first run after the splash: welcome, GitHub or e-mail sign-in, the community steps, then the coach setup.
// The fake community signs in with GitHub at once as octo@example.com ("Octo Dev", with a photo) and opens no browser.
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, onboard, test } from './fixtures';

const welcome = (page: Page) => page.getByRole('heading', { level: 1, name: 'Practise the English you use at work.' });
const github = (page: Page) => page.getByRole('button', { name: 'Continue with GitHub' });
const email = (page: Page) => page.getByRole('button', { name: 'Continue with e-mail' });
const local = (page: Page) => page.getByRole('button', { name: 'Practise without an account' });
const waiting = (page: Page) => page.getByText('Finish signing in in your browser.');
const coach = (page: Page) => page.getByRole('heading', { level: 1, name: 'Set up your coach' });
const today = (page: Page) => page.getByRole('heading', { level: 1, name: 'Today' });
const alerts = (page: Page) => page.getByRole('alert');

async function acceptRules(page: Page): Promise<void> {
  await expect(page.getByText('Step 3 of 4')).toBeVisible();
  for (const label of ['I accept the Terms of use', 'I accept the Privacy policy', 'I accept the Code of conduct', 'I am 18 or older']) {
    await page.getByRole('checkbox', { name: label }).check();
  }
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Step 4 of 4')).toBeVisible();
}

/** The three coach steps with their defaults, up to Today. */
async function finishCoachSetup(page: Page): Promise<void> {
  await expect(coach(page)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Start practising' }).click();
  await expect(today(page)).toBeVisible();
}

/**
 * Holds the next GitHub sign-in in the main process like a browser tab that is still open. Cancel ends the wait the
 * way the real listener does ('not-finished'), or lets a sign-in that was already exchanging finish ('signed-in').
 * `globalThis.__releaseSignIn` ends the wait without a Cancel, like the five minutes running out.
 */
async function holdSignIn(app: ElectronApplication, onCancel: 'not-finished' | 'signed-in'): Promise<void> {
  await app.evaluate(({ ipcMain }, mode) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => Promise<unknown>> })._invokeHandlers;
    const real = handlers.get('social:signInWithGitHub')!;
    let open!: (outcome: 'not-finished' | 'signed-in') => void;
    const gate = new Promise<'not-finished' | 'signed-in'>((resolve) => { open = resolve; });
    ipcMain.removeHandler('social:signInWithGitHub');
    ipcMain.handle('social:signInWithGitHub', async (event, ...args) => {
      const outcome = await gate;
      return outcome === 'signed-in'
        ? real(event, ...args)
        : { ok: false, error: { kind: 'internal', message: 'Sign-in was not finished. Try again.' } };
    });
    ipcMain.removeHandler('social:cancelSignIn');
    ipcMain.handle('social:cancelSignIn', () => {
      open(mode);
      return { ok: true, data: null };
    });
    (globalThis as unknown as { __releaseSignIn: typeof open }).__releaseSignIn = open;
  }, onCancel);
}

test.describe('not configured', () => {
  test('a build without a community offers only Practise without an account', async ({ app, page }) => {
    // Whether the build has a community depends on the developer's .env, so say it here the way the main process does.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('social:status');
      ipcMain.handle('social:status', () => ({
        ok: true,
        data: { configured: false, signedIn: false, email: null, needsDocuments: false, hasProfile: false, suspendedUntil: null },
      }));
    });
    await page.reload();
    await expect(welcome(page)).toBeVisible();
    await expect(page.getByText('A coach marks your writing, and other developers talk with you.')).toBeVisible();
    await expect(local(page)).toBeVisible();
    await expect(github(page)).toHaveCount(0);
    await expect(email(page)).toHaveCount(0);
    await local(page).click();
    await finishCoachSetup(page);
  });
});

test.describe('with the fake community', () => {
  test.use({ social: '1' });

  test('the welcome offers GitHub first, then e-mail, then practising without an account', async ({ page }) => {
    await expect(welcome(page)).toBeVisible();
    const boxes = await Promise.all([github(page), email(page), local(page)].map((b) => b.boundingBox()));
    const [g, e, l] = boxes;
    expect(g && e && l).toBeTruthy();
    expect(g!.y).toBeLessThan(e!.y);
    expect(e!.y).toBeLessThan(l!.y);
    await expect(github(page).locator('svg path')).toHaveCount(1);
    await expect(github(page)).toHaveClass(/btn-primary/);
    await expect(email(page)).toHaveClass(/btn-secondary/);
    await expect(local(page)).toHaveClass(/btn-quiet/);
  });

  test('GitHub: rules, a profile suggested by GitHub, coach setup, then Today', async ({ page }) => {
    await github(page).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Join the community' })).toBeVisible();
    await acceptRules(page);

    // Name and photo come from GitHub and are only previews: nothing is saved until Join.
    await expect(page.getByLabel('Display name')).toHaveValue('Octo Dev');
    await expect(page.locator('.photo-row img.avatar')).toBeVisible();
    await expect(page.getByText('From your GitHub account')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove photo' })).toBeVisible();
    expect(await page.evaluate(() => window.devtalk.social.getProfile())).toEqual({ ok: true, data: null });

    await page.getByRole('button', { name: 'Join' }).click();
    await finishCoachSetup(page);

    const mine = await page.evaluate(() => window.devtalk.social.getProfile());
    expect(mine).toMatchObject({ ok: true, data: { displayName: 'Octo Dev', hasAvatar: true } });
  });

  test('the suggested name can be changed and the photo removed before saving', async ({ page }) => {
    await github(page).click();
    await acceptRules(page);
    await page.getByLabel('Display name').fill('Octavia');
    await page.getByRole('button', { name: 'Remove photo' }).click();
    await expect(page.getByText('From your GitHub account')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add photo' })).toBeVisible();
    await page.getByRole('button', { name: 'Join' }).click();
    await finishCoachSetup(page);
    expect(await page.evaluate(() => window.devtalk.social.getProfile())).toMatchObject({ ok: true, data: { displayName: 'Octavia', hasAvatar: false } });
  });

  test('e-mail: the code, the rules, an empty profile (nothing from GitHub), coach setup, then Today', async ({ page }) => {
    await email(page).click();
    await expect(page.getByText('Step 1 of 4')).toBeVisible();
    await page.getByLabel('E-mail').fill('rian@example.com');
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByText('Step 2 of 4')).toBeVisible();
    await page.getByLabel('Code').fill('123456');
    await page.getByRole('button', { name: 'Continue' }).click();
    await acceptRules(page);
    await expect(page.getByLabel('Display name')).toHaveValue('');
    await expect(page.getByText('From your GitHub account')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add photo' })).toBeVisible();
    await page.getByLabel('Display name').fill('Rian');
    await page.getByRole('button', { name: 'Join' }).click();
    await finishCoachSetup(page);
  });

  test('e-mail step 1 also offers GitHub, and Back returns to the welcome screen', async ({ page }) => {
    await email(page).click();
    await expect(github(page)).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(welcome(page)).toBeVisible();
    await expect(github(page)).toBeVisible();
  });

  test('GitHub from the e-mail step carries on with the rules', async ({ page }) => {
    await email(page).click();
    await github(page).click();
    await acceptRules(page);
    await expect(page.getByLabel('Display name')).toHaveValue('Octo Dev');
  });

  test('Practise without an account goes to the coach setup, then Today, with no community account', async ({ page }) => {
    await local(page).click();
    await finishCoachSetup(page);
    expect(await page.evaluate(() => window.devtalk.social.status())).toMatchObject({ ok: true, data: { configured: true, signedIn: false } });
  });

  test('a rules document opens in full and Back to joining keeps the ticks', async ({ page }) => {
    await email(page).click();
    await page.getByLabel('E-mail').fill('rian@example.com');
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByLabel('Code').fill('123456');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('checkbox', { name: 'I am 18 or older' }).check();
    await page.getByRole('link', { name: 'Read the Privacy policy' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible();
    await page.getByRole('link', { name: 'Back to joining' }).click();
    await expect(page.getByText('Step 3 of 4')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'I am 18 or older' })).toBeChecked();
  });

  test('Skip for now at the rules leaves the join and goes to the coach setup', async ({ page }) => {
    await github(page).click();
    await expect(page.getByText('Step 3 of 4')).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await finishCoachSetup(page);
  });

  test('a GitHub account that accepted the rules and has a profile goes straight to the coach setup', async ({ app, page }) => {
    // The member joined before (another computer, or a reinstall): the account exists and the documents are accepted.
    await app.evaluate(async () => {
      const fake = (globalThis as unknown as { __devtalkFakeSocial: Record<string, (...args: unknown[]) => Promise<unknown>> }).__devtalkFakeSocial;
      await fake['signInWithGitHub']!({ openExternal: async () => undefined });
      await fake['acceptDocuments']!();
      await fake['saveProfile']!({
        displayName: 'Octo Dev', nativeLanguage: 'Portuguese (Brazil)', level: 'B1', timezone: 'UTC', area: 'backend', stack: [],
        availability: [], bio: '', mainStack: [], showProgress: true, mascot: null, listed: true,
      });
      await fake['signOut']!();
    });
    await github(page).click();
    await expect(coach(page)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Join the community' })).toHaveCount(0);
    await finishCoachSetup(page);
  });

  test.describe('waiting for the browser', () => {
    test('shows the wait with a Cancel; Cancel returns to the buttons without an error', async ({ app, page }) => {
      await holdSignIn(app, 'not-finished');
      await github(page).click();
      await expect(waiting(page)).toBeVisible();
      await expect(github(page)).toHaveCount(0);
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(github(page)).toBeVisible();
      await expect(waiting(page)).toHaveCount(0);
      await expect(alerts(page)).toHaveCount(0);
      await expect(github(page)).toBeFocused();
    });

    test('a Cancel that lands during the code exchange still signs in and carries on', async ({ app, page }) => {
      await holdSignIn(app, 'signed-in');
      await github(page).click();
      await expect(waiting(page)).toBeVisible();
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByText('Step 3 of 4')).toBeVisible();
    });

    test('the sign-in running out of time (no Cancel) says so on the welcome screen', async ({ app, page }) => {
      await holdSignIn(app, 'not-finished');
      await github(page).click();
      await expect(waiting(page)).toBeVisible();
      await app.evaluate(() => (globalThis as unknown as { __releaseSignIn: (o: string) => void }).__releaseSignIn('not-finished'));
      await expect(alerts(page)).toContainText('Sign-in was not finished. Try again.');
      await expect(github(page)).toBeVisible();
    });
  });
});

test.describe('a GitHub sign-in that fails', () => {
  test.use({ social: '1', socialFail: 'signInWithGitHub' });

  test('shows the message on the welcome screen and can be tried again', async ({ page }) => {
    await expect(welcome(page)).toBeVisible();
    await github(page).click();
    await expect(alerts(page)).toContainText('You are offline.');
    await expect(welcome(page)).toBeVisible();
    await expect(github(page)).toBeVisible();
    await expect(waiting(page)).toHaveCount(0);
    await github(page).click();
    await expect(alerts(page)).toContainText('You are offline.');
    await local(page).click();
    await finishCoachSetup(page);
  });

  test('shows the message in People › Join as well', async ({ page }) => {
    await onboard(page);
    await page.evaluate(() => { location.hash = '#/join'; });
    await github(page).click();
    await expect(alerts(page)).toContainText('You are offline.');
    await expect(page.getByLabel('E-mail')).toBeVisible();
  });
});

test.describe('People › Join', () => {
  test.use({ social: '1' });

  test('step 1 has Continue with GitHub above the e-mail field, and GitHub signs in there', async ({ page }) => {
    await onboard(page);
    await page.evaluate(() => { location.hash = '#/join'; });
    await expect(page.getByText('Step 1 of 4')).toBeVisible();
    const g = await github(page).boundingBox();
    const f = await page.getByLabel('E-mail').boundingBox();
    expect(g && f).toBeTruthy();
    expect(g!.y).toBeLessThan(f!.y);
    await expect(page.getByText('or', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(0);

    await github(page).click();
    await acceptRules(page);
    await expect(page.getByLabel('Display name')).toHaveValue('Octo Dev');
    await expect(page.getByText('From your GitHub account')).toBeVisible();
    await page.getByRole('button', { name: 'Join' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Octo Dev' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit profile' })).toBeVisible();
  });

  test('waits for the browser with a Cancel', async ({ app, page }) => {
    await onboard(page);
    await page.evaluate(() => { location.hash = '#/join'; });
    await holdSignIn(app, 'not-finished');
    await github(page).click();
    await expect(waiting(page)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByLabel('E-mail')).toBeVisible();
    await expect(alerts(page)).toHaveCount(0);
  });
});

test.describe('a status that is slow to load', () => {
  test.use({ social: '1' });

  test('the welcome screen does not wait for it for long: Practise without an account shows meanwhile', async ({ app, page }) => {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('social:status');
      ipcMain.handle('social:status', () => new Promise(() => undefined));
    });
    await page.reload();
    await expect(welcome(page)).toBeVisible({ timeout: 10_000 });
    await expect(local(page)).toBeVisible();
    await expect(github(page)).toHaveCount(0);
    await local(page).click();
    await finishCoachSetup(page);
  });
});
