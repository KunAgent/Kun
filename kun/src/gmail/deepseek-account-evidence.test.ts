import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createAesEncryptor } from '../security/secret-store.js'
import { assertDeepSeekEvidenceProof, DeepSeekAccountEvidenceStore } from './deepseek-account-evidence.js'

describe('host-owned DeepSeek API account evidence', () => {
  it('encrypts the user-confirmed evidence and mints a capability only for the exact credential', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-deepseek-evidence-'))
    try {
      const store = new DeepSeekAccountEvidenceStore(dir, createAesEncryptor(randomBytes(32)))
      expect(await store.proof('synthetic-key')).toBeUndefined()
      const installed = await store.install({ apiKey: 'synthetic-key', source: 'user-confirmed-unified-account-opt-out', checkedAt: new Date().toISOString() })
      const bytes = await readFile(join(dir, 'mcp-oauth', 'deepseek-account-evidence.json'), 'utf8')
      expect(bytes).not.toContain('synthetic-key')
      expect(bytes).not.toContain('credentialSha256')
      expect(bytes).not.toContain('user-confirmed-unified-account-opt-out')
      const proof = (await store.proof('synthetic-key'))!
      expect(proof.accountBinding).toBe(`deepseek-api:${installed.evidenceId}`)
      expect(() => assertDeepSeekEvidenceProof(proof)).not.toThrow()
      expect(await store.proof('another-key')).toBeUndefined()
      expect(() => proof.assertCredentials('another-key')).toThrow('account evidence changed')
      expect(() => assertDeepSeekEvidenceProof({ ...proof })).toThrow('has not been reviewed')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('checks the final protected headers and refuses credential routing through extra auth headers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-deepseek-evidence-'))
    try {
      const store = new DeepSeekAccountEvidenceStore(dir, createAesEncryptor(randomBytes(32)))
      await store.install({ apiKey: 'synthetic-key', source: 'user-confirmed-unified-account-opt-out', checkedAt: new Date().toISOString() })
      const proof = (await store.proof('synthetic-key'))!
      expect(() => proof.assertCredentials('synthetic-key', { Authorization: 'Bearer synthetic-key' })).not.toThrow()
      const forbidden: Record<string, string>[] = [{ Cookie: 'secret' }, { 'x-api-key': 'secret' }, { 'proxy-authorization': 'secret' }]
      for (const extras of forbidden) {
        expect(() => proof.assertCredentials('synthetic-key', { Authorization: 'Bearer synthetic-key', ...extras })).toThrow('exact Bearer credential')
      }
      expect(() => proof.assertCredentials('synthetic-key', { Authorization: 'Bearer another-key' })).toThrow('exact Bearer credential')
      await expect(store.install({ apiKey: 'synthetic-key', source: 'user-confirmed-unified-account-opt-out', checkedAt: new Date(Date.now() + 120_000).toISOString() })).rejects.toThrow('time is invalid')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
