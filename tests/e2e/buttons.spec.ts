// Buttons are pills (sky-blue restyle, spec §3): primary and secondary lift 1px on hover, quiet washes, all squeeze to
// 98% when pressed, and a trailing icon nudges 4px. A leading icon, the busy dot and the key hint stay still.
// The welcome screen of the fake community has one button of each kind (GitHub primary, e-mail secondary, "Practise
// without an account" quiet). No screen has a trailing icon or an `a.btn` yet, so those are added to the page with the
// real classes. CSS transitions run for 200 ms (300 ms for the icon), so every hover check polls the computed style.
// The icon rule reads element siblings ("the last child, when it is not the first"), and CSS does not see text nodes: a
// button with only a text and an icon cannot tell the two orders apart. A trailing icon therefore needs an element
// before it, such as the label in a span, and the lab button below is built that way.
import type { Locator, Page } from '@playwright/test';
import { expect, onboard, test } from './fixtures';

test.use({ social: '1' });

// The window opens under the real pointer on some desktops, which hovers whatever button lies there. Start from a corner.
test.beforeEach(async ({ page }) => { await page.mouse.move(2, 2); });

const github = (page: Page) => page.getByRole('button', { name: 'Continue with GitHub' });
const email = (page: Page) => page.getByRole('button', { name: 'Continue with e-mail' });
const local = (page: Page) => page.getByRole('button', { name: 'Practise without an account' });
const lab = (page: Page, id: string) => page.locator(`#btn-lab #${id}`);

const ARROW = '<svg class="icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>';

/** Buttons built the way <Button> and the screens build them, in a corner above the screen, for the cases no screen has yet. */
async function addLab(page: Page): Promise<void> {
  await page.evaluate((arrow) => {
    const box = document.createElement('div');
    box.id = 'btn-lab';
    box.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:9999;display:flex;gap:24px;padding:16px;background:var(--bg)';
    box.innerHTML = [
      `<button id="primary" class="btn btn-primary">Save</button>`,
      `<button id="secondary" class="btn btn-secondary">Next</button>`,
      `<button id="trail" class="btn btn-secondary"><span>Next</span>${arrow}</button>`,
      `<button id="lead" class="btn btn-secondary">${arrow}Mute<kbd>Ctrl M</kbd></button>`,
      `<a id="link" class="btn btn-secondary" href="#/lab">Join</a>`,
      `<button id="off" class="btn btn-primary" disabled>Off</button>`,
      `<button id="off-secondary" class="btn btn-secondary" disabled>Off</button>`,
      `<button id="busy" class="btn btn-primary" disabled aria-busy="true"><span class="btn-busy-dot" aria-hidden="true"></span>Saving</button>`,
      `<span class="chat-actions"><button id="small" class="btn btn-quiet">Reply</button></span>`,
    ].join('');
    document.body.append(box);
  }, ARROW);
}

/** A token as the browser computes it for a CSS property, to compare with getComputedStyle. */
const token = (page: Page, cssProp: string, name: string) =>
  page.evaluate(([prop, n]) => {
    const probe = document.createElement('span');
    probe.style.setProperty(prop!, `var(${n})`);
    document.body.append(probe);
    const value = getComputedStyle(probe).getPropertyValue(prop!);
    probe.remove();
    return value;
  }, [cssProp, name] as const);

const css = (loc: Locator, prop: string) => loc.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
/** The vertical shift (matrix ty) of the element's transform; 0 for `none`. */
const lift = (loc: Locator) => loc.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42);
/** The horizontal scale (matrix a) of the element's transform; 1 for `none`. */
const squeeze = (loc: Locator) => loc.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m11);
/** True when no transition or animation is running on the element, so nothing is moving or fading. */
const still = (loc: Locator) => loc.evaluate((el) => el.getAnimations().length === 0);
const isPill = (loc: Locator) =>
  loc.evaluate((el) => {
    const { height } = el.getBoundingClientRect();
    return parseFloat(getComputedStyle(el).borderTopLeftRadius) >= height / 2;
  });
const away = (page: Page) => page.mouse.move(2, 2);

test('primary buttons are pills that lift on hover', async ({ page }) => {
  const primary = github(page);
  expect(await isPill(primary)).toBe(true);
  await expect.poll(() => lift(primary)).toBe(0);

  await primary.hover();
  await expect.poll(() => lift(primary)).toBe(-1);
  expect(await css(primary, 'background-color')).toBe(await token(page, 'background-color', '--accent-hover'));
});

test('a secondary button lifts and takes the hover sheet; a quiet one washes without lifting', async ({ page }) => {
  const secondary = email(page);
  expect(await isPill(secondary)).toBe(true);
  expect(await css(secondary, 'border-top-width')).toBe('1px');
  expect(await css(secondary, 'border-top-color')).toBe(await token(page, 'border-top-color', '--rule-strong'));
  await expect.poll(() => css(secondary, 'background-color')).toBe(await token(page, 'background-color', '--sheet'));
  await secondary.hover();
  await expect.poll(() => lift(secondary)).toBe(-1);
  await expect.poll(() => css(secondary, 'background-color')).toBe(await token(page, 'background-color', '--sheet-hover'));

  const quiet = local(page);
  expect(await isPill(quiet)).toBe(true);
  await quiet.hover();
  await expect.poll(() => css(quiet, 'background-color')).toBe(await token(page, 'background-color', '--pencil-wash'));
  expect(await css(quiet, 'color')).toBe(await token(page, 'color', '--ink'));
  expect(await lift(quiet)).toBe(0);
  expect(await still(quiet)).toBe(true);
});

test('links styled as buttons are pills, and the size rules of the screens still apply', async ({ page }) => {
  await addLab(page);
  // a.btn
  const link = lab(page, 'link');
  expect(await isPill(link)).toBe(true);
  expect(await css(link, 'text-decoration-line')).toBe('none');
  await link.hover();
  await expect.poll(() => lift(link)).toBe(-1);
  // The base fill, not overridden by a screen
  expect(await css(lab(page, 'primary'), 'padding')).toBe('9px 18px');
  // .chat-actions .btn: small
  const small = lab(page, 'small');
  expect(await css(small, 'padding-top')).toBe('2px');
  expect(await isPill(small)).toBe(true);
  // .welcome-actions > .btn: full width, taller
  const actions = page.locator('.welcome-actions');
  const [wide, column] = await Promise.all([github(page).boundingBox(), actions.boundingBox()]);
  expect(Math.abs(wide!.width - column!.width)).toBeLessThan(1);
  expect(await css(github(page), 'padding-top')).toBe('11px');
});

test('a leading icon stays still, a trailing one moves', async ({ page }) => {
  await addLab(page);
  // The GitHub mark comes before the text: the button lifts, the mark does not move.
  const button = github(page);
  const mark = button.locator('svg.github-mark');
  await button.hover();
  await expect.poll(() => lift(button)).toBe(-1);
  expect(await css(mark, 'transform')).toBe('none');
  expect(await css(mark, 'translate')).toBe('none');
  expect(await still(mark)).toBe(true);

  // A leading icon and the key hint in a lab button: neither moves.
  const lead = lab(page, 'lead');
  await lead.hover();
  await expect.poll(() => lift(lead)).toBe(-1);
  for (const part of [lead.locator('svg'), lead.locator('kbd')]) {
    expect(await css(part, 'translate')).toBe('none');
    expect(await css(part, 'transform')).toBe('none');
    expect(await still(part)).toBe(true);
  }

  // The icon after the text goes 4px right with the button's hover and comes back.
  const trail = lab(page, 'trail');
  const arrow = trail.locator('svg');
  await expect.poll(() => css(arrow, 'translate')).toBe('none');
  await trail.hover();
  await expect.poll(() => css(arrow, 'translate')).toBe('4px');
  expect(await css(trail, 'translate')).toBe('none');
  await away(page);
  await expect.poll(() => css(arrow, 'translate')).toMatch(/^(none|0px( 0px)?)$/);
});

test('disabled and busy buttons do not lift, change colour or move', async ({ page }) => {
  await addLab(page);
  const rest = await token(page, 'background-color', '--accent');
  for (const id of ['off', 'busy']) {
    const button = lab(page, id);
    await button.hover();
    expect(await lift(button), id).toBe(0);
    expect(await css(button, 'background-color'), id).toBe(rest);
    expect(await css(button, 'opacity'), id).toBe('0.5');
    expect(await still(button), id).toBe(true);
    await away(page);
  }
  // The busy dot keeps its own pulse and nothing else.
  const dot = lab(page, 'busy').locator('.btn-busy-dot');
  expect(await css(dot, 'translate')).toBe('none');
  expect(await css(dot, 'transform')).toBe('none');

  const off = lab(page, 'off-secondary');
  await off.hover();
  expect(await lift(off)).toBe(0);
  expect(await css(off, 'background-color')).toBe(await token(page, 'background-color', '--sheet'));
  expect(await still(off)).toBe(true);
});

test('pressing squeezes every kind of button to 98 percent', async ({ page }) => {
  await addLab(page);
  const quiet = lab(page, 'small');
  for (const id of ['primary', 'secondary']) {
    const button = lab(page, id);
    await button.hover();
    await page.mouse.down();
    await expect.poll(() => squeeze(button), id).toBeCloseTo(0.98, 3);
    await page.mouse.up();
    await away(page);
  }
  await quiet.hover();
  await page.mouse.down();
  await expect.poll(() => squeeze(quiet)).toBeCloseTo(0.98, 3);
  await page.mouse.up();
});

test('with reduced motion buttons never move, and only the colour changes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await addLab(page);

  const primary = github(page);
  await primary.hover();
  await expect.poll(() => css(primary, 'background-color')).toBe(await token(page, 'background-color', '--accent-hover'));
  expect(await css(primary, 'transform')).toBe('none');

  const trail = lab(page, 'trail');
  await trail.hover();
  await expect.poll(() => css(trail, 'background-color')).toBe(await token(page, 'background-color', '--sheet-hover'));
  expect(await css(trail, 'transform')).toBe('none');
  expect(await css(trail.locator('svg'), 'translate')).toBe('none');

  const press = lab(page, 'primary');
  await press.hover();
  await page.mouse.down();
  await expect.poll(() => css(press, 'background-color')).toBe(await token(page, 'background-color', '--accent-hover'));
  expect(await css(press, 'transform')).toBe('none');
  await page.mouse.up();
});

test('the focus ring follows the pill', async ({ page }) => {
  await page.keyboard.press('Tab');
  const focused = page.locator('.btn:focus-visible');
  await expect(focused).toHaveCount(1);
  expect(await isPill(focused)).toBe(true);
  expect(await css(focused, 'outline-style')).toBe('solid');
  expect(await css(focused, 'outline-width')).toBe('2px');
});

test.describe('the like button on a profile', () => {
  test.use({ social: 'people' });

  test('is a pill that lifts, squeezes when pressed and sits still under reduced motion; the message link has no underline', async ({ page }) => {
    await onboard(page);
    await page.mouse.move(2, 2);
    await page.evaluate(() => { location.hash = '#/people'; });
    await page.getByRole('list', { name: 'Members' }).getByRole('listitem').filter({ hasText: 'Bia' }).getByRole('link').click();
    // A press toggles the like, which renames the button (Like / Unlike), so find it by its class.
    const like = page.locator('.like-button');
    await expect(like).toBeVisible();
    expect(await isPill(like)).toBe(true);
    expect(await css(page.getByRole('link', { name: 'Send message' }), 'text-decoration-line')).toBe('none');
    await expect.poll(() => lift(like)).toBe(0);
    await like.hover();
    await expect.poll(() => lift(like)).toBe(-1);
    await page.mouse.down();
    await expect.poll(() => squeeze(like)).toBeCloseTo(0.98, 3);
    await page.mouse.up();
    await away(page);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await like.hover();
    await expect.poll(() => css(like, 'background-color')).toBe(await token(page, 'background-color', '--sheet-hover'));
    expect(await css(like, 'transform')).toBe('none');
  });
});
