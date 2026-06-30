import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { FileMcpOAuthStore } from './mcp-oauth-store.js'
import { createAesEncryptor } from '../../security/secret-store.js'

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'kun-oauth-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('FileMcpOAuthStore encryption', () => {
  it('persists tokens encrypted at rest and decrypts on read', async () => {
    await withDir(async (dir) => {
      const enc = createAesEncryptor(randomBytes(32))
      const store = new FileMcpOAuthStore(join(dir, 's.json'), enc)
      await store.update((s) => ({ ...s, tokens: { access_token: 'super-secret', token_type: 'bearer' } }))
      const raw = await readFile(join(dir, 's.json'), 'utf8')
      expect(raw).not.toContain('super-secret')
      expect(raw).toContain('enc:v1:')
      const read = await store.read()
      expect(read.tokens?.access_token).toBe('super-secret')
    })
  })

  it('encrypts client secrets and PKCE verifier along with tokens', async () => {
    await withDir(async (dir) => {
      const store = new FileMcpOAuthStore(join(dir, 's.json'), createAesEncryptor(randomBytes(32)))
      await store.update(() => ({
        clientInformation: { client_id: 'client', client_secret: 'client-secret' },
        codeVerifier: 'pkce-verifier',
        tokens: { access_token: 'access-secret', token_type: 'bearer' }
      }))
      const raw = await readFile(join(dir, 's.json'), 'utf8')
      expect(raw).not.toContain('client-secret')
      expect(raw).not.toContain('pkce-verifier')
      expect(raw).not.toContain('access-secret')
      await expect(store.read()).resolves.toMatchObject({
        clientInformation: { client_secret: 'client-secret' },
        codeVerifier: 'pkce-verifier',
        tokens: { access_token: 'access-secret' }
      })
    })
  })

  it('still reads legacy plaintext tokens (backward compatible)', async () => {
    await withDir(async (dir) => {
      const plain = new FileMcpOAuthStore(join(dir, 's.json'))
      await plain.update((s) => ({ ...s, tokens: { access_token: 'legacy', token_type: 'bearer' } }))
      const enc = createAesEncryptor(randomBytes(32))
      const store = new FileMcpOAuthStore(join(dir, 's.json'), enc)
      const read = await store.read()
      expect(read.tokens?.access_token).toBe('legacy')
    })
  })

  it('fails loudly when the credential key no longer decrypts the store', async () => {
    await withDir(async (dir) => {
      const store1 = new FileMcpOAuthStore(join(dir, 's.json'), createAesEncryptor(randomBytes(32)))
      await store1.update((s) => ({ ...s, tokens: { access_token: 'x', token_type: 'bearer' } }))
      // Different key cannot decrypt the prior blob.
      const store2 = new FileMcpOAuthStore(join(dir, 's.json'), createAesEncryptor(randomBytes(32)))
      await expect(store2.read()).rejects.toThrow(/could not be decrypted/)
    })
  })
})
