import { afterEach, expect, it, vi } from 'vitest'
import type { SafeStorage } from 'electron'
import { createPersonalImSecretProtector } from './personal-agent-im-secrets'

function fixture() {
  const api = { isEncryptionAvailable: vi.fn(() => true), getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    encryptString: vi.fn((value: string) => Buffer.from('v10' + value)),
    decryptString: vi.fn((value: Buffer) => value.subarray(3).toString()),
    encryptStringAsync: vi.fn(async (value: string) => Buffer.from('v10' + value)),
    decryptStringAsync: vi.fn(async (value: Buffer) => ({ result: value.subarray(3).toString(), shouldReEncrypt: false })) }
  return { api, store: (platform: NodeJS.Platform) => createPersonalImSecretProtector(api as unknown as SafeStorage, platform) }
}
afterEach(() => vi.useRealTimers())
it('uses only nonblocking macOS APIs and reads existing sync-compatible envelopes', async () => {
  const { api, store } = fixture(), mac = store('darwin')
  api.isEncryptionAvailable.mockImplementation(() => { throw new Error('Must not enter blocking Keychain API') })
  const protectedValue = await mac.protect('fixture-secret')
  expect(protectedValue).not.toContain('fixture-secret')
  expect(await mac.unprotect(protectedValue)).toBe('fixture-secret')
  expect(await mac.unprotect(Buffer.from('v10older-fixture').toString('base64'))).toBe('older-fixture')
  expect(api.isEncryptionAvailable).not.toHaveBeenCalled()
  expect(api.encryptString).not.toHaveBeenCalled()
  expect(api.decryptString).not.toHaveBeenCalled()
})
it('fails closed when macOS key protection is unavailable', async () => {
  const { api, store } = fixture()
  api.isAsyncEncryptionAvailable.mockResolvedValue(false)
  await expect(store('darwin').protect('secret')).rejects.toThrow('Unlock')
  expect(api.encryptStringAsync).not.toHaveBeenCalled()
  expect(api.encryptString).not.toHaveBeenCalled()
})
it('times out a pending Keychain interaction without starting encryption after a late response', async () => {
  vi.useFakeTimers()
  const { api, store } = fixture()
  let resume!: (available: boolean) => void
  api.isAsyncEncryptionAvailable.mockReturnValue(new Promise((resolve) => { resume = resolve }))
  const result = expect(store('darwin').protect('secret')).rejects.toThrow('Unlock')
  await vi.advanceTimersByTimeAsync(15_000)
  await result
  resume(true)
  await Promise.resolve()
  expect(api.encryptStringAsync).not.toHaveBeenCalled()
})
it('never falls back after an asynchronous encryption error', async () => {
  const { api, store } = fixture()
  api.encryptStringAsync.mockRejectedValue(new Error('Keychain denied'))
  await expect(store('darwin').protect('secret')).rejects.toThrow('Keychain denied')
  expect(api.encryptString).not.toHaveBeenCalled()
})
it('rejects a plaintext envelope before invoking OS decryption', async () => {
  const { api, store } = fixture()
  await expect(store('darwin').unprotect(Buffer.from('secret').toString('base64'))).rejects.toThrow('encrypted envelope')
  expect(api.decryptStringAsync).not.toHaveBeenCalled()
})
it.each(['basic_text', 'unknown'])('rejects insecure Linux backend %s', async (backend) => {
  const { api, store } = fixture()
  api.getSelectedStorageBackend.mockReturnValue(backend)
  await expect(store('linux').protect('secret')).rejects.toThrow('Unlock')
  expect(api.encryptString).not.toHaveBeenCalled()
})
it.each(['win32', 'linux'] as const)('retains the available OS provider on %s', async (platform) => {
  const { api, store } = fixture(), local = store(platform)
  expect(await local.unprotect(await local.protect('fixture'))).toBe('fixture')
  expect(api.isAsyncEncryptionAvailable).not.toHaveBeenCalled()
  api.isEncryptionAvailable.mockReturnValue(false)
  await expect(local.assertAvailable()).rejects.toThrow('Unlock')
})
