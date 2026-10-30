// The DevTalk logo (the pencil duck) in the app: the brand line in the rail and on the first-run screens, in both themes.
// The splash's duck is in start.spec.ts.
import type { Page } from '@playwright/test';
import { expect, onboard, test } from './fixtures';

/** The brand line of the screen in view. */
const brand = (page: Page) => page.locator('.brand');
const setTheme = (page: Page, theme: 'dark' | 'light') =>
  page.evaluate((t) => { document.documentElement.dataset['theme'] = t; }, theme);
const fill = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).fill);

/** The duck and the name, nothing else: the accessible name of the line is the visible "DevTalk". */
async function expectDuckAndName(line: ReturnType<typeof brand>): Promise<void> {
  await expect(line).toHaveCount(1);
  await expect(line).toHaveText('DevTalk');
  const duck = line.locator('svg.duck-mark');
  await expect(duck).toBeVisible();
  await expect(duck).toHaveAttribute('aria-hidden', 'true');
  await expect(duck).toHaveAttribute('viewBox', '0 0 256 256');
  const box = await duck.boundingBox();
  expect(box!.width).toBeCloseTo(24, 0);
  expect(box!.height).toBeCloseTo(24, 0);
  // The old pencil icon is gone, and the small cut is used: a solid bill and no separate lead.
  await expect(line.locator('svg.icon')).toHaveCount(0);
  await expect(duck.locator('path')).toHaveCount(3);
  await expect(duck.locator('.duck-lead')).toHaveCount(0);
}

test('the rail shows the duck next to "DevTalk"', async ({ page }) => {
  await onboard(page);
  await expectDuckAndName(page.locator('.rail .brand'));
  // The text sits right after the duck, on the same line.
  const duck = (await page.locator('.rail .brand svg.duck-mark').boundingBox())!;
  const text = await page.locator('.rail .brand').evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el.lastChild!);
    const r = range.getBoundingClientRect();
    return { left: r.left, top: r.top, bottom: r.bottom };
  });
  expect(text.left).toBeGreaterThan(duck.x + duck.width - 2);
  expect(text.left - (duck.x + duck.width)).toBeLessThan(12);
  expect(Math.abs((text.top + text.bottom) / 2 - (duck.y + duck.height / 2))).toBeLessThan(3);
});

test('the duck takes the logo colours of the theme', async ({ page }) => {
  await onboard(page);
  const colours = {
    dark: { body: 'rgb(142, 197, 255)', beak: 'rgb(255, 162, 63)' },
    light: { body: 'rgb(47, 125, 225)', beak: 'rgb(255, 162, 63)' },
  } as const;
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme);
    expect(await fill(page, '.rail .duck-hull'), `${theme} hull`).toBe(colours[theme].body);
    expect(await fill(page, '.rail .duck-head'), `${theme} head`).toBe(colours[theme].body);
    expect(await fill(page, '.rail .duck-bill'), `${theme} bill`).toBe(colours[theme].beak);
  }
});

test.describe('the first run', () => {
  test.use({ social: '1' });

  test('the welcome screen, the e-mail step and the coach setup start with the duck and the name', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: 'Practise the English you use at work.' })).toBeVisible();
    await expectDuckAndName(brand(page));

    await page.getByRole('button', { name: 'Continue with e-mail' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Join the community' })).toBeVisible();
    await expectDuckAndName(brand(page));
    await page.getByRole('button', { name: 'Back' }).click();

    await page.getByRole('button', { name: 'Practise without an account' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Set up your coach' })).toBeVisible();
    await expectDuckAndName(brand(page));
  });
});
