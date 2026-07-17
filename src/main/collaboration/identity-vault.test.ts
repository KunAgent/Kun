import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { IdentityVault } from './identity-vault'

describe('IdentityVault', () => {
  it('prefers Electron safeStorage and restores the same identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-safe-identity-'))
    const path = join(directory, 'identity.json')
    const safeStorage = {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn((value: string) => Buffer.from(`protected:${value}`)),
      decryptString: vi.fn((value: Buffer) => value.toString('utf8').slice('protected:'.length))
    }
    try {
      const vault = new IdentityVault({ path, safeStorage })
      const first = await vault.loadOrCreate()
      const restored = await new IdentityVault({ path, safeStorage }).loadOrCreate()
      const raw = await readFile(path, 'utf8')

      expect(restored).toEqual(first)
      expect(safeStorage.encryptString).toHaveBeenCalled()
      expect(raw).not.toContain(first.signingPrivateKey)
      expect(JSON.parse(raw)).toMatchObject({ storage: 'safeStorage' })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('uses the password fallback when safeStorage is unavailable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-fallback-identity-'))
    try {
      const vault = new IdentityVault({
        path: join(directory, 'identity.json'),
        safeStorage: { isEncryptionAvailable: () => false, encryptString: vi.fn(), decryptString: vi.fn() },
        passwordProvider: async () => 'fallback password'
      })
      await expect(vault.loadOrCreate()).resolves.toMatchObject({ memberId: expect.any(String) })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
