import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createKunServeRuntime } from './runtime-factory.js'

// Tool composition can be verified without launching an installed inference engine.
vi.mock('../gmail/local-ollama-service.js', () => ({
  ManagedLocalGmailOllama: { start: async () => undefined }
}))

describe('Gmail Runtime composition', () => {
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
