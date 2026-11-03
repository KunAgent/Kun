import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createKunServeRuntime } from './runtime-factory.js'

describe('GitHub App Runtime wiring', () => {
  it('retains the native connection and read-tool provider across normal settings updates', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-github-runtime-'))
    const runtime = await createKunServeRuntime({ host: '127.0.0.1', port: 0, dataDir,
      runtimeToken: 'synthetic-host-token', apiKey: '', baseUrl: 'http://127.0.0.1:9', model: 'before',
      approvalPolicy: 'on-request', sandboxMode: 'workspace-write', tokenEconomyMode: false, insecure: false })
    try {
      expect(runtime.githubApp).toBeDefined()
      expect(await runtime.githubApp!.status()).toMatchObject({ connected: false, allowModelSharing: false })
      const original = runtime.githubApp
      expect((await runtime.toolDiagnostics!()).providers).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'github-app', enabled: true, available: true })
      ]))
      expect((await runtime.applyConfig({ serve: { model: 'after' } })).ok).toBe(true)
      expect(runtime.githubApp).toBe(original)
      expect((await runtime.toolDiagnostics!()).providers).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'github-app', enabled: true, available: true })
      ]))
    } finally { await runtime.shutdown?.(); await rm(dataDir, { recursive: true, force: true }) }
  }, 30000)
})
