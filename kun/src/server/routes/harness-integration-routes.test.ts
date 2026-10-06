import { expect, it, vi } from 'vitest'
import { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import type { JsonResponse } from '../response.js'
import { registerHarnessIntegrationRoutes } from './register-harness-integration-routes.js'
it('requires authentication and rejects raw paths before resolving a curated host target', async () => {
  const resolveIntegration = vi.fn(async () => ({ path: '/Applications/Test.app', exists: true, kind: 'application' }))
  const router = new Router()
  registerHarnessIntegrationRoutes(router, { runtimeToken: 'token', insecure: false, harnesses: {
    catalog: { get: (id: string) => id === 'vscode' ? { id } : undefined }, resolveIntegration
  } } as unknown as ServerRuntime)
  const run = async (body: unknown, authorized = true) => {
    const path = '/v1/harnesses/vscode/integration/resolve', matched = router.match('POST', path)!
    return await matched.handler(new Request(`http://localhost${path}`, { method: 'POST', headers: {
      'content-type': 'application/json', ...(authorized ? { authorization: 'Bearer token' } : {}) }, body: JSON.stringify(body) }), { params: matched.params }) as JsonResponse
  }
  expect((await run({ harnessId: 'vscode', action: 'application' }, false)).status).toBe(401)
  for (const body of [{ harnessId: 'vscode', action: 'application', command: '/injected' }, { harnessId: 'unknown', action: 'application' }, { harnessId: 'vscode', action: 'configuration', index: 16 }]) {
    expect((await run(body)).status).toBe(400)
  }
  expect(resolveIntegration).not.toHaveBeenCalled()
  expect((await run({ harnessId: 'vscode', action: 'application' })).status).toBe(200)
  expect(resolveIntegration).toHaveBeenCalledWith({ harnessId: 'vscode', action: 'application' })
})
