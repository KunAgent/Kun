import { createRequire } from 'node:module'
import type { SafeStorage } from 'electron'
const require = createRequire(import.meta.url)
const storage = (): SafeStorage => (require('electron') as typeof import('electron')).safeStorage

/** No plaintext fallback, including Linux's intentionally insecure basic_text backend. */
export function assertPersonalImSecretStorage(safeStorage = storage()): void {
  if (!safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && ['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend()))) {
    throw new Error('Unlock your operating system credential store before connecting IM')
  }
}
export function protectPersonalImSecret(value: string): string {
  const safeStorage = storage()
  assertPersonalImSecretStorage(safeStorage)
  return safeStorage.encryptString(value).toString('base64')
}
export function unprotectPersonalImSecret(value: string): string {
  const safeStorage = storage()
  assertPersonalImSecretStorage(safeStorage)
  try { return safeStorage.decryptString(Buffer.from(value, 'base64')) }
  catch { throw new Error('The saved IM credential cannot be unlocked on this computer') }
}
