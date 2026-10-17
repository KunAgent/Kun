import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createKunServeRuntime } from './runtime-factory.js'
import { DeepSeekAccountEvidenceStore } from '../gmail/deepseek-account-evidence.js'

// Tool composition can be verified without launching an installed inference engine.
vi.mock('../gmail/local-ollama-service.js', () => ({
  ManagedLocalGmailOllama: { start: vi.fn(async () => undefined) }
}))

describe('Gmail Runtime composition', () => {
  it('uses normal configured models at startup and after settings changes without vendor evidence', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-gmail-runtime-models-'))
    const key = 'ordinary-composition-fixture'
    const readEvidence = vi.spyOn(DeepSeekAccountEvidenceStore.prototype, 'proof')
      .mockRejectedValue(new Error('Vendor evidence must not be loaded'))
    const network = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: [] }))
    let runtime: Awaited<ReturnType<typeof createKunServeRuntime>> | undefined
    const selection = { providerId: 'configured-vendor', model: 'custom-model' }
    try {
      runtime = await createKunServeRuntime({
        host: '127.0.0.1', port: 0, dataDir, runtimeToken: 'gmail-test-token', apiKey: key,
        activeProviderId: 'configured-vendor', baseUrl: 'https://configured.example/v1', model: 'custom-model',
        approvalPolicy: 'on-request', sandboxMode: 'workspace-write', tokenEconomyMode: false, insecure: false,
        providers: { 'configured-vendor': { apiKey: key, baseUrl: 'https://configured.example/v1', endpointFormat: 'chat_completions',
          models: ['custom-model'] } }
      })
      expect(await runtime.gmailDataPolicy?.availability('gmail-preview', selection))
        .toMatchObject({ allowed: true, recipient: 'configured-models' })
      expect((await runtime.applyConfig({ serve: { model: 'custom-model' } })).ok).toBe(true)
      expect(await runtime.gmailDataPolicy?.availability('gmail-preview', selection)).toMatchObject({ allowed: true })
      const snapshot = JSON.stringify(await runtime.modelConnections?.snapshot())
      expect(snapshot).not.toContain(key)
      expect(snapshot).not.toContain('googleWorkspaceAccountEvidence')
      expect((await runtime.applyConfig({ serve: { model: 'auto' } })).ok).toBe(true)
      expect(await runtime.gmailDataPolicy?.availability('gmail-preview', { ...selection, model: 'auto' }))
        .toMatchObject({ allowed: true })
      expect(readEvidence).not.toHaveBeenCalled()
      expect(runtime.gmailLocalModel).toBeUndefined()
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
      expect(await runtime.gmailDataPolicy?.availability('no-mail-thread')).toMatchObject({ allowed: true, recipient: 'configured-models' })
    } finally {
      await runtime.shutdown?.()
      await rm(dataDir, { recursive: true, force: true })
    }
  }, 30_000)
})
