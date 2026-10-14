import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { SafeStorageLike } from '../vault/key-vault';

/** The storage adapter supabase-js uses for the auth session. */
export interface SessionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** Forgets the session entirely (sign out without the network). */
  clear(): void;
}

/**
 * Keeps the Supabase session encrypted with the OS keyring in one file. Without a usable keyring the session
 * stays in memory only (you sign in again next time); plain text is never written.
 */
export function createSessionStore(deps: { safeStorage: SafeStorageLike; filePath: string }): SessionStore {
  const { safeStorage, filePath } = deps;
  let items: Record<string, string> | null = null;

  const load = (): Record<string, string> => {
    if (items) return items;
    items = {};
    if (existsSync(filePath)) {
      try {
        const parsed = JSON.parse(safeStorage.decryptString(readFileSync(filePath))) as unknown;
        if (parsed && typeof parsed === 'object') items = parsed as Record<string, string>;
      } catch {
        items = {};
      }
    }
    return items;
  };

  const save = () => {
    const data = load();
    if (Object.keys(data).length === 0) {
      rmSync(filePath, { force: true });
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) return;
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(data)), { mode: 0o600 });
    renameSync(tmp, filePath);
  };

  return {
    getItem: (key) => load()[key] ?? null,
    setItem(key, value) {
      load()[key] = value;
      save();
    },
    removeItem(key) {
      delete load()[key];
      save();
    },
    clear() {
      items = {};
      rmSync(filePath, { force: true });
    },
  };
}
