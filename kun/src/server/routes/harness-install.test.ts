import { expect, it, vi } from 'vitest'
import { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import type { JsonResponse } from '../response.js'
import { registerHarnessInstallRoutes } from './register-harness-install-routes.js'
import { HarnessCatalog } from '../../harness/harness-catalog.js'

it('authenticates installation mutations and rejects arbitrary commands or custom agents', async () => {
  const router = new Router()
  const catalog = new HarnessCatalog({ custom: () => [{ id: 'custom-installer', displayName: 'Custom', command: 'false', args: [], env: {} }] })
  registerHarnessInstallRoutes(router, { runtimeToken: 'fixture-token', insecure: false,
    harnesses: { catalog, detector: { status: vi.fn() } }
  } as unknown as ServerRuntime)
  const call = async (id: string, body: unknown, auth = true) => {
    const path = `/v1/harnesses/${id}/install`
    const route = router.match('POST', path)!
    return await route.handler(new Request(`http://localhost${path}`, { method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer fixture-token' } : {}) },
      body: JSON.stringify(body) }), { params: route.params }) as JsonResponse
  }
  expect((await call('devin', {}, false)).status).toBe(401)
  expect((await call('devin', { command: 'untrusted shell text' })).status).toBe(400)
  expect((await call('devin', { action: 'delete' })).status).toBe(400)
  expect((await call('custom-installer', { action: 'install' })).status).toBe(400)
  expect((await call('unknown', { action: 'install' })).status).toBe(400)
})
