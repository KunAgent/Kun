import { describe, expect, it, vi } from 'vitest'
import type { OfficialProviderCliService } from '../../services/official-provider-cli.js'
import { buildRouter } from './index.js'
import type { ServerRuntime } from './server-runtime.js'

describe('official provider CLI routes', () => {
  it('starts installation without waiting for download completion', async () => {
    let resolveInstall: ((state: { status: 'done'; receivedBytes: number; totalBytes: number }) => void) | undefined
    const service = {
      status: vi.fn(() => ({ installed: false, version: '1.1.8', directory: '/runtime/cli', download: {
        status: 'downloading', receivedBytes: 1, totalBytes: 10
      } })),
      install: vi.fn(() => new Promise<never>((resolve) => { resolveInstall = resolve as never })),
      models: vi.fn()
    } as unknown as OfficialProviderCliService
    const router = buildRouter({
      runtimeToken: 'official-cli-token', insecure: false, officialProviderCli: service
    } as unknown as ServerRuntime)
    const started = await dispatch(router, 'POST', '/v1/model-connections/official-cli/install', 'official-cli-token')
    expect(started.status).toBe(202)
    expect(JSON.parse(started.body)).toEqual({ status: 'downloading', receivedBytes: 1, totalBytes: 10 })
    expect(service.install).toHaveBeenCalledTimes(1)
    resolveInstall?.({ status: 'done', receivedBytes: 10, totalBytes: 10 })
  })

  it('protects status, install, and models with runtime authorization', async () => {
    const service = {
      status: vi.fn(() => ({ installed: true, version: '1.1.8', directory: '/runtime/cli', download: null })),
      install: vi.fn(async () => ({ status: 'done', receivedBytes: 10, totalBytes: 10 })),
      models: vi.fn(async () => ({ models: [{
        id: 'gemini-3.7-flash', supportedEfforts: ['medium'], defaultEffort: 'medium'
      }] }))
    } as unknown as OfficialProviderCliService
    const router = buildRouter({
      runtimeToken: 'official-cli-token', insecure: false, officialProviderCli: service
    } as unknown as ServerRuntime)

    for (const [method, path] of [
      ['GET', '/v1/model-connections/official-cli/status'],
      ['POST', '/v1/model-connections/official-cli/install'],
      ['GET', '/v1/model-connections/official-cli/models']
    ] as const) {
      expect((await dispatch(router, method, path)).status).toBe(401)
      const expectedStatus = method === 'POST' && path.endsWith('/install') ? 202 : 200
      expect((await dispatch(router, method, path, 'official-cli-token')).status).toBe(expectedStatus)
    }
    expect(service.status).toHaveBeenCalledTimes(2)
    expect(service.install).toHaveBeenCalledTimes(1)
    expect(service.models).toHaveBeenCalledTimes(1)
  })
})

async function dispatch(
  router: ReturnType<typeof buildRouter>,
  method: string,
  path: string,
  token?: string
): Promise<{ status: number; body: string }> {
  const request = new Request(`http://127.0.0.1${path}`, {
    method,
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {})
  })
  const match = router.match(method, path)
  if (!match) throw new Error(`route not found: ${path}`)
  const result = await match.handler(request, { params: match.params })
  return result instanceof Response
    ? { status: result.status, body: await result.text() }
    : { status: result.status, body: result.body }
}
