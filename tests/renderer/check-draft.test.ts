import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';

const SRC = join(__dirname, '../../src/renderer');
/** A source file without its comments, so a word in a comment is not mistaken for code. */
const code = (file: string) =>
  readFileSync(join(SRC, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

/** A fresh copy of the module, as after a reload: its memory is the only place the draft lives. */
async function freshDraft() {
  vi.resetModules();
  return import('../../src/renderer/lib/check-draft');
}

describe('the draft of Check, kept in memory while the window is open', () => {
  test('starts empty, with the first kind of text', async () => {
    const { loadCheckDraft } = await freshDraft();
    expect(loadCheckDraft()).toEqual({ type: 'pull_request', text: '' });
  });

  test('keeps the kind and the text that were saved, and a newer one replaces them', async () => {
    const { loadCheckDraft, saveCheckDraft } = await freshDraft();
    saveCheckDraft({ type: 'email', text: 'Hello Maya,\n\nI fixed it.' });
    expect(loadCheckDraft()).toEqual({ type: 'email', text: 'Hello Maya,\n\nI fixed it.' });
    saveCheckDraft({ type: 'slack', text: 'hey' });
    expect(loadCheckDraft()).toEqual({ type: 'slack', text: 'hey' });
    saveCheckDraft({ type: 'slack', text: '' });
    expect(loadCheckDraft()).toEqual({ type: 'slack', text: '' });
  });

  test('is gone with the window: a new copy of the module starts empty again', async () => {
    const first = await freshDraft();
    first.saveCheckDraft({ type: 'commit_message', text: 'fix the flaky test' });
    const second = await freshDraft();
    expect(second.loadCheckDraft()).toEqual({ type: 'pull_request', text: '' });
  });

  test('is never written anywhere: no browser storage, no IPC call, no network, no cookie', () => {
    for (const file of ['lib/check-draft.ts', 'screens/CheckScreen.tsx']) {
      expect(code(file), file).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|caches\.|navigator\.storage|XMLHttpRequest|\bfetch\s*\(|WebSocket/);
    }
    // The draft module does not even reach the API; the screen only calls the coach and Review through it.
    expect(code('lib/check-draft.ts')).not.toMatch(/devtalk|\bapi\s*\(/);
    const calls = [...code('screens/CheckScreen.tsx').matchAll(/api\(\)\.(\w+\.\w+)/g)].map((m) => m[1]);
    expect([...new Set(calls)].sort()).toEqual(['check.cancel', 'check.run', 'review.keep']);
  });
});
