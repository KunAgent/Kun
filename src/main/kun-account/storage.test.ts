import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SafeStorage } from 'electron'
import { createAccountStorage } from './storage'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-account-storage-')); roots.push(root)
  const path = join(root, 'session.json')
  const safe = {
    isEncryptionAvailable: vi.fn(() => true), getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    encryptString: vi.fn((value: string) => Buffer.from(`v10${Buffer.from(value).toString('base64')}`)),
    decryptString: vi.fn((value: Buffer) => Buffer.from(value.subarray(3).toString(), 'base64').toString()),
    encryptStringAsync: vi.fn(async (value: string) => Buffer.from(`v10${Buffer.from(value).toString('base64')}`)),
    decryptStringAsync: vi.fn(async (value: Buffer) => ({ result: Buffer.from(value.subarray(3).toString(), 'base64').toString() }))
  }
  return { path, safe, storage: createAccountStorage(path, safe as unknown as SafeStorage, 'darwin') }
}

describe('desktop encrypted account storage', () => {
  it('stores only an encrypted envelope and restores it using asynchronous macOS APIs', async () => {
    const f = await fixture()
    const tokens = { accessToken: 'private-access', refreshToken: 'private-refresh', expiresAt: 1000 }
    expect(await f.storage.read()).toBeNull()
    expect(f.safe.isAsyncEncryptionAvailable).not.toHaveBeenCalled()
    await f.storage.write(tokens)
    const raw = await readFile(f.path, 'utf8')
    expect(raw).not.toMatch(/private-access|private-refresh/)
    expect((await stat(f.path)).mode & 0o777).toBe(0o600)
    expect(await f.storage.read()).toEqual(tokens)
    expect(f.safe.encryptString).not.toHaveBeenCalled()
    expect(f.safe.decryptString).not.toHaveBeenCalled()
    await f.storage.clear(); expect(await f.storage.read()).toBeNull()
  })
  it('uses an authenticated key-file envelope when Linux has no keyring (basic_text)', async () => {
    const f = await fixture()
    f.safe.getSelectedStorageBackend.mockReturnValue('basic_text')
    const linux = createAccountStorage(f.path, f.safe as unknown as SafeStorage, 'linux')
    const tokens = { accessToken: 'private-access', refreshToken: 'private-refresh', expiresAt: 1000 }
    await expect(linux.assertAvailable()).resolves.toBeUndefined()
    await linux.write(tokens)
    const raw = await readFile(f.path, 'utf8')
    expect(raw).not.toMatch(/private-access|private-refresh/)
    expect(JSON.parse(raw)).toMatchObject({ version: 2, mode: 'aes-256-gcm' })
    expect((await stat(join(f.path, '..', 'session.key'))).mode & 0o777).toBe(0o600)
    expect(f.safe.encryptString).not.toHaveBeenCalled()
    expect(await linux.read()).toEqual(tokens)
    const tampered = JSON.parse(raw); tampered.ciphertext = Buffer.from('x').toString('base64')
    await writeFile(f.path, JSON.stringify(tampered))
    await expect(linux.read()).rejects.toMatchObject({ code: 'secure_storage' })
  })
  it('keeps OS-encrypted sessions unreadable once the OS store disappears', async () => {
    const f = await fixture()
    await f.storage.write({ accessToken: 'a', refreshToken: 'r', expiresAt: 1000 })
    f.safe.isAsyncEncryptionAvailable.mockResolvedValue(false)
    await expect(f.storage.read()).rejects.toMatchObject({ code: 'secure_storage' })
  })
  it('rejects malformed files instead of treating plaintext tokens as a session', async () => {
    const f = await fixture()
    await writeFile(f.path, JSON.stringify({ accessToken: 'a', refreshToken: 'r', expiresAt: 1000 }))
    await expect(f.storage.read()).rejects.toMatchObject({ code: 'secure_storage' })
    expect(f.safe.decryptStringAsync).not.toHaveBeenCalled()
  })
})
