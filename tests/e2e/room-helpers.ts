// Shared by the rooms specs: reading the fake community's file and acting as another member.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type ElectronApplication, type Page } from '@playwright/test';

interface FakeState {
  profiles: Record<string, { id: string; displayName: string }>;
  rooms: { id: string; title: string }[];
}
export const fakeState = (dataDir: string) => JSON.parse(readFileSync(join(dataDir, 'fake-social.json'), 'utf8')) as FakeState;
export const idOf = (dataDir: string, name: string) => Object.values(fakeState(dataDir).profiles).find((p) => p.displayName === name)!.id;
/** The newest room with this title (a title can be used again once its room has ended). */
export const roomOf = (dataDir: string, title: string) => fakeState(dataDir).rooms.filter((r) => r.title === title).at(-1)!.id;

export type Act = 'muteMember' | 'removeFromRoom' | 'joinRoom' | 'createRoom' | 'roomState' | 'setRoomMuted' | 'deleteAccount';
/** Dev and e2e builds only: another member calls the fake community, as if from their own app. */
export const asMember = (app: ElectronApplication, userId: string, act: Act, args: unknown[]) =>
  app.evaluate(async (_electron, [who, method, a]) => {
    type Backend = Record<string, (...x: unknown[]) => Promise<unknown>>;
    const fake = (globalThis as unknown as Record<string, { actAsForTest(id: string, run: (b: Backend) => Promise<unknown>): Promise<unknown> }>)['__devtalkFakeSocial']!;
    return fake.actAsForTest(who, (b) => b[method]!(...a));
  }, [userId, act, args] as const);
export const makeModerator = (app: ElectronApplication, userId: string) =>
  app.evaluate((_electron, id) => {
    const fake = (globalThis as unknown as Record<string, { addModeratorForTest(id: string): void }>)['__devtalkFakeSocial']!;
    fake.addModeratorForTest(id);
  }, userId);

export const go = (page: Page, hash: string) => page.evaluate((h) => { location.hash = h; }, hash);
export const roomRow = (page: Page, title: string) => page.getByRole('list', { name: 'Live rooms' }).getByRole('listitem').filter({ hasText: title });
export const people = (page: Page) => page.getByRole('list', { name: 'People in the room' });
export const personRow = (page: Page, name: string) => people(page).getByRole('listitem').filter({ hasText: name });
/** The bar under the room: Mute or Unmute, Leave, and End room for the host. */
export const controls = (page: Page) => page.getByRole('group', { name: 'Room controls' });
export const muteButton = (page: Page) => controls(page).getByRole('button', { name: 'Mute', exact: true });
export const unmuteButton = (page: Page) => controls(page).getByRole('button', { name: 'Unmute', exact: true });
/** Opens a person's options in the room. */
export const options = async (page: Page, name: string) => {
  await people(page).getByRole('button', { name: `Options for ${name}` }).click();
  return page.getByRole('group', { name: `Options for ${name}` });
};

/**
 * Waits until the level meter shows sound. Chromium's fake microphone beeps for a moment once a second, so the
 * meter is polled quickly: a slow poll can land between the same two beeps every time.
 */
export const meterMoves = (page: Page) =>
  expect(async () => {
    const level = await page.getByRole('meter', { name: 'Microphone level' }).getAttribute('aria-valuenow');
    expect(Number(level)).toBeGreaterThan(0);
  }).toPass({ intervals: [50], timeout: 10_000 });

/**
 * Waits until the speaking ring is lit on a face. Your own fake microphone beeps for a moment once a second, and a
 * default Playwright wait polls once a second too, so it can miss every beep: poll fast.
 */
export const ringLit = (page: Page) =>
  expect.poll(() => page.locator('.room-face.is-speaking').count(), { intervals: [30], timeout: 10_000 }).toBeGreaterThan(0);
