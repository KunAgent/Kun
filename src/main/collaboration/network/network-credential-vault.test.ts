import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NetworkCredentialVault } from './network-credential-vault'

describe('NetworkCredentialVault', () => {
  it('encrypts device access tokens and returns only metadata from summaries', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-collab-credentials-'))
    const path = join(directory, 'credentials.json')
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value, 'utf8').reverse(),
      decryptString: (value: Buffer) => Buffer.from(value).reverse().toString('utf8')
    }
    try {
      const vault = new NetworkCredentialVault({ path, safeStorage })
      await vault.put({
        serverUrl: 'https://collab.example.test', serverInstanceId: 'server-1', spkiSha256: 'a'.repeat(64),
        receiptVerifyingKey: 'verify-key', memberId: 'member-1', deviceId: 'device-1',
        displayName: 'Alice', accessToken: 'secret-device-token'
      })

      expect(await vault.get('https://collab.example.test')).toMatchObject({ accessToken: 'secret-device-token' })
      expect(await vault.list()).toEqual([expect.not.objectContaining({ accessToken: expect.anything() })])
      expect(await readFile(path, 'utf8')).not.toContain('secret-device-token')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('fails closed when operating-system credential encryption is unavailable', async () => {
    const vault = new NetworkCredentialVault({
      path: 'unused',
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: () => Buffer.alloc(0),
        decryptString: () => ''
      }
    })
    await expect(vault.list()).rejects.toMatchObject({ code: 'network_credential_storage_unavailable' })
  })
})
