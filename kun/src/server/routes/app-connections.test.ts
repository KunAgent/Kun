import { describe, expect, it, vi } from 'vitest'
import { Router } from '../router.js'
import { registerAppConnectionRoutes } from './register-app-connection-routes.js'
import type { ServerRuntime } from './server-runtime.js'
import { AppConnectionsService } from '../../services/app-connections-service.js'

const TOKEN = 'test-runtime-token'

function runtime(overrides: Partial<ServerRuntime> = {}): ServerRuntime {
  return { runtimeToken: TOKEN, insecure: false, ...overrides } as ServerRuntime
}

async function call(
  path: string,
  handler: () => Promise<unknown>
): Promise<{ status: number; body: string }> {
  void path
  const response = await handler()
  if (response instanceof Response) throw new Error('expected JSON response')
  return response as { status: number; body: string }
}

describe('app connection routes', () => {
  const service = (): AppConnectionsService => new AppConnectionsService({
    github: {
      status: async () => ({
        configured: true, connected: true, allowModelSharing: false, reconnectRequired: false,
        login: 'octocat', repositoryCount: 2, repositories: ['a', 'b']
      }),
      authorizeAccount: async () => ({ id: 'auth_1', status: 'pending', expiresAt: '2030-01-01T00:00:00.000Z' }),
      pollAccount: async () => ({ id: 'auth_1', status: 'connected', expiresAt: '2030-01-01T00:00:00.000Z' }),
      cancelAccount: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined)
    },
    platform: 'darwin'
  })

  function routerWith(runtimeValue: ServerRuntime): Router {
    const router = new Router()
    registerAppConnectionRoutes(router, runtimeValue)
    return router
  }

  it('requires the runtime token on every connection route', async () => {
    const router = routerWith(runtime({ appConnections: service() }))
    const route = router.match('GET', '/v1/apps/connections')!
    const denied = await route.handler(new Request('http://localhost/v1/apps/connections'),
      { params: route.params })
    if (denied instanceof Response) throw new Error('expected JSON response')
    expect(denied.status).toBe(401)
  })

  it('lists aggregated account status without credentials', async () => {
    const router = routerWith(runtime({ appConnections: service() }))
    const result = await call('/v1/apps/connections', async () => {
      const route = router.match('GET', '/v1/apps/connections')!
      return await route.handler(new Request('http://localhost/v1/apps/connections', {
        headers: { authorization: `Bearer ${TOKEN}` }
      }), { params: route.params })
    })
    const body = JSON.parse(result.body) as { connections: { presetId: string; accountLabel?: string }[] }
    const github = body.connections.find((entry) => entry.presetId === 'github')
    expect(github?.accountLabel).toBe('octocat')
    expect(result.body).not.toContain('token')
  })

  it('rejects a preset that is not available instead of installing it', async () => {
    const router = routerWith(runtime({ appConnections: service() }))
    const route = router.match('POST', '/v1/apps/connections/:id/connect')!
    const result = await call('/v1/apps/connections/notion/connect', async () => await route.handler(
      new Request('http://localhost/v1/apps/connections/notion/connect', {
        method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }
      }), { params: { id: 'notion' } }))
    expect(result.status).toBe(400)
    expect(result.body).toContain('not_ready')
  })

  it('refuses credentials for an app that does not accept them', async () => {
    const router = routerWith(runtime({ appConnections: service() }))
    const route = router.match('PUT', '/v1/apps/connections/:id/credential')!
    const result = await call('/v1/apps/connections/github/credential', async () => await route.handler(
      new Request('http://localhost/v1/apps/connections/github/credential', {
        method: 'PUT',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'secret' })
      }), { params: { id: 'github' } }))
    expect(result.status).toBe(400)
    expect(result.body).toContain('unsupported_operation')
    expect(result.body).not.toContain('secret')
  })

  it('rejects an unknown preset id before touching any backend', async () => {
    const router = routerWith(runtime({ appConnections: service() }))
    const route = router.match('GET', '/v1/apps/connections/:id')!
    const result = await call('/v1/apps/connections/unknown-app', async () => await route.handler(
      new Request('http://localhost/v1/apps/connections/unknown-app', {
        headers: { authorization: `Bearer ${TOKEN}` }
      }), { params: { id: 'unknown-app' } }))
    expect(result.status).toBe(404)
  })

  it('reports unavailability when no connection service is composed', async () => {
    const router = routerWith(runtime())
    const route = router.match('GET', '/v1/apps/connections')!
    const result = await call('/v1/apps/connections', async () => await route.handler(
      new Request('http://localhost/v1/apps/connections', {
        headers: { authorization: `Bearer ${TOKEN}` }
      }), { params: route.params }))
    expect(result.status).toBe(503)
  })
})
