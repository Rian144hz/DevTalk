// Phase 2B.2 — private chat against the seeded fake community (signed in as Rian; Bia talks to him, Ana asked).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, onboard, test } from './fixtures';

interface FakeState {
  profiles: Record<string, { id: string; displayName: string }>;
  conversations: { id: string; a: string; b: string }[];
  corrections: { id: number; author: string; corrected: string }[];
}
const fakeState = (dataDir: string) => JSON.parse(readFileSync(join(dataDir, 'fake-social.json'), 'utf8')) as FakeState;
const idOf = (s: FakeState, name: string) => Object.values(s.profiles).find((p) => p.displayName === name)!.id;
const conversationWith = (s: FakeState, name: string) => {
  const other = idOf(s, name);
  return s.conversations.find((c) => c.a === other || c.b === other)!.id;
};
/** Dev and e2e builds only: the other member acts through the fake community in the main process. */
const asOther = (app: ElectronApplication, method: 'sendAsForTest' | 'thankAsForTest' | 'addModeratorForTest', ...args: unknown[]) =>
  app.evaluate((_electron, [m, a]) => {
    const fake = (globalThis as unknown as Record<string, Record<string, (...x: unknown[]) => unknown>>)['__devtalkFakeSocial']!;
    fake[m]!(...a);
  }, [method, args] as const);
const openBia = async (page: Page) => {
  await go(page, '#/messages');
  await page.getByRole('navigation', { name: 'Conversations' }).getByRole('link', { name: /Bia/ }).click();
  return page.getByRole('region', { name: 'Conversation with Bia' });
};

const go = (page: Page, hash: string) => page.evaluate((h) => { location.hash = h; }, hash);
const rail = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const conversations = (page: Page) => page.getByRole('navigation', { name: 'Conversations' });
const shot = process.env['DEVTALK_CHAT_SHOTS'];

test.use({ social: 'people' });

test('Messages lists the request and the conversation; reading clears the count', async ({ page }) => {
  await onboard(page);
  await expect(rail(page).getByRole('link', { name: /Messages/ })).toContainText('2');
  await rail(page).getByRole('link', { name: /Messages/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Messages' })).toBeVisible();
  await expect(conversations(page).getByRole('region', { name: 'Requests' })).toContainText('Ana');
  await conversations(page).getByRole('link', { name: /Bia/ }).click();
  const pane = page.getByRole('region', { name: 'Conversation with Bia' });
  await expect(pane).toContainText('How was the meeting?');
  await expect(rail(page).getByRole('link', { name: /Messages/ })).toContainText('1');
  if (shot) await page.screenshot({ path: `${shot}/messages.png` });
  await pane.getByLabel('Message to Bia').fill('It went well.\nThey liked the endpoints.');
  await pane.getByLabel('Message to Bia').press('Enter');
  await expect(pane.getByText('They liked the endpoints.', { exact: false })).toBeVisible();
  await expect(pane.getByLabel('Message to Bia')).toHaveValue('');
});

test('accepting a request opens the composer', async ({ page }) => {
  await onboard(page);
  await go(page, '#/messages');
  await conversations(page).getByRole('link', { name: /Ana/ }).click();
  const pane = page.getByRole('region', { name: 'Conversation with Ana' });
  await expect(pane).toContainText('Ana wants to practise with you.');
  if (shot) await page.screenshot({ path: `${shot}/request.png` });
  await pane.getByRole('button', { name: 'Accept' }).click();
  await expect(pane.getByLabel('Message to Ana')).toBeVisible();
});

test('Send message on a profile starts a request; then it waits for the answer', async ({ page }) => {
  await onboard(page);
  await go(page, '#/people');
  await page.getByRole('list', { name: 'Members' }).getByRole('link', { name: /Caio/ }).click();
  await page.getByRole('link', { name: 'Send message' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Message Caio' })).toBeVisible();
  if (shot) await page.screenshot({ path: `${shot}/new.png` });
  await page.getByLabel('First message to Caio').fill('Hi Caio! Can we practise data talk?');
  await page.getByRole('button', { name: 'Send request' }).click();
  const pane = page.getByRole('region', { name: 'Conversation with Caio' });
  await expect(pane).toContainText('Waiting for Caio.');
  await expect(conversations(page)).toContainText('Waiting for Caio');
  await go(page, '#/people');
  await page.getByRole('list', { name: 'Members' }).getByRole('link', { name: /Caio/ }).click();
  await page.getByRole('link', { name: 'Send message' }).click();
  await expect(page.getByRole('region', { name: 'Conversation with Caio' })).toBeVisible();
});

test('text is shown as typed, and a live message from Bia appears without reloading', async ({ page, app, dataDir }) => {
  await onboard(page);
  const pane = await openBia(page);
  await pane.getByLabel('Message to Bia').fill('<b>x</b> **not bold**');
  await pane.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(pane.getByText('<b>x</b> **not bold**')).toBeVisible();
  await asOther(app, 'sendAsForTest', idOf(fakeState(dataDir), 'Bia'), conversationWith(fakeState(dataDir), 'Bia'), 'Live from Bia');
  await expect(pane.getByText('Live from Bia')).toBeVisible();
});

test('corrections: Thanks on yours, suggest one on hers, she thanks it', async ({ page, app, dataDir }) => {
  await onboard(page);
  const pane = await openBia(page);
  const meeting = pane.getByRole('listitem').filter({ hasText: 'long meeting about our API' });
  await expect(meeting.getByRole('deletion')).toHaveText(/have/);
  await expect(meeting.getByRole('insertion')).toHaveText(/had/);
  await meeting.getByRole('button', { name: 'Thanks' }).click();
  await expect(meeting).toContainText('Thanked');

  const free = pane.getByRole('listitem').filter({ hasText: 'free on Thursday evening' });
  await free.getByRole('button', { name: 'Suggest a correction' }).click();
  await free.getByLabel("Correction of Bia's message").fill("Yes! I'm free on Thursday evening.");
  await free.getByRole('button', { name: 'Suggest', exact: true }).click();
  await expect(free.getByRole('insertion')).toHaveText(/I'm/);
  await expect(free).toContainText('Your correction');
  if (shot) await page.screenshot({ path: `${shot}/corrections.png` });
  const mine = fakeState(dataDir).corrections.find((k) => k.author === idOf(fakeState(dataDir), 'Rian'))!;
  await asOther(app, 'thankAsForTest', idOf(fakeState(dataDir), 'Bia'), mine.id);
  await expect(free).toContainText('Thanked');
});

test('deleting your message leaves "Message deleted"', async ({ page }) => {
  await onboard(page);
  const pane = await openBia(page);
  await pane.getByLabel('Message to Bia').fill('Delete me');
  await pane.getByLabel('Message to Bia').press('Enter');
  const item = pane.getByRole('listitem').filter({ hasText: 'Delete me' });
  await item.getByRole('button', { name: 'Delete' }).click();
  await item.getByRole('group', { name: 'Delete this message' }).getByRole('button', { name: 'Delete' }).click();
  await expect(pane.getByText('Delete me')).toHaveCount(0);
  await expect(pane.getByText('Message deleted')).toBeVisible();
});

test('the coach checks a draft: "Use this version" replaces it; a failed check still lets you send', async ({ page }) => {
  await onboard(page);
  const pane = await openBia(page);
  const input = pane.getByLabel('Message to Bia');
  await input.fill('Yesterday I have fixed the bug.');
  await pane.getByRole('button', { name: 'Check with the coach' }).click();
  const check = pane.getByRole('region', { name: 'The coach on your draft' });
  await expect(check.getByRole('deletion')).toHaveText(/have/);
  if (shot) await page.screenshot({ path: `${shot}/check.png` });
  await check.getByRole('button', { name: 'Use this version' }).click();
  await expect(input).toHaveValue('Yesterday I fixed the bug.');
  await expect(check).toHaveCount(0);

  await input.fill('I hit the rate limit today.');
  await pane.getByRole('button', { name: 'Check with the coach' }).click();
  await expect(pane.getByRole('alert')).toContainText('usage limit');
  await pane.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(pane.getByText('I hit the rate limit today.')).toBeVisible();
});

test('a report keeps the message with context for moderators; a block closes the conversation', async ({ page, app, dataDir }) => {
  await onboard(page);
  const pane = await openBia(page);
  const meetingQuestion = pane.getByRole('listitem').filter({ hasText: 'How was the meeting?' });
  await meetingQuestion.getByRole('button', { name: 'Report' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report Bia' });
  await dialog.getByLabel('Spam or scams').check();
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await page.getByRole('dialog', { name: 'Report sent' }).getByRole('button', { name: 'Close' }).click();

  await asOther(app, 'addModeratorForTest', idOf(fakeState(dataDir), 'Rian'));
  await go(page, '#/moderation');
  await page.getByRole('list', { name: 'Open reports' }).getByRole('listitem').filter({ hasText: 'Bia' }).getByRole('button').click();
  const context = page.getByRole('list', { name: 'Reported conversation' });
  await expect(context).toContainText('Yes! I am free on Thursday evening.');
  await expect(context.getByRole('listitem').filter({ hasText: 'Reported' })).toContainText('How was the meeting?');
  if (shot) await page.screenshot({ path: `${shot}/moderation.png` });

  await go(page, `#/people/u/${idOf(fakeState(dataDir), 'Bia')}`);
  await page.getByRole('button', { name: 'Block Bia' }).click();
  await page.getByRole('group', { name: 'Block Bia' }).getByRole('button', { name: 'Block' }).click();
  await go(page, '#/messages');
  await expect(page.getByRole('navigation', { name: 'Conversations' })).not.toContainText('Bia');
});
