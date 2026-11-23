import { expect, it, vi } from 'vitest'
import { HarnessesConfigSchema } from '../../config/kun-config-harnesses.js'
import { HarnessCatalog } from '../../harness/harness-catalog.js'
import { HarnessDetector } from '../../harness/harness-detector.js'
import { HarnessReadinessService } from '../../harness/harness-readiness.js'
import type { ServerRuntime } from './server-runtime.js'
import { listHarnesses, listHarnessModels, testHarness } from './harnesses.js'

it('does not bootstrap a disabled DSH profile when its model menu is inspected', async () => {
  const probeCatalog = vi.fn()
  const runtime = { harnesses: { catalog: new HarnessCatalog(), acpModels: { probeCatalog } } } as unknown as ServerRuntime
  const response = await listHarnessModels(runtime, new Request('http://localhost/v1/harnesses/deepseek-harness/models'), { id: 'deepseek-harness' })
  expect(JSON.parse(response.body)).toMatchObject({ models: [], reason: 'check_required' })
  expect(probeCatalog).not.toHaveBeenCalled()
})

it('serves persisted per-model ACP reasoning details without respawning the Agent', async () => {
  const probeCatalog = vi.fn(async () => ({ models: ['claude-opus-5-5'], modelInfo: [{ id: 'claude-opus-5-5', reasoningEfforts: ['low'] }] }))
  const catalog = new HarnessCatalog({ enabledProfiles: () => [{ harnessId: 'antigravity', credentialMode: 'native-login' }] })
  const runtime = {
    harnesses: {
      catalog,
      acpModels: { probeCatalog },
      modelCatalogs: {
        get: () => ({
          fetchedAt: '2026-11-19T00:00:00.000Z',
          catalog: {
            models: ['gemini-4-carbon', 'claude-opus-5-5'],
            modelInfo: [
              { id: 'gemini-4-carbon', isDefault: true, reasoningEfforts: ['low', 'high'] },
              { id: 'claude-opus-5-5', reasoningEfforts: ['low', 'medium', 'high'] }
            ]
          }
        })
      }
    }
  } as unknown as ServerRuntime
  const hit = await listHarnessModels(runtime, new Request('http://localhost/v1/harnesses/antigravity/models?selected_model=claude-opus-5-5'), { id: 'antigravity' })
  expect(JSON.parse(hit.body)).toMatchObject({ catalogStatus: { source: 'cache' }, models: ['gemini-4-carbon', 'claude-opus-5-5'] })
  expect(probeCatalog).not.toHaveBeenCalled()

  await listHarnessModels(runtime, new Request('http://localhost/v1/harnesses/antigravity/models?selected_model=unlearned-model'), { id: 'antigravity' })
  expect(probeCatalog).toHaveBeenCalledOnce()
})

it('waits within wait_ms for enabled profile readiness warm-ups so initial list includes readyProfiles', async () => {
  const catalog = new HarnessCatalog({ enabledProfiles: () => [{ harnessId: 'opencode', credentialMode: 'native-login' }] })
  const detector = new HarnessDetector({
    definitions: () => [catalog.get('opencode')!],
    overrides: () => ({}),
    resolveExecutable: async () => '/bin/sh',
    spawnCaptured: async () => ({ stdout: '1.2.0', stderr: '', timedOut: false, exitCode: 0 }),
    probeLogin: async () => 'signed-in',
    nowMs: Date.now,
    nowIso: () => new Date().toISOString()
  })
  const harnesses = HarnessesConfigSchema.parse({ enabledProfiles: [{ harnessId: 'opencode', credentialMode: 'native-login' }] })
  const readiness = new HarnessReadinessService({
    options: () => ({ harnesses }),
    catalog,
    detector,
    handshake: async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      return { ok: true, supported: true, protocol: 'acp' }
    }
  })
  const runtime = { nowIso: () => new Date().toISOString(), harnesses: { catalog, detector, readiness } } as unknown as ServerRuntime
  const response = await listHarnesses(runtime, new Request('http://localhost/v1/harnesses?wait_ms=2000'))
  const opencode = JSON.parse(response.body).harnesses.find((row: { definition: { id: string } }) => row.definition.id === 'opencode')
  expect(opencode.readyProfiles).toHaveLength(1)
  expect(opencode.status.detecting).toBeFalsy()
})

it('does not create a live trial turn when the exact profile readiness gate fails', async () => {
  const create = vi.fn()
  const assertReady = vi.fn(async () => { throw new Error('disabled') })
  const runtime = { harnesses: { catalog: new HarnessCatalog(), readiness: {
    route: () => ({ harnessId: 'opencode', credentialMode: 'native-login', model: 'default' }), assertReady
  } }, threadService: { create } } as unknown as ServerRuntime
  const request = new Request('http://localhost/v1/harnesses/opencode/test', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 'trial' })
  })
  const response = await testHarness(runtime, request, { id: 'opencode' })
  expect(response.status).toBe(409)
  expect(assertReady).toHaveBeenCalled()
  expect(create).not.toHaveBeenCalled()
})
