import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  available: true,
  encrypt: vi.fn((text: string) => Buffer.from('encrypted:' + text)),
  decrypt: (bytes: Buffer) => bytes.toString().slice('encrypted:'.length)
}))
vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: () => storage.available,
  isAsyncEncryptionAvailable: async () => storage.available,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: (text: string) => storage.encrypt(text),
  encryptStringAsync: async (text: string) => storage.encrypt(text),
  decryptString: storage.decrypt,
  decryptStringAsync: async (bytes: Buffer) => ({ result: storage.decrypt(bytes) })
} }))
import { loadIdentity, resetIdentity } from './identity'

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'kun-device-identity-'))
  storage.available = true
  storage.encrypt.mockReset().mockImplementation((text: string) => Buffer.from('encrypted:' + text))
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

it('shares first initialization across simultaneous host and controller callers', async () => {
  const file = join(directory, 'identity.enc')
  const [host, controller] = await Promise.all([loadIdentity(file), loadIdentity(file)])
  expect(controller).toEqual(host)
  expect(storage.encrypt).toHaveBeenCalledTimes(1)
  expect(await loadIdentity(file)).toEqual(host)
})

it('keeps a stored identity until an explicit reset, then backs it up encrypted and creates a new private identity', async () => {
  const file = join(directory, 'identity.enc')
  const first = await loadIdentity(file)
  const encrypted = await readFile(file)
  expect(await loadIdentity(file)).toEqual(first)
  const second = await resetIdentity(file)
  expect(second.id).not.toBe(first.id)
  expect(second.credential).not.toBe(first.credential)
  expect(await loadIdentity(file)).toEqual(second)
  const backups = (await readdir(directory)).filter((name) => name.endsWith('.bak'))
  expect(backups).toHaveLength(1)
  expect(await readFile(join(directory, backups[0]))).toEqual(encrypted)
  if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600)
})

it('preserves the original identity when encryption is unavailable or fails', async () => {
  const file = join(directory, 'identity.enc')
  await loadIdentity(file)
  const encrypted = await readFile(file)
  storage.available = false
  await expect(resetIdentity(file)).rejects.toThrow('SECURE_STORAGE_REQUIRED')
  storage.available = true
  storage.encrypt.mockImplementation(() => { throw new Error('keychain unavailable') })
  await expect(resetIdentity(file)).rejects.toThrow('keychain unavailable')
  expect(await readFile(file)).toEqual(encrypted)
  expect(await readdir(directory)).toEqual(['identity.enc'])
})
