import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKeyVault, isKeyringUsable, KeyringUnavailableError, type SafeStorageLike } from '../../src/main/vault/key-vault';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'devtalk-vault-'));
  file = join(dir, 'api-key.bin');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const fakeSafeStorage = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').reverse()),
  decryptString: (b) => Buffer.from(b).reverse().toString('utf8'),
});

test('set/get/clear round-trip; file never contains the plain key', () => {
  const vault = createKeyVault({ safeStorage: fakeSafeStorage(), filePath: file });
  expect(vault.has()).toBe(false);
  expect(vault.get()).toBeNull();
  vault.set('sk-ant-test-123');
  expect(vault.has()).toBe(true);
  expect(vault.get()).toBe('sk-ant-test-123');
  expect(readFileSync(file).includes('sk-ant-test-123')).toBe(false);
  vault.clear();
  expect(vault.has()).toBe(false);
  expect(existsSync(file)).toBe(false);
  vault.clear(); // idempotent
});

test('refuses to store when encryption is unavailable', () => {
  const vault = createKeyVault({ safeStorage: fakeSafeStorage(false), filePath: file });
  expect(() => vault.set('sk-ant-test')).toThrow(KeyringUnavailableError);
  expect(existsSync(file)).toBe(false);
});

test('set trims and rejects empty keys', () => {
  const vault = createKeyVault({ safeStorage: fakeSafeStorage(), filePath: file });
  expect(() => vault.set('   ')).toThrow(/empty/i);
  vault.set('  sk-ant-x \n');
  expect(vault.get()).toBe('sk-ant-x');
});

test('file is written with mode 0o600', () => {
  createKeyVault({ safeStorage: fakeSafeStorage(), filePath: file }).set('sk-ant-x');
  expect(statSync(file).mode & 0o777).toBe(0o600);
});

test('a corrupt file reads as no key', () => {
  const vault = createKeyVault({
    safeStorage: { ...fakeSafeStorage(), decryptString: () => { throw new Error('bad'); } },
    filePath: file,
  });
  createKeyVault({ safeStorage: fakeSafeStorage(), filePath: file }).set('sk-ant-x');
  expect(vault.get()).toBeNull();
});

describe('isKeyringUsable', () => {
  const ss = (available: boolean, backend: string) => ({
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
  });
  test('Linux basic_text backend is not a real keyring', () => {
    expect(isKeyringUsable(ss(true, 'basic_text'), 'linux')).toBe(false);
    expect(isKeyringUsable(ss(true, 'unknown'), 'linux')).toBe(false);
    expect(isKeyringUsable(ss(true, 'gnome_libsecret'), 'linux')).toBe(true);
    expect(isKeyringUsable(ss(true, 'kwallet6'), 'linux')).toBe(true);
  });
  test('other platforms rely on isEncryptionAvailable', () => {
    expect(isKeyringUsable(ss(true, 'unknown'), 'darwin')).toBe(true);
    expect(isKeyringUsable(ss(false, 'gnome_libsecret'), 'linux')).toBe(false);
  });
});
