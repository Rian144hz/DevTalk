// Captures every screen in both themes and two window sizes into .impeccable/review/ for inspection.
import type { Page } from '@playwright/test';
import { join } from 'node:path';
import { answerOnce, expect, joinCommunity, onboard, SAMPLE_ANSWER, test } from './fixtures';
import { asMember, idOf, makeModerator, meterMoves, options, people, personRow, ringLit, roomOf, roomRow } from './room-helpers';

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
    await shoot(page, 'rooms-not-set-up', theme);
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
      await go(page, '#/people/me', 'People');
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
        await page.locator('.photo-row input[type="file"]').setInputFiles(join(__dirname, 'assets', 'photo.png'));
        await page.locator('.photo-row img.avatar[src^="data:"]').waitFor();
        await page.locator('.banner-field input[type="file"]').setInputFiles(join(__dirname, 'assets', 'banner.gif'));
        await page.locator('.banner-field .banner img').waitFor();
        const stack = page.getByLabel('Stack');
        for (const t of ['python', 'java', 'c++', 'docker', 'postgres', 'linux']) { await stack.fill(t); await stack.press('Enter'); }
        await page.getByRole('button', { name: 'python as a main technology' }).click();
        await page.getByRole('button', { name: 'c++ as a main technology' }).click();
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
      const badges = page.getByRole('region', { name: 'Badges', exact: true });
      await badges.getByLabel('Find a member').fill('Sam');
      await badges.getByRole('list', { name: 'Members found' }).getByRole('button').first().click();
      await badges.getByRole('button', { name: /Remove Mentor|Give Mentor/ }).waitFor();
      await badges.scrollIntoViewIfNeeded();
      await shoot(page, 'moderation-badges', theme);
    }
  });

  test('a profile with badges, banner and practice graph', async ({ page }) => {
    await onboard(page);
    await go(page, '#/people/me', 'People');
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.locator('.banner-field input[type="file"]').setInputFiles(join(__dirname, 'assets', 'banner.gif'));
    await page.locator('.banner-field .banner img').waitFor();
    await page.getByRole('button', { name: 'java as a main technology' }).click();
    await page.getByRole('button', { name: 'Save profile' }).click();
    await page.locator('.profile .banner img').waitFor();
    for (const theme of THEMES) {
      await setTheme(page, theme);
      await go(page, '#/people/me', 'People');
      await page.locator('.profile .graph').waitFor();
      await shoot(page, 'people-extras', theme);
      await page.locator('.profile-graph').scrollIntoViewIfNeeded();
      await shoot(page, 'people-graph', theme);
    }
  });
});

test.describe('people', () => {
  test.use({ social: 'people' });

  test('member list, a profile, a followers list and Following', async ({ page }) => {
    test.setTimeout(240_000);
    await onboard(page);
    const rows = page.getByRole('list', { name: 'Members' });
    for (const theme of THEMES) {
      await setTheme(page, theme);
      await go(page, '#/people', 'People');
      await rows.waitFor();
      await shoot(page, 'members', theme);
      await page.getByLabel('Area').selectOption('backend');
      await expect(rows.getByRole('link')).toHaveCount(2);
      await shoot(page, 'members-filtered', theme);
      await page.getByLabel('Area').selectOption('');
      await rows.getByRole('link', { name: /Bia/ }).click();
      await page.getByRole('button', { name: /^(Follow|Stop following) Bia$/ }).waitFor();
      if (await page.getByRole('button', { name: 'Follow Bia', exact: true }).count()) {
        await page.getByRole('button', { name: 'Follow Bia', exact: true }).click();
        await page.getByRole('button', { name: /Like Bia's profile/ }).click();
      }
      await page.getByRole('link', { name: '3 followers' }).waitFor();
      await shoot(page, 'member-profile', theme);
      await page.getByRole('link', { name: '3 followers' }).click();
      await page.getByRole('heading', { name: "Bia's followers" }).waitFor();
      await shoot(page, 'followers', theme);
      await go(page, '#/people/following', 'People');
      await page.getByRole('list', { name: 'Following' }).waitFor();
      await shoot(page, 'following', theme);
    }
  });
});

test.describe('messages', () => {
  test.use({ social: 'people' });

  test('conversation with a correction, a request, the coach check and a first message', async ({ page }) => {
    test.setTimeout(240_000);
    await onboard(page);
    const list = page.getByRole('navigation', { name: 'Conversations' });
    for (const theme of THEMES) {
      await setTheme(page, theme);
      await go(page, '#/messages', 'Messages');
      await list.getByRole('link', { name: /Bia/ }).click();
      const pane = page.getByRole('region', { name: 'Conversation with Bia' });
      await pane.getByText('How was the meeting?').waitFor();
      await shoot(page, 'messages', theme);
      await pane.getByLabel('Message to Bia').fill('Yesterday I have fixed the bug, so we can discuss about the release.');
      await pane.getByRole('button', { name: 'Check with the coach' }).click();
      await pane.getByRole('region', { name: 'The coach on your draft' }).waitFor();
      await shoot(page, 'chat-check', theme);
      await pane.getByRole('button', { name: 'Keep mine' }).click();
      await pane.getByLabel('Message to Bia').fill('');
      await list.getByRole('link', { name: /Ana/ }).click();
      await page.getByRole('region', { name: 'Conversation with Ana' }).getByRole('button', { name: 'Accept' }).waitFor();
      await shoot(page, 'chat-request', theme);
      await go(page, '#/people', 'People');
      await page.getByRole('list', { name: 'Members' }).getByRole('link', { name: /Caio/ }).click();
      await page.getByRole('link', { name: 'Send message' }).click();
      await page.getByRole('heading', { level: 3, name: 'Message Caio' }).waitFor();
      await shoot(page, 'chat-new', theme);
    }
  });
});

test.describe('rooms', () => {
  // Chromium's fake microphone, and seeded people who never answer a call: their rows say "Connecting…" for the whole run.
  test.use({ social: 'people', fakeMedia: true, roomTimeoutMs: '600000' });

  /** Two animation frames: layout has settled after a resize or a theme change. */
  const settled = (page: Page) => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));

  /**
   * The state the page is in now, in both themes and both sizes, with a check that nothing runs off the side of the
   * window. `ready` runs before each capture, for states that come and go on their own.
   */
  async function shootThemes(page: Page, name: string, ready?: () => Promise<unknown>) {
    for (const theme of THEMES) {
      await page.evaluate((t) => { document.documentElement.dataset['theme'] = t; }, theme);
      for (const [w, h] of SIZES) {
        await page.setViewportSize({ width: w, height: h });
        await settled(page);
        const overflow = await page.evaluate(() => Math.max(
          document.documentElement.scrollWidth - window.innerWidth,
          ...[...document.querySelectorAll('main')].map((m) => m.scrollWidth - m.clientWidth),
        ));
        expect(overflow, `${name} ${theme} ${w}: horizontal overflow`).toBeLessThanOrEqual(0);
        await ready?.();
        await page.screenshot({ path: `${OUT}/${name}-${theme}-${w}.png` });
      }
    }
  }

  /**
   * The microphone check with sound on the meter: the fake microphone beeps for a moment each second, far shorter
   * than a capture takes, so the bar is held at a level for the picture. The real meter is tested in rooms.spec.ts.
   */
  const heardMic = async (page: Page) => {
    await meterMoves(page);
    await page.evaluate(() => {
      if (document.querySelector('style[data-shot]')) return;
      const style = document.createElement('style');
      style.dataset['shot'] = '1';
      style.textContent = '.mic-meter-fill { transform: scaleX(0.55) !important; transition: none !important; }';
      document.head.append(style);
    });
  };
  const unfreeze = (page: Page) => page.evaluate(() => document.querySelectorAll('style[data-shot]').forEach((el) => el.remove()));
  const toTop = (page: Page) => page.evaluate(() => {
    document.querySelectorAll('main').forEach((m) => m.scrollTo(0, 0));
    document.scrollingElement?.scrollTo(0, 0);
  });

  test('the list, the create form, the microphone check, a room I host and its options', async ({ page, app, dataDir }) => {
    test.setTimeout(240_000);
    await onboard(page);
    const member = (name: string) => idOf(dataDir, name);
    // A fuller list: Lia's code review, and Max's Free talk Friday, which is full.
    await asMember(app, member('Lia'), 'createRoom', [{ title: 'Pull request review, kindly', theme: 'code_review', level: 'B2' }]);
    await asMember(app, member('Max'), 'createRoom', [{ title: 'Free talk Friday', theme: 'free', level: null }]);
    const friday = roomOf(dataDir, 'Free talk Friday');
    for (const name of ['Edu', 'Iris', 'João', 'Hugo', 'Dani']) await asMember(app, member(name), 'joinRoom', [friday]);

    await go(page, '#/rooms', 'Rooms');
    await expect(page.getByRole('list', { name: 'Live rooms' }).getByRole('listitem')).toHaveCount(3);
    await expect(roomRow(page, 'Free talk Friday')).toContainText('Full');
    await shootThemes(page, 'rooms');

    await roomRow(page, 'Stand-up practice').getByRole('link', { name: 'Join Stand-up practice' }).click();
    await expect(page.getByRole('heading', { name: 'Join Stand-up practice' })).toBeVisible();
    await shootThemes(page, 'room-join', () => heardMic(page));
    await unfreeze(page);
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Create a room' }).click();
    const form = page.getByRole('region', { name: 'Create a room' });
    await form.getByLabel('Title').fill('Mock interview: backend role');
    await form.getByRole('radio', { name: 'Interview' }).click();
    await form.getByLabel('Suggested level').selectOption('B2');
    await shootThemes(page, 'room-create', () => heardMic(page));
    await unfreeze(page);
    await form.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Mock interview: backend role' })).toBeVisible();
    const room = roomOf(dataDir, 'Mock interview: backend role');
    for (const name of ['Ana', 'Dani', 'Hugo']) {
      await asMember(app, member(name), 'joinRoom', [room]);
      await expect(personRow(page, name)).toBeVisible();
    }
    await asMember(app, member('Dani'), 'setRoomMuted', [room, true]);
    await expect(personRow(page, 'Dani')).toContainText('Muted');
    await (await options(page, 'Ana')).getByRole('button', { name: 'Make moderator' }).click();
    await expect(personRow(page, 'Ana')).toContainText('Room moderator');
    const card = page.getByRole('region', { name: 'Idea card' });
    await card.getByRole('button', { name: 'Next card' }).click();
    await expect(card).not.toContainText('Tell me about yourself');
    const timer = page.getByRole('region', { name: 'Timer' });
    await timer.getByRole('button', { name: 'Start a 60 s timer' }).click();
    await expect(timer.getByText(/^\d+ s left$/)).toBeVisible();
    // Your own fake microphone beeps: the speaking ring comes and goes, so each capture waits for it.
    await shootThemes(page, 'room', () => ringLit(page));
    // The card and timer are below the people in a narrow window: the same room, scrolled to them.
    await shootThemes(page, 'room-lower', () => card.evaluate((el) => el.scrollIntoView({ block: 'start' })));
    await toTop(page);

    const hugo = await options(page, 'Hugo');
    await expect(hugo).toBeVisible();
    await shootThemes(page, 'room-options', () => hugo.evaluate((el) => el.scrollIntoView({ block: 'nearest' })));
    await people(page).getByRole('button', { name: 'Options for Hugo' }).click();

    await page.getByRole('button', { name: 'End room' }).click();
    await expect(page.getByRole('group', { name: 'End the room' })).toBeVisible();
    await shootThemes(page, 'room-end');
  });

  test('a room report, as a moderator sees it', async ({ page, app, dataDir }) => {
    test.setTimeout(240_000);
    await onboard(page);
    await go(page, '#/rooms', 'Rooms');
    await roomRow(page, 'Stand-up practice').getByRole('link', { name: 'Join Stand-up practice' }).click();
    await page.getByRole('button', { name: 'Join room' }).click();
    await expect(personRow(page, 'Bia')).toBeVisible();
    await (await options(page, 'Bia')).getByRole('button', { name: 'Report' }).click();
    const dialog = page.getByRole('dialog', { name: 'Report Bia' });
    await dialog.getByLabel('Harassment or bullying').check();
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await page.getByRole('dialog', { name: 'Report sent' }).getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Leave', exact: true }).click();
    await expect(page).toHaveURL(/#\/rooms$/);

    await makeModerator(app, idOf(dataDir, 'Rian'));
    await go(page, '#/moderation', 'Moderation');
    await page.getByRole('list', { name: 'Open reports' }).getByRole('listitem').filter({ hasText: 'Bia' }).getByRole('button').click();
    const context = page.getByRole('region', { name: 'The room' });
    await expect(context.getByRole('list', { name: 'Who was in the room' }).getByRole('listitem')).toHaveCount(3);
    await context.scrollIntoViewIfNeeded();
    await shootThemes(page, 'room-moderation');
  });

  test.describe('a call that cannot connect', () => {
    test.use({ roomTimeoutMs: '3000' });

    test('the notices above a room', async ({ page, app, dataDir }) => {
      await onboard(page);
      await go(page, '#/rooms', 'Rooms');
      await roomRow(page, 'Stand-up practice').getByRole('link', { name: 'Join Stand-up practice' }).click();
      await page.getByRole('button', { name: 'Join room' }).click();
      await asMember(app, idOf(dataDir, 'Bia'), 'muteMember', [roomOf(dataDir, 'Stand-up practice'), idOf(dataDir, 'Rian')]);
      await expect(page.getByText('The host muted you. You can unmute when you are ready.')).toBeVisible();
      await expect(page.getByText('Could not connect to Bia and Caio. Your network may block calls.')).toBeVisible();
      await shootThemes(page, 'room-notices');
    });
  });
});
