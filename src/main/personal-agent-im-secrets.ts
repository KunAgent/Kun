import { createRequire } from 'node:module'
import type { SafeStorage } from 'electron'
const require = createRequire(import.meta.url)
const unavailable = () => new Error('Unlock your operating system credential store before connecting IM')

function bounded<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([operation, new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(unavailable()), timeoutMs)
  })]).finally(() => clearTimeout(timer))
}

/** macOS Keychain interaction must never block the Electron main thread.
 * Windows DPAPI and Linux's existing backend validation retain their semantics.
 * No unavailable/insecure backend ever falls back to plaintext encryption.
 */
export function createPersonalImSecretProtector(safeStorage: SafeStorage,
  platform: NodeJS.Platform = process.platform, timeoutMs = 15_000) {
  const assertAvailable = async (): Promise<void> => {
    if (platform === 'darwin') {
      if (!await bounded(safeStorage.isAsyncEncryptionAvailable(), timeoutMs)) throw unavailable()
    } else if (!safeStorage.isEncryptionAvailable() || (platform === 'linux' &&
        ['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend()))) throw unavailable()
  }
  return {
    assertAvailable,
    async protect(value: string): Promise<string> {
      await assertAvailable()
      const encrypted = platform === 'darwin'
        ? await bounded(safeStorage.encryptStringAsync(value), timeoutMs) : safeStorage.encryptString(value)
      return encrypted.toString('base64')
    },
    async unprotect(value: string): Promise<string> {
      await assertAvailable()
      const encrypted = Buffer.from(value, 'base64')
      // Preserve the synchronous API's explicit encrypted-envelope requirement;
      // these credentials use Electron sync-compatible v10/v11 ciphertext.
      if (platform === 'darwin' && !['v10', 'v11'].includes(encrypted.subarray(0, 3).toString('ascii'))) {
        throw new Error('The saved IM credential is not an encrypted envelope')
      }
      try {
        return platform === 'darwin'
          ? (await bounded(safeStorage.decryptStringAsync(encrypted), timeoutMs)).result
          : safeStorage.decryptString(encrypted)
      } catch { throw new Error('The saved IM credential cannot be unlocked on this computer') }
    }
  }
}
const protector = () => createPersonalImSecretProtector((require('electron') as typeof import('electron')).safeStorage)
export const assertPersonalImSecretStorage = (): Promise<void> => protector().assertAvailable()
export const protectPersonalImSecret = (value: string): Promise<string> => protector().protect(value)
export const unprotectPersonalImSecret = (value: string): Promise<string> => protector().unprotect(value)
