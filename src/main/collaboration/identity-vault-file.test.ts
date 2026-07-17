import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { IdentityVaultFile } from './identity-vault-file'

describe('IdentityVaultFile', () => {
  it('uses Argon2id authenticated encryption and never stores private key plaintext', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-identity-vault-'))
    const path = join(directory, 'identity.json')
    try {
      const vault = new IdentityVaultFile(path)
      const identity = await vault.loadOrCreate('correct horse battery staple')
      const raw = await readFile(path, 'utf8')

      expect(identity).toMatchObject({ memberId: expect.any(String), deviceId: expect.any(String) })
      expect(raw).not.toContain(identity.signingPrivateKey)
      expect(JSON.parse(raw)).toMatchObject({ storage: 'argon2id-aes-256-gcm' })
      await expect(vault.loadOrCreate('wrong password')).rejects.toMatchObject({
        code: 'identity_password_invalid'
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rotates the password without changing the stable identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-identity-vault-'))
    const path = join(directory, 'identity.json')
    try {
      const vault = new IdentityVaultFile(path)
      const before = await vault.loadOrCreate('old password')
      await vault.rotatePassword('old password', 'new password')

      await expect(vault.loadOrCreate('old password')).rejects.toMatchObject({ code: 'identity_password_invalid' })
      await expect(vault.loadOrCreate('new password')).resolves.toMatchObject({
        memberId: before.memberId,
        deviceId: before.deviceId
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
