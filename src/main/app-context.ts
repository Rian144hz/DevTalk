import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, dialog, safeStorage, type BrowserWindow } from 'electron';
import { LLMError } from '../core/llm/errors';
import type { ProgressStage } from '../core/llm/structured';
import { openDatabase, type DB } from './db/open';
import { SqliteStudyStore } from './db/sqlite-store';
import { createHandlers, type Handlers } from './ipc/handlers';
import { createSocialHandlers } from './ipc/social-handlers';
import { createUnconfiguredBackend, type SocialBackend } from './social/backend';
import { readSocialConfig, roomConnectTimeoutMs } from './social/config';
import type { SocialErrorKind } from './social/errors';
import { createFakeSocialBackend } from './social/fake-backend';
import { createChatLive } from './social/chat-live';
import { createRoomLive } from './social/room-live';
import { createPracticeSync, type PracticeSync } from './social/practice-sync';
import { createSessionStore } from './social/session-store';
import { createSupabaseBackend } from './social/supabase-backend';
import { createAnthropicProvider } from './llm/anthropic-provider';
import { createGeminiProvider } from './llm/gemini-provider';
import { checkOllama, createOllamaProvider } from './llm/ollama-provider';
import { GEMINI_FALLBACK_MODEL, type ProviderId } from '../shared/providers';
import { CHAT_EVENT, ROOM_EVENT } from '../shared/ipc-contract';
import { createFixtureProvider } from './llm/fake-fixtures';
import { createKeyVault, isKeyringUsable, type KeyVault, type SafeStorageLike } from './vault/key-vault';

export interface AppContext {
  handlers: Handlers;
  /** Background work that may use the network; started once the window is up, never by the CLI. */
  startBackground(): void;
  /** True while a voice room is being followed or a leave is still on its way (quitting should wait for it). */
  inRoom(): boolean;
  /** Gives up the voice-room seat, if any. Never rejects; may wait for the network, so callers set their own limit. */
  leaveRoom(): Promise<void>;
  close(): void;
}

/** Offline fixtures for UI work and e2e: opt-in, and impossible in packaged builds. */
export const useFixtureLLM = () => !app.isPackaged && process.env['DEVTALK_FAKE_LLM'] === '1';

/**
 * Dev/e2e only: DEVTALK_FAKE_SOCIAL=1 (empty), =moderation (seeded, signed in as a moderator) or =people (signed in as member Rian among varied members) replaces Supabase;
 * DEVTALK_FAKE_SOCIAL_FAIL=deleteAccount[:kind] makes that call fail (default kind: offline).
 */
function fakeSocialBackend(userData: string): SocialBackend | null {
  const mode = app.isPackaged ? undefined : process.env['DEVTALK_FAKE_SOCIAL'];
  if (!mode) return null;
  const fail: Partial<Record<keyof SocialBackend, SocialErrorKind>> = {};
  for (const item of (process.env['DEVTALK_FAKE_SOCIAL_FAIL'] ?? '').split(',').filter(Boolean)) {
    const [name, kind] = item.split(':');
    fail[name as keyof SocialBackend] = (kind as SocialErrorKind | undefined) ?? 'offline';
  }
  const fake = createFakeSocialBackend({ seed: mode === 'moderation' || mode === 'people' ? mode : undefined, filePath: join(userData, 'fake-social.json'), fail });
  // e2e: Playwright's app.evaluate lets "the other member" act (write, thank) from the main process. Never in packaged builds.
  (globalThis as Record<string, unknown>)['__devtalkFakeSocial'] = fake;
  return fake;
}

/** Every table of the local study database, as rows. */
function exportLocalData(db: DB): Record<string, unknown> {
  const tables = db
    .prepare(`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`)
    .all() as { name: string }[];
  return Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`select * from "${name.replaceAll('"', '""')}"`).all()]));
}

/**
 * e2e only (never in packaged builds): DEVTALK_TEST_KEYRING=plain stores fake test keys without the
 * OS keyring, =unavailable simulates a machine with no keyring.
 */
function testKeyring(): SafeStorageLike | null {
  const mode = app.isPackaged ? undefined : process.env['DEVTALK_TEST_KEYRING'];
  if (mode === 'plain') {
    return {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(`test:${s}`),
      decryptString: (b) => b.toString().slice('test:'.length),
    };
  }
  if (mode === 'unavailable') {
    return { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' };
  }
  return null;
}

export function createAppContext(
  emitProgress: (requestId: string, stage: ProgressStage) => void,
  getWindow: () => BrowserWindow | null = () => null,
): AppContext {
  const userData = app.getPath('userData');
  const db: DB = openDatabase(join(userData, 'devtalk.sqlite'));
  const store = new SqliteStudyStore(db);
  const keyring = testKeyring() ?? {
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
  // Set once the community backend exists below; activity before that is counted on the first sync anyway.
  let practiceSync: PracticeSync | null = null;

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
      // Fixture mode still needs a key for cloud providers, so the no-key path can be tested.
      if (useFixtureLLM()) {
        if (!apiKey && profile.provider !== 'ollama') throw new LLMError('no_key', 'No API key');
        return fixtures;
      }
      if (profile.provider === 'ollama') return createOllamaProvider({ model: profile.model });
      if (profile.provider !== 'anthropic' && profile.provider !== 'gemini') {
        throw new LLMError('unavailable', `Provider "${profile.provider}" is not available.`);
      }
      if (!apiKey) throw new LLMError('no_key', 'No API key');
      return profile.provider === 'gemini'
        ? createGeminiProvider({ apiKey, model: profile.model, fallbackModel: GEMINI_FALLBACK_MODEL })
        : createAnthropicProvider({ apiKey, model: profile.model });
    },
    checkProvider: async (profile) =>
      profile.provider === 'ollama'
        ? checkOllama({ model: profile.model })
        : { ok: true, detail: 'Cloud coaches are checked when you ask for feedback.' },
    rng: useFixtureLLM() ? () => 0 : undefined,
    emitProgress,
    onActivity: (kind, detail) => practiceSync?.notify(kind, detail),
  });

  const config = readSocialConfig(import.meta.env);
  const backend =
    fakeSocialBackend(userData) ??
    (config
      ? createSupabaseBackend({
          url: config.url,
          key: config.key,
          storage: createSessionStore({ safeStorage: keyring, filePath: join(userData, 'social-session.bin') }),
        })
      : createUnconfiguredBackend());

  practiceSync = createPracticeSync({
    store,
    backend,
    clock: { now: () => new Date() },
    timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: process.platform,
    statePath: join(userData, 'practice-sync.json'),
  });

  const chatLive = createChatLive({ backend, emit: (e) => getWindow()?.webContents.send(CHAT_EVENT, e) });
  const roomLive = createRoomLive({ backend, emit: (e) => getWindow()?.webContents.send(ROOM_EVENT, e) });

  const socialHandlers = createSocialHandlers({
    backend,
    // Signing in or out, accepting the documents or deleting the account ends the live chat and the voice-room seat.
    onSessionChange: () => {
      void chatLive.start();
      void roomLive.exit();
    },
    roomLive,
    // Dev and e2e can shorten it (DEVTALK_ROOM_TIMEOUT_MS); a packaged app always waits 20 seconds.
    roomConnectTimeoutMs: roomConnectTimeoutMs(process.env, app.isPackaged),
    exportLocal: () => exportLocalData(db),
    chooseSavePath: async (defaultName) => {
      const win = getWindow();
      const options = { title: 'Export my data', defaultPath: join(app.getPath('documents'), defaultName), filters: [{ name: 'JSON', extensions: ['json'] }] };
      const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      return result.canceled || !result.filePath ? null : result.filePath;
    },
    writeFile: (path, content) => writeFileSync(path, content, { mode: 0o600 }),
    deleteLocalData: () => {
      db.close();
      const local = /^(devtalk\.sqlite(-wal|-shm)?|api-key.*\.bin|social-session\.bin|fake-social\.json|practice-sync\.json)$/;
      for (const name of readdirSync(userData)) if (local.test(name)) rmSync(join(userData, name), { force: true });
      // Let the IPC reply reach the window before restarting.
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 300);
    },
    today: () => new Date().toISOString().slice(0, 10),
  });

  return {
    handlers: { ...handlers, ...socialHandlers },
    startBackground: () => {
      void practiceSync?.start();
      void chatLive.start();
    },
    inRoom: () => roomLive.current() !== null || roomLive.leaving(),
    leaveRoom: () => roomLive.exit(),
    close: () => {
      chatLive.stop();
      void roomLive.exit();
      db.close();
    },
  };
}
