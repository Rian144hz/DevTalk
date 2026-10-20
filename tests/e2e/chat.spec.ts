// Phase 2B.2 — private chat against the seeded fake community (signed in as Rian; Bia talks to him, Ana asked).
import type { Page } from '@playwright/test';
import { expect, onboard, test } from './fixtures';

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
