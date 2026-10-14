import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test';

export { expect } from '@playwright/test';

const ROOT = join(__dirname, '..', '..');

/** Launches the built app with the fixture coach and a throwaway data directory. */
export const test = base.extend<{ app: ElectronApplication; page: Page }>({
  app: async ({}, use) => {
    const dataDir = mkdtempSync(join(tmpdir(), 'devtalk-e2e-'));
    const env = { ...process.env, DEVTALK_FAKE_LLM: '1', DEVTALK_USER_DATA: dataDir } as Record<string, string>;
    delete env['ELECTRON_RUN_AS_NODE'];
    delete env['ELECTRON_RENDERER_URL'];
    const app = await electron.launch({ args: ['.'], cwd: ROOT, env });
    await use(app);
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  },
  page: async ({ app }, use) => {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },
});

/** Emulates a window size; Wayland compositors ignore programmatic window resizes. */
export async function setSize(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
}
