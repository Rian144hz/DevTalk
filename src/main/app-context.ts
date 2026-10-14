import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import { LLMError } from '../core/llm/errors';
import type { ProgressStage } from '../core/llm/structured';
import { openDatabase, type DB } from './db/open';
import { SqliteStudyStore } from './db/sqlite-store';
import { createHandlers, type Handlers } from './ipc/handlers';
import { createAnthropicProvider } from './llm/anthropic-provider';
import { createFixtureProvider } from './llm/fake-fixtures';
import { createKeyVault, isKeyringUsable } from './vault/key-vault';

export interface AppContext {
  handlers: Handlers;
  close(): void;
}

/** Offline fixtures for UI work and e2e: opt-in, and impossible in packaged builds. */
export const useFixtureLLM = () => !app.isPackaged && process.env['DEVTALK_FAKE_LLM'] === '1';

export function createAppContext(emitProgress: (requestId: string, stage: ProgressStage) => void): AppContext {
  const userData = app.getPath('userData');
  const db: DB = openDatabase(join(userData, 'devtalk.sqlite'));
  const store = new SqliteStudyStore(db);
  const vault = createKeyVault({
    safeStorage: {
      isEncryptionAvailable: () => isKeyringUsable(safeStorage, process.platform),
      encryptString: (s) => safeStorage.encryptString(s),
      decryptString: (b) => safeStorage.decryptString(b),
    },
    filePath: join(userData, 'api-key.bin'),
  });
  const promptsDir = app.isPackaged ? join(process.resourcesPath, 'prompts') : join(app.getAppPath(), 'prompts');
  const fixtures = createFixtureProvider({ delayMs: 900 });

  const handlers = createHandlers({
    store,
    vault,
    clock: { now: () => new Date() },
    // Read on every use so prompt edits apply without a rebuild.
    templates: () => ({
      coach: readFileSync(join(promptsDir, 'coach.md'), 'utf8'),
      challenge: readFileSync(join(promptsDir, 'challenge.md'), 'utf8'),
    }),
    makeProvider: (apiKey, profile) => {
      if (useFixtureLLM()) return fixtures;
      if (profile.provider !== 'anthropic') throw new LLMError('unavailable', `Provider "${profile.provider}" is not available yet.`);
      if (!apiKey) throw new LLMError('no_key', 'No API key');
      return createAnthropicProvider({ apiKey, model: profile.model });
    },
    emitProgress,
  });

  return { handlers, close: () => db.close() };
}
