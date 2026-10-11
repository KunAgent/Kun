import { expect, it, vi } from 'vitest'
import { HarnessCatalog } from '../../harness/harness-catalog.js'
import type { ServerRuntime } from './server-runtime.js'
import { listHarnessModels, testHarness } from './harnesses.js'

it('does not bootstrap a disabled DSH profile when its model menu is inspected', async () => {
  const probeCatalog = vi.fn()
  const runtime = { harnesses: { catalog: new HarnessCatalog(), acpModels: { probeCatalog } } } as unknown as ServerRuntime
  const response = await listHarnessModels(runtime, new Request('http://localhost/v1/harnesses/deepseek-harness/models'), { id: 'deepseek-harness' })
  expect(JSON.parse(response.body)).toMatchObject({ models: [], reason: 'check_required' })
  expect(probeCatalog).not.toHaveBeenCalled()
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
