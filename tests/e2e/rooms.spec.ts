// Phase 2C — voice rooms against the seeded fake community (signed in as Rian) with Chromium's fake microphone.
// Bia hosts "Stand-up practice" with Caio inside; seeded people never answer WebRTC signals, so they end up as
// "Could not connect" after the shortened timeout. Other members act through the fake community in the main process.
import type { Locator, Page } from '@playwright/test';
import { expect, onboard, test } from './fixtures';
import { asMember, controls, go, idOf, makeModerator, meterMoves, muteButton, options, people, personRow, roomOf, roomRow, unmuteButton } from './room-helpers';

async function joinStandup(page: Page): Promise<void> {
  await go(page, '#/rooms');
  await roomRow(page, 'Stand-up practice').getByRole('link', { name: 'Join Stand-up practice' }).click();
  await expect(page.getByRole('heading', { name: 'Join Stand-up practice' })).toBeVisible();
  await page.getByRole('button', { name: 'Join room' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Stand-up practice' })).toBeVisible();
}

test.use({ social: 'people', fakeMedia: true, roomTimeoutMs: '3000' });

test('the list, the microphone check and the room: people, card, timer, mute, a peer who never answers, leave', async ({ page, app, dataDir }) => {
  await onboard(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Rooms' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Rooms' })).toBeVisible();
  const row = roomRow(page, 'Stand-up practice');
  await expect(row).toContainText('2 / 6');
  await expect(row).toContainText('Stand-up, B1');
  // The window may use the microphone, never the camera.
  const camera = await page.evaluate(() => navigator.mediaDevices.getUserMedia({ video: true }).then(() => 'allowed', (e: Error) => e.name));
  expect(camera).toBe('NotAllowedError');

  await row.getByRole('link', { name: 'Join Stand-up practice' }).click();
  await expect(page.getByRole('heading', { name: 'Join Stand-up practice' })).toBeVisible();
  // Chromium's fake microphone beeps: the meter moves.
  await meterMoves(page);
  await page.getByRole('button', { name: 'Join room' }).click();

  const room = roomOf(dataDir, 'Stand-up practice');
  await expect(page.getByRole('heading', { level: 1, name: 'Stand-up practice' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/rooms/${room}$`));
  await expect(personRow(page, 'Bia')).toContainText('Host');
  await expect(personRow(page, 'Caio')).toBeVisible();
  await expect(personRow(page, 'Rian')).toContainText('You');
  // Inside a room, Rooms in the rail, Ctrl+6 and "Go to Rooms" bring you back to the room, not the list.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Rooms' }).click();
  await expect(page).toHaveURL(new RegExp(`#/rooms/${room}$`));
  await expect(personRow(page, 'Bia')).toBeVisible();
  await expect(muteButton(page)).toBeVisible();
  await page.keyboard.press('Control+6');
  await expect(page).toHaveURL(new RegExp(`#/rooms/${room}$`));
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Go to Rooms');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`#/rooms/${room}$`));
  await expect(personRow(page, 'Caio')).toBeVisible();
  expect(((await asMember(app, idOf(dataDir, 'Bia'), 'roomState', [room])) as { people: unknown[] }).people).toHaveLength(3);
  // The fake microphone beeps: your speaking ring lights up.
  // (Polled fast: it is lit for a moment once a second, as often as a default wait looks.)
  await expect.poll(() => personRow(page, 'Rian').getByText('Speaking', { exact: true }).count(), { intervals: [30], timeout: 10_000 }).toBeGreaterThan(0);

  const card = page.getByRole('region', { name: 'Idea card' });
  await expect(card).toContainText('What did you finish yesterday?');
  await card.getByRole('button', { name: 'Next card' }).click();
  await expect(card).toContainText('What will you work on today?');
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByRole('button', { name: 'Start a 60 s timer' }).click();
  const left = async () => Number((await timer.getByText(/^\d+ s left$/).textContent())!.match(/^\d+/)![0]);
  const first = await left();
  expect(first).toBeGreaterThanOrEqual(50);
  expect(first).toBeLessThanOrEqual(60);
  await expect.poll(left).toBeLessThan(first);
  await expect(timer.getByRole('button', { name: 'Stop' })).toBeVisible();
  // Everyone sees the same card and timer: Bia's copy of the room.
  const seen = (await asMember(app, idOf(dataDir, 'Bia'), 'roomState', [room])) as { card: number; timer: { seconds: number } | null };
  expect(seen.card).toBe(1);
  expect(seen.timer?.seconds).toBe(60);

  await muteButton(page).click();
  await expect(unmuteButton(page)).toBeVisible();
  await expect(personRow(page, 'Rian')).toContainText('Muted');
  // Muted, the microphone sends silence: no speaking ring through several beeps.
  for (let i = 0; i < 15; i++) {
    await expect(personRow(page, 'Rian').getByText('Speaking', { exact: true })).toHaveCount(0);
    await page.waitForTimeout(100);
  }
  await page.keyboard.press('Control+m');
  await expect(muteButton(page)).toBeVisible();
  await page.keyboard.press('Control+m');
  await expect(unmuteButton(page)).toBeVisible();

  // Seeded people never answer: after the (shortened) timeout the room says so, and the call goes on.
  await expect(page.getByText('Could not connect to Bia and Caio. Your network may block calls.')).toBeVisible();

  await page.getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(page).toHaveURL(/#\/rooms$/);
  await expect(roomRow(page, 'Stand-up practice')).toContainText('2 / 6');
  // Outside a room Ctrl+M does nothing here.
  await expect(muteButton(page)).toHaveCount(0);
});

test('with the keyboard, a focused control and a person\'s options stay above the bar, even in a small window', async ({ page }) => {
  await onboard(page);
  await page.setViewportSize({ width: 960, height: 520 });
  await joinStandup(page);
  const above = async (target: Locator) => {
    const [box, bar] = await Promise.all([target.boundingBox(), controls(page).boundingBox()]);
    return box !== null && bar !== null && box.y >= 0 && box.y + box.height <= bar.y + 1;
  };
  // The bar is sticky: focus and the opening panel scroll with it in mind instead of hiding under it.
  const button = people(page).getByRole('button', { name: 'Options for Caio' });
  await button.focus();
  await expect.poll(() => above(button)).toBe(true);
  await page.keyboard.press('Enter');
  const panel = page.getByRole('group', { name: 'Options for Caio' });
  await expect(panel.getByRole('button', { name: 'Report' })).toBeVisible();
  await expect.poll(() => above(panel)).toBe(true);
});

test('the host mutes Rian, who can unmute; then she removes him and he is back on the list', async ({ page, app, dataDir }) => {
  await onboard(page);
  await joinStandup(page);
  const bia = idOf(dataDir, 'Bia');
  const rian = idOf(dataDir, 'Rian');
  const room = roomOf(dataDir, 'Stand-up practice');

  await asMember(app, bia, 'muteMember', [room, rian]);
  await expect(page.getByText('The host muted you. You can unmute when you are ready.')).toBeVisible();
  await expect(unmuteButton(page)).toBeVisible();
  await unmuteButton(page).click();
  await expect(muteButton(page)).toBeVisible();
  await expect(page.getByText('The host muted you.')).toHaveCount(0);

  await asMember(app, bia, 'removeFromRoom', [room, rian]);
  await expect(page).toHaveURL(/#\/rooms$/);
  await expect(page.getByText('You were removed from this room.')).toBeVisible();
  // He cannot come back: the room is no longer in his list.
  await expect(page.getByRole('heading', { level: 1, name: 'Rooms' })).toBeVisible();
  await expect(roomRow(page, 'Stand-up practice')).toHaveCount(0);
});

test('everyone sees who is muted: Bia mutes herself, and Rian\'s own Mute reaches the room', async ({ page, app, dataDir }) => {
  await onboard(page);
  await joinStandup(page);
  const bia = idOf(dataDir, 'Bia');
  const rian = idOf(dataDir, 'Rian');
  const room = roomOf(dataDir, 'Stand-up practice');
  await expect(personRow(page, 'Bia').locator('.room-person-muted')).toHaveCount(0);
  await asMember(app, bia, 'setRoomMuted', [room, true]);
  await expect(personRow(page, 'Bia').locator('.room-person-muted')).toBeVisible();
  await expect(personRow(page, 'Bia')).toContainText('Muted');
  await asMember(app, bia, 'setRoomMuted', [room, false]);
  await expect(personRow(page, 'Bia').locator('.room-person-muted')).toHaveCount(0);

  const rianSeenByBia = async () =>
    ((await asMember(app, bia, 'roomState', [room])) as { people: { id: string; muted: boolean }[] }).people.find((p) => p.id === rian)!.muted;
  await muteButton(page).click();
  await expect.poll(rianSeenByBia).toBe(true);
  await page.keyboard.press('Control+m');
  await expect.poll(rianSeenByBia).toBe(false);
});

test('Rian opens a room; Ana joins, becomes room moderator, is removed and cannot come back', async ({ page, app, dataDir }) => {
  await onboard(page);
  await go(page, '#/rooms');
  await page.getByRole('button', { name: 'Create a room' }).click();
  const form = page.getByRole('region', { name: 'Create a room' });
  await form.getByLabel('Title').fill('Mock interview');
  await form.getByRole('radio', { name: 'Interview' }).click();
  await form.getByLabel('Suggested level').selectOption('B2');
  await expect(form.getByRole('meter', { name: 'Microphone level' })).toBeVisible();
  await form.getByRole('button', { name: 'Create', exact: true }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Mock interview' })).toBeVisible();
  await expect(personRow(page, 'Rian')).toContainText('Host');
  await expect(page.getByRole('region', { name: 'Idea card' })).toContainText('Tell me about yourself');
  const ana = idOf(dataDir, 'Ana');
  const room = roomOf(dataDir, 'Mock interview');
  await expect(page).toHaveURL(new RegExp(`#/rooms/${room}$`));

  await asMember(app, ana, 'joinRoom', [room]);
  await expect(personRow(page, 'Ana')).toBeVisible();
  await expect(page.getByText('Ana joined.')).toBeVisible();

  await (await options(page, 'Ana')).getByRole('button', { name: 'Make moderator' }).click();
  await expect(personRow(page, 'Ana')).toContainText('Room moderator');

  await (await options(page, 'Ana')).getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('group', { name: 'Remove Ana' }).getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(personRow(page, 'Ana')).toHaveCount(0);
  await expect(page.getByText('Ana was removed from the room.')).toBeVisible();
  await expect(asMember(app, ana, 'joinRoom', [room])).rejects.toThrow(/not allowed/);
  await expect(personRow(page, 'Ana')).toHaveCount(0);

  await page.getByRole('button', { name: 'End room' }).click();
  await page.getByRole('group', { name: 'End the room' }).getByRole('button', { name: 'End room' }).click();
  await expect(page).toHaveURL(/#\/rooms$/);
  await expect(page.getByText('You ended the room.')).toBeVisible();
  await expect(roomRow(page, 'Mock interview')).toHaveCount(0);
  const ended = (await asMember(app, ana, 'roomState', [room])) as { endedAt: string | null };
  expect(ended.endedAt).not.toBeNull();
});

test('options in two groups; closing a panel or a question puts focus back on the button that opened it', async ({ page, app, dataDir }) => {
  await onboard(page);
  await go(page, '#/rooms');
  await page.getByRole('button', { name: 'Create a room' }).click();
  const form = page.getByRole('region', { name: 'Create a room' });
  await form.getByLabel('Title').fill('Focus check');
  await meterMoves(page);
  await form.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Focus check' })).toBeVisible();
  await asMember(app, idOf(dataDir, 'Ana'), 'joinRoom', [roomOf(dataDir, 'Focus check')]);
  await expect(personRow(page, 'Ana')).toBeVisible();

  const row = personRow(page, 'Ana');
  const optionsButton = row.getByRole('button', { name: 'Options for Ana' });
  const button = (name: string) => row.getByRole('button', { name, exact: true });

  // What is about you comes first; what the host can do to the room is its own row, with its own wording.
  const panel = await options(page, 'Ana');
  for (const name of ['Mute for me', 'Report', 'Block Ana', 'Mute for everyone', 'Make moderator', 'Make host', 'Remove']) {
    await expect(panel.getByRole('button', { name, exact: true })).toBeVisible();
  }
  // Escape on the Options button closes the panel and focus stays there.
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(optionsButton).toBeFocused();

  // Escape inside the panel closes it and puts focus back on Options.
  await optionsButton.click();
  await button('Report').focus();
  await page.keyboard.press('Escape');
  await expect(row.getByRole('group', { name: 'Options for Ana' })).toHaveCount(0);
  await expect(optionsButton).toBeFocused();

  // A question (Make host, Remove) closes with Escape or Cancel and focus returns to the button that asked it.
  await optionsButton.click();
  for (const name of ['Make host', 'Remove']) {
    await button(name).click();
    const question = row.getByRole('group', { name: name === 'Remove' ? 'Remove Ana' : 'Make Ana the host' });
    await expect(question).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(question).toHaveCount(0);
    await expect(button(name)).toBeFocused();
    await button(name).click();
    await row.getByRole('button', { name: 'Cancel' }).click();
    await expect(question).toHaveCount(0);
    await expect(button(name)).toBeFocused();
  }

  // Block asks too; Cancel puts focus back on Block.
  await button('Block Ana').click();
  await row.getByRole('group', { name: 'Block Ana' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(button('Block Ana')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(row.getByRole('group', { name: 'Options for Ana' })).toHaveCount(0);
  await expect(optionsButton).toBeFocused();

  // End room asks as well: Escape and Cancel return to End room.
  const endRoom = controls(page).getByRole('button', { name: 'End room', exact: true });
  await endRoom.click();
  const ending = page.getByRole('group', { name: 'End the room' });
  await expect(ending).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(ending).toHaveCount(0);
  await expect(endRoom).toBeFocused();
  await endRoom.click();
  await ending.getByRole('button', { name: 'Cancel' }).click();
  await expect(ending).toHaveCount(0);
  await expect(endRoom).toBeFocused();
});

test('leaving the room page leaves the room; blocking someone inside makes you leave, and the room is hidden', async ({ page, app, dataDir }) => {
  await onboard(page);
  const room = roomOf(dataDir, 'Stand-up practice');
  const bia = idOf(dataDir, 'Bia');
  const livePeople = async () => ((await asMember(app, bia, 'roomState', [room])) as { people: { displayName: string }[] }).people.map((p) => p.displayName);

  await joinStandup(page);
  expect(await livePeople()).toEqual(['Bia', 'Caio', 'Rian']);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'People' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible();
  await expect.poll(livePeople).toEqual(['Bia', 'Caio']);

  await joinStandup(page);
  await page.goBack();
  await expect(page).toHaveURL(/#\/rooms$/);
  await expect.poll(livePeople).toEqual(['Bia', 'Caio']);

  await joinStandup(page);
  const caio = await options(page, 'Caio');
  await caio.getByRole('button', { name: 'Block Caio' }).click();
  await caio.getByRole('group', { name: 'Block Caio' }).getByRole('button', { name: 'Block', exact: true }).click();
  await expect(page).toHaveURL(/#\/rooms$/);
  await expect(page.getByText('You blocked Caio and left the room.')).toBeVisible();
  await expect.poll(livePeople).toEqual(['Bia', 'Caio']);
  await expect(roomRow(page, 'Stand-up practice')).toHaveCount(0);
});

test('room titles are plain text, also right to left', async ({ page, app, dataDir }) => {
  await onboard(page);
  const title = '<b>x</b> مرحبا بالجميع';
  await asMember(app, idOf(dataDir, 'Ana'), 'createRoom', [{ title, theme: 'free', level: null }]);
  await go(page, '#/rooms');
  const row = roomRow(page, '<b>x</b>');
  await expect(row.getByText(title)).toBeVisible();
  await expect(row.getByText(title)).toHaveAttribute('dir', 'auto');
  await expect(row.locator('b')).toHaveCount(0);
  await expect(row).toContainText('Free talk, any level');

  await row.getByRole('link', { name: `Join ${title}` }).click();
  await page.getByRole('button', { name: 'Join room' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  await expect(page.locator('main b')).toHaveCount(0);
  await expect(personRow(page, 'Ana')).toContainText('Host');
});

test('a room with 6 people shows Full instead of Join', async ({ page, app, dataDir }) => {
  await onboard(page);
  const room = roomOf(dataDir, 'Stand-up practice');
  for (const name of ['Ana', 'Dani', 'Hugo', 'Iris']) await asMember(app, idOf(dataDir, name), 'joinRoom', [room]);
  await go(page, '#/rooms');
  const row = roomRow(page, 'Stand-up practice');
  await expect(row).toContainText('6 / 6');
  await expect(row).toContainText('Full');
  await expect(row.getByRole('link', { name: /Join/ })).toHaveCount(0);
});

test('a report made in the room shows the room to a moderator', async ({ page, app, dataDir }) => {
  await onboard(page);
  await joinStandup(page);
  // Mute for me is yours only: Bia's voice is silenced in this window.
  const bia = await options(page, 'Bia');
  await bia.getByRole('button', { name: 'Mute for me' }).click();
  await expect(personRow(page, 'Bia')).toContainText('Muted for you');
  expect(await personRow(page, 'Bia').locator('audio').evaluate((a: HTMLAudioElement) => a.muted)).toBe(true);
  await bia.getByRole('button', { name: 'Unmute for me' }).click();
  await expect(personRow(page, 'Bia')).not.toContainText('Muted for you');
  await bia.getByRole('button', { name: 'Report' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report Bia' });
  await dialog.getByLabel('Harassment or bullying').check();
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await page.getByRole('dialog', { name: 'Report sent' }).getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(page).toHaveURL(/#\/rooms$/);

  await makeModerator(app, idOf(dataDir, 'Rian'));
  await go(page, '#/moderation');
  await page.getByRole('list', { name: 'Open reports' }).getByRole('listitem').filter({ hasText: 'Bia' }).getByRole('button').click();
  const context = page.getByRole('region', { name: 'The room' });
  await expect(context).toContainText('Stand-up practice');
  await expect(context).toContainText('Stand-up');
  const who = context.getByRole('list', { name: 'Who was in the room' });
  await expect(who.getByRole('listitem')).toHaveCount(3);
  await expect(who).toContainText('Bia');
  await expect(who).toContainText('Caio');
  await expect(who).toContainText('Rian');
});

test('a report from a room that is gone (deleted with its creator\'s account) says the room details are not available', async ({ page, app, dataDir }) => {
  await onboard(page);
  await joinStandup(page);
  const caio = await options(page, 'Caio');
  await caio.getByRole('button', { name: 'Report' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report Caio' });
  await dialog.getByLabel('Harassment or bullying').check();
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await page.getByRole('dialog', { name: 'Report sent' }).getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(page).toHaveURL(/#\/rooms$/);

  // Bia opened the room; she deletes her account and the room goes with it.
  const bia = idOf(dataDir, 'Bia');
  await asMember(app, bia, 'deleteAccount', []);
  await makeModerator(app, idOf(dataDir, 'Rian'));
  await go(page, '#/moderation');
  await page.getByRole('list', { name: 'Open reports' }).getByRole('listitem').filter({ hasText: 'Caio' }).getByRole('button').click();
  const context = page.getByRole('region', { name: 'The room' });
  await expect(context).toContainText(
    'The room details are not available. The room may have been deleted, or the reporter or the reported person was not in it.',
  );
  await expect(context.getByRole('list', { name: 'Who was in the room' })).toHaveCount(0);
});

test.describe('when the room cannot be read', () => {
  test.use({ socialFail: 'roomState' });

  test('Mute and Leave still work, and the error offers Try again', async ({ page }) => {
    await onboard(page);
    await go(page, '#/rooms');
    await roomRow(page, 'Stand-up practice').getByRole('link', { name: 'Join Stand-up practice' }).click();
    await page.getByRole('button', { name: 'Join room' }).click();
    const failure = page.getByRole('alert').filter({ hasText: 'You are offline.' });
    await expect(failure).toBeVisible();
    await failure.getByRole('button', { name: 'Try again' }).click();
    await expect(failure).toBeVisible();
    await muteButton(page).click();
    await expect(unmuteButton(page)).toBeVisible();
    await controls(page).getByRole('button', { name: 'Leave', exact: true }).click();
    await expect(page).toHaveURL(/#\/rooms$/);
    await expect(roomRow(page, 'Stand-up practice')).toContainText('2 / 6');
  });
});
