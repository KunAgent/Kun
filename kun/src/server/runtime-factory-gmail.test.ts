import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createKunServeRuntime } from './runtime-factory.js'
import { DeepSeekAccountEvidenceStore } from '../gmail/deepseek-account-evidence.js'
import { createAesEncryptor } from '../security/secret-store.js'

// Tool composition can be verified without launching an installed inference engine.
vi.mock('../gmail/local-ollama-service.js', () => ({
  ManagedLocalGmailOllama: { start: async () => undefined }
}))

describe('Gmail Runtime composition', () => {
  it('loads account evidence at startup and rechecks it when desktop settings rebuild clients', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-gmail-runtime-review-'))
    const key = 'reviewed-composition-fixture'
    const evidenceStore = new DeepSeekAccountEvidenceStore(dataDir, createAesEncryptor(randomBytes(32)))
    await evidenceStore.install({ apiKey: key, source: 'user-confirmed-unified-account-opt-out', checkedAt: new Date().toISOString() })
    const proof = await evidenceStore.proof(key)
    const readEvidence = vi.spyOn(DeepSeekAccountEvidenceStore.prototype, 'proof')
      .mockImplementation(async (currentKey) => currentKey === key ? proof : undefined)
    const network = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: [] }))
    let runtime: Awaited<ReturnType<typeof createKunServeRuntime>> | undefined
    const selection = { providerId: 'deepseek', model: 'deepseek-chat' }
    try {
      runtime = await createKunServeRuntime({
        host: '127.0.0.1', port: 0, dataDir, runtimeToken: 'gmail-test-token', apiKey: key,
        activeProviderId: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat',
        approvalPolicy: 'on-request', sandboxMode: 'workspace-write', tokenEconomyMode: false, insecure: false,
        providers: { deepseek: { apiKey: key, baseUrl: 'https://api.deepseek.com', endpointFormat: 'chat_completions',
          models: ['deepseek-chat'] } }
      })
      expect(await runtime.gmailDataPolicy?.availability('gmail-preview', selection)).toMatchObject({ allowed: true, recipient: 'deepseek-api' })
      expect((await runtime.applyConfig({ serve: { model: 'deepseek-chat' } })).ok).toBe(true)
      expect(await runtime.gmailDataPolicy?.availability('gmail-preview', selection)).toMatchObject({ allowed: true })
      const snapshot = JSON.stringify(await runtime.modelConnections?.snapshot())
      expect(snapshot).not.toContain(key)
      expect(snapshot).not.toContain('googleWorkspaceAccountEvidence')
      readEvidence.mockResolvedValue(undefined)
      expect((await runtime.applyConfig({ serve: { model: 'deepseek-chat' } })).ok).toBe(true)
      expect(await runtime.gmailDataPolicy?.availability('gmail-preview', selection)).toMatchObject({ allowed: false })
    } finally {
      await runtime?.shutdown?.()
      readEvidence.mockRestore(); network.mockRestore()
      await rm(dataDir, { recursive: true, force: true })
    }
  }, 30_000)

  it('keeps the native tools and credential service after applying desktop settings', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-gmail-composition-'))
    const runtime = await createKunServeRuntime({
      host: '127.0.0.1', port: 0, dataDir, runtimeToken: 'gmail-test-token', apiKey: '',
      baseUrl: 'http://127.0.0.1:9', model: 'before', approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write', tokenEconomyMode: false, insecure: false
    })
    try {
      const gmail = runtime.gmail
      expect(gmail).toBeDefined()
      const before = await runtime.toolDiagnostics!()
      expect(before.providers).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'gmail', enabled: true, available: true })
      ]))
      expect((await runtime.applyConfig({ serve: { model: 'after' } })).ok).toBe(true)
      expect(runtime.gmail).toBe(gmail)
      const after = await runtime.toolDiagnostics!()
      expect(after.providers).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'gmail', enabled: true, available: true })
      ]))
      expect(await runtime.gmailDataPolicy?.availability('no-mail-thread')).toMatchObject({ allowed: false })
    } finally {
      await runtime.shutdown?.()
      await rm(dataDir, { recursive: true, force: true })
    }
  }, 30_000)
})
