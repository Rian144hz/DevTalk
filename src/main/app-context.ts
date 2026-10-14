import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import { LLMError } from '../core/llm/errors';
import type { ProgressStage } from '../core/llm/structured';
import { openDatabase, type DB } from './db/open';
import { SqliteStudyStore } from './db/sqlite-store';
import { createHandlers, type Handlers } from './ipc/handlers';
import { createAnthropicProvider } from './llm/anthropic-provider';
import { createGeminiProvider } from './llm/gemini-provider';
import type { ProviderId } from '../shared/providers';
import { createFixtureProvider } from './llm/fake-fixtures';
import { createKeyVault, isKeyringUsable, type KeyVault } from './vault/key-vault';

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
  const keyring = {
    isEncryptionAvailable: () => isKeyringUsable(safeStorage, process.platform),
    encryptString: (s: string) => safeStorage.encryptString(s),
    decryptString: (b: Buffer) => safeStorage.decryptString(b),
  };
  // One encrypted file per provider; the Anthropic key keeps its original file name.
  const vaults = new Map<ProviderId, KeyVault>();
  const vaultFor = (provider: ProviderId) => {
    let vault = vaults.get(provider);
    if (!vault) {
      vault = createKeyVault({ safeStorage: keyring, filePath: join(userData, provider === 'anthropic' ? 'api-key.bin' : `api-key-${provider}.bin`) });
      vaults.set(provider, vault);
    }
    return vault;
  };
  const promptsDir = app.isPackaged ? join(process.resourcesPath, 'prompts') : join(app.getAppPath(), 'prompts');
  const fixtures = createFixtureProvider({ delayMs: 900 });

  const handlers = createHandlers({
    store,
    vaults: vaultFor,
    clock: { now: () => new Date() },
    // Read on every use so prompt edits apply without a rebuild.
    templates: () => ({
      coach: readFileSync(join(promptsDir, 'coach.md'), 'utf8'),
      challenge: readFileSync(join(promptsDir, 'challenge.md'), 'utf8'),
    }),
    makeProvider: (apiKey, profile) => {
      if (useFixtureLLM()) return fixtures;
      if (profile.provider !== 'anthropic' && profile.provider !== 'gemini') {
        throw new LLMError('unavailable', `Provider "${profile.provider}" is not available yet.`);
      }
      if (!apiKey) throw new LLMError('no_key', 'No API key');
      return profile.provider === 'gemini'
        ? createGeminiProvider({ apiKey, model: profile.model })
        : createAnthropicProvider({ apiKey, model: profile.model });
    },
    emitProgress,
  });

  return { handlers, close: () => db.close() };
}
