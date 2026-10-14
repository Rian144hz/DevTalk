import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

/** The subset of Electron's safeStorage the vault needs (injectable for tests). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class KeyringUnavailableError extends Error {
  constructor() {
    super('The system keyring is not available, so the API key cannot be stored safely.');
    this.name = 'KeyringUnavailableError';
  }
}

export interface KeyVault {
  has(): boolean;
  get(): string | null;
  set(key: string): void;
  clear(): void;
}

/** Stores the LLM API key encrypted with the OS keyring. Never writes plain text. */
export function createKeyVault(deps: { safeStorage: SafeStorageLike; filePath: string }): KeyVault {
  const { safeStorage, filePath } = deps;

  const get = (): string | null => {
    if (!existsSync(filePath)) return null;
    try {
      return safeStorage.decryptString(readFileSync(filePath));
    } catch {
      return null;
    }
  };

  return {
    has: () => get() !== null,
    get,
    set(key) {
      const trimmed = key.trim();
      if (!trimmed) throw new Error('The API key is empty.');
      if (!safeStorage.isEncryptionAvailable()) throw new KeyringUnavailableError();
      const tmp = `${filePath}.tmp`;
      writeFileSync(tmp, safeStorage.encryptString(trimmed), { mode: 0o600 });
      renameSync(tmp, filePath);
    },
    clear() {
      rmSync(filePath, { force: true });
    },
  };
}

/**
 * On Linux, Electron falls back to a hard-coded password ("basic_text") when no secret
 * service is running; that is obfuscation, not encryption, so it does not count.
 */
export function isKeyringUsable(
  safeStorage: { isEncryptionAvailable(): boolean; getSelectedStorageBackend?(): string },
  platform: NodeJS.Platform,
): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (platform !== 'linux') return true;
  const backend = safeStorage.getSelectedStorageBackend?.() ?? 'unknown';
  return backend !== 'basic_text' && backend !== 'unknown';
}
