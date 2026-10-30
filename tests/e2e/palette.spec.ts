import { computedValue, expect, onboard, SAMPLE_ANSWER, styleOf, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await onboard(page);
});

test('Ctrl+K then "set" and Enter opens Settings', async ({ page }) => {
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search or jump to' });
  await expect(dialog).toBeVisible();
  await page.keyboard.type('set');
  await expect(dialog.getByRole('option').first()).toHaveText(/Go to Settings/);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(dialog).toBeHidden();
});

test('arrow keys move the selection', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { selected: true })).toHaveText(/Go to Practice/);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/practice$/);
});

// The active row is the only cue for what Enter will run, so besides the sky wash it has a 1px sky edge; no other row has either.
test('the active row has the sky wash and a sky edge that move with the arrow keys', async ({ page }) => {
  await page.keyboard.press('Control+k');
  const options = page.getByRole('dialog', { name: 'Search or jump to' }).getByRole('option');
  const wash = await computedValue(page, 'background-color', 'var(--pencil-wash)');
  const edge = await computedValue(page, 'box-shadow', 'inset 0 0 0 1px color-mix(in srgb, var(--accent) 60%, var(--rule-strong))');
  expect(edge).not.toBe('none');
  for (const active of [0, 1]) {
    const idle = 1 - active;
    if (active === 1) await page.keyboard.press('ArrowDown');
    await expect(options.nth(active)).toHaveAttribute('aria-selected', 'true');
    expect(await styleOf(options.nth(active), 'background-color'), `row ${active} fill`).toBe(wash);
    expect(await styleOf(options.nth(active), 'box-shadow'), `row ${active} edge`).toBe(edge);
    expect(await styleOf(options.nth(idle), 'box-shadow'), `row ${idle} edge`).toBe('none');
    expect(await styleOf(options.nth(idle), 'background-color'), `row ${idle} fill`).toBe('rgba(0, 0, 0, 0)');
  }
});

test('Ctrl+3 opens Review and Ctrl+1 goes back to Today', async ({ page }) => {
  await page.keyboard.press('Control+3');
  await expect(page.getByRole('heading', { level: 1, name: 'Review' })).toBeVisible();
  await page.keyboard.press('Control+1');
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
});

test('Esc closes the palette and returns focus to the opener', async ({ page }) => {
  await page.getByRole('button', { name: /Search or jump to/ }).click();
  await expect(page.getByRole('dialog', { name: 'Search or jump to' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Search or jump to' })).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.textContent ?? '')).toContain('Search or jump to');
});

test('the theme can be switched from the palette', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await page.keyboard.type('light');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('Esc in the palette does not cancel the coach', async ({ page }) => {
  await page.getByRole('button', { name: 'Get a challenge' }).click();
  await page.getByRole('button', { name: 'Write it' }).click();
  await page.getByRole('textbox', { name: 'Your answer' }).fill(SAMPLE_ANSWER);
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('status').filter({ hasText: 'The coach is reading your answer' })).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  await expect(page.locator('.galley .line-text .mark-n')).toHaveCount(2);
});
