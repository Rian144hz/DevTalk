// Phase 2C — voice rooms against the seeded fake community (signed in as Rian) with Chromium's fake microphone.
// Bia hosts "Stand-up practice" with Caio inside; seeded people never answer WebRTC signals, so they end up as
// "Could not connect" after the shortened timeout. Other members act through the fake community in the main process.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, onboard, test } from './fixtures';

interface FakeState {
  profiles: Record<string, { id: string; displayName: string }>;
  rooms: { id: string; title: string }[];
}
const fakeState = (dataDir: string) => JSON.parse(readFileSync(join(dataDir, 'fake-social.json'), 'utf8')) as FakeState;
const idOf = (dataDir: string, name: string) => Object.values(fakeState(dataDir).profiles).find((p) => p.displayName === name)!.id;
const roomOf = (dataDir: string, title: string) => fakeState(dataDir).rooms.find((r) => r.title === title)!.id;

type Act = 'muteMember' | 'removeFromRoom' | 'joinRoom' | 'createRoom' | 'roomState';
/** Dev and e2e builds only: another member calls the fake community, as if from their own app. */
const asMember = (app: ElectronApplication, userId: string, act: Act, args: unknown[]) =>
  app.evaluate(async (_electron, [who, method, a]) => {
    type Backend = Record<string, (...x: unknown[]) => Promise<unknown>>;
    const fake = (globalThis as unknown as Record<string, { actAsForTest(id: string, run: (b: Backend) => Promise<unknown>): Promise<unknown> }>)['__devtalkFakeSocial']!;
    return fake.actAsForTest(who, (b) => b[method]!(...a));
  }, [userId, act, args] as const);
const makeModerator = (app: ElectronApplication, userId: string) =>
  app.evaluate((_electron, id) => {
    const fake = (globalThis as unknown as Record<string, { addModeratorForTest(id: string): void }>)['__devtalkFakeSocial']!;
    fake.addModeratorForTest(id);
  }, userId);

const go = (page: Page, hash: string) => page.evaluate((h) => { location.hash = h; }, hash);
const roomRow = (page: Page, title: string) => page.getByRole('list', { name: 'Live rooms' }).getByRole('listitem').filter({ hasText: title });
const people = (page: Page) => page.getByRole('list', { name: 'People in the room' });
const personRow = (page: Page, name: string) => people(page).getByRole('listitem').filter({ hasText: name });
const muteButton = (page: Page) => page.getByRole('button', { name: /^Mute\b/ });
const unmuteButton = (page: Page) => page.getByRole('button', { name: /^Unmute\b/ });
/** Opens a person's options in the room. */
const options = async (page: Page, name: string) => {
  await people(page).getByRole('button', { name: `Options for ${name}` }).click();
  return page.getByRole('group', { name: `Options for ${name}` });
};

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
  await expect(page.getByRole('meter', { name: 'Microphone level' })).toHaveAttribute('aria-valuenow', /^[1-9]\d*$/);
  await page.getByRole('button', { name: 'Join room' }).click();

  const room = roomOf(dataDir, 'Stand-up practice');
  await expect(page.getByRole('heading', { level: 1, name: 'Stand-up practice' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/rooms/${room}$`));
  await expect(personRow(page, 'Bia')).toContainText('Host');
  await expect(personRow(page, 'Caio')).toBeVisible();
  await expect(personRow(page, 'Rian')).toContainText('You');
  // The fake microphone beeps: your speaking ring lights up.
  await expect(personRow(page, 'Rian').getByText('Speaking', { exact: true })).toBeAttached();

  const card = page.getByRole('region', { name: 'Idea card' });
  await expect(card).toContainText('What did you finish yesterday?');
  await card.getByRole('button', { name: 'Next card' }).click();
  await expect(card).toContainText('What will you work on today?');
  const timer = page.getByRole('region', { name: 'Timer' });
  await timer.getByRole('button', { name: 'Start a 60 s timer' }).click();
  await expect(timer.getByText(/^(60|59|58) s left$/)).toBeVisible();
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
  await expect(page.getByText('Could not connect to Bia. Your network may block calls.')).toBeVisible();
  await expect(page.getByText('Could not connect to Caio. Your network may block calls.')).toBeVisible();

  await page.getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(page).toHaveURL(/#\/rooms$/);
  await expect(roomRow(page, 'Stand-up practice')).toContainText('2 / 6');
  // Outside a room Ctrl+M does nothing here.
  await expect(muteButton(page)).toHaveCount(0);
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
  // He cannot come back: the join is refused and the check says so.
  await roomRow(page, 'Stand-up practice').getByRole('link', { name: 'Join Stand-up practice' }).click();
  await page.getByRole('button', { name: 'Join room' }).click();
  await expect(page.getByRole('alert')).toContainText('You are not allowed to do that.');
  await expect(page.getByRole('heading', { level: 1, name: 'Rooms' })).toBeVisible();
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
