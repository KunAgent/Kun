import { expect, it } from 'vitest'
import type { SafeStorage } from 'electron'
import { assertPersonalImSecretStorage } from './personal-agent-im-secrets'
it('fails closed when encryption is unavailable', () => {
  expect(() => assertPersonalImSecretStorage({ isEncryptionAvailable: () => false } as SafeStorage)).toThrow('Unlock')
})
it.skipIf(process.platform !== 'linux')('rejects Electron basic_text on Linux instead of storing plaintext', () => {
  expect(() => assertPersonalImSecretStorage({ isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'basic_text' } as SafeStorage)).toThrow('Unlock')
})
it('accepts an available OS-backed storage provider', () => {
  expect(() => assertPersonalImSecretStorage({ isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret' } as SafeStorage)).not.toThrow()
})
