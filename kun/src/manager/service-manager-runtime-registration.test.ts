import { describe, expect, it, vi } from 'vitest'
import { dispatchRequest } from '../server/http-server.js'
import {
  unregisterRuntimeWithManager,
  type ServiceManagerConnection
} from './manager-client.js'
import {
  buildServiceManagerRouter,
  ServiceManagerState
} from './service-manager.js'

function registration(instanceId = 'production-runtime', pid = process.pid) {
  return {
    flavor: 'production' as const,
    instanceId,
    pid,
    startedAt: '2026-08-01T00:00:00.000Z',
    host: '127.0.0.1',
    port: 18899,
    baseUrl: 'http://127.0.0.1:18899',
    runtimeToken: 'production-secret'
  }
}

function manager(): ServiceManagerConnection {
  return {
    discovery: {
      version: 1,
      protocolVersion: 5,
      instanceId: 'manager-a',
      pid: process.pid,
      startedAt: '2026-08-01T00:00:00.000Z',
      host: '127.0.0.1',
      port: 18700,
      baseUrl: 'http://127.0.0.1:18700',
      managerToken: 'manager-secret',
      serviceVersion: '0.1.0',
      dataDir: '/tmp/kun-data',
      settingsPath: '/tmp/kun-settings.json'
    }
  }
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://127.0.0.1${path}`, {
    ...init,
    headers: {
      authorization: 'Bearer manager-secret',
      ...init.headers
    }
  })
}

function routerFetch(router: ReturnType<typeof buildServiceManagerRouter>): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) =>
    dispatchRequest(router, new Request(url, init))) as typeof fetch
}

describe('service manager runtime unregister contract', () => {
  it('does not retain a replacement registration when persistence fails', async () => {
    const state = new ServiceManagerState()
    state.register(registration('production-dead', 2_147_483_647))
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-a',
      startedAt: '2026-08-01T00:00:00.000Z',
      state,
      flushState: async () => { throw new Error('disk full') }
    })

    await expect(dispatchRequest(router, request(
      '/v1/runtimes/production/register',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(registration('production-replacement'))
      }
    ))).rejects.toThrow('disk full')
    expect(state.registration('production')).toBeNull()
  })

  it('flushes an exact removal before returning true and keeps it removed after restore', async () => {
    const state = new ServiceManagerState()
    const owner = registration()
    state.register(owner)
    let durableSnapshot: unknown
    const flushState = vi.fn(async () => {
      durableSnapshot = state.durableSnapshot()
    })
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-a',
      startedAt: '2026-08-01T00:00:00.000Z',
      state,
      flushState
    })

    await expect(unregisterRuntimeWithManager({
      manager: manager(),
      flavor: 'production',
      instanceId: owner.instanceId,
      fetch: routerFetch(router)
    })).resolves.toBe(true)

    expect(flushState).toHaveBeenCalledOnce()
    expect(state.registration('production')).toBeNull()
    expect(ServiceManagerState.restore(durableSnapshot).registration('production')).toBeNull()
  })

  it('returns false without flushing or deleting a replacement owner', async () => {
    const state = new ServiceManagerState()
    const replacement = registration('production-replacement')
    state.register(replacement)
    const flushState = vi.fn(async () => undefined)
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-a',
      startedAt: '2026-08-01T00:00:00.000Z',
      state,
      flushState
    })

    await expect(unregisterRuntimeWithManager({
      manager: manager(),
      flavor: 'production',
      instanceId: 'production-old',
      fetch: routerFetch(router)
    })).resolves.toBe(false)

    expect(flushState).not.toHaveBeenCalled()
    expect(state.registration('production')).toMatchObject({
      instanceId: replacement.instanceId
    })
  })

  it('does not acknowledge a removal when persistence fails', async () => {
    const state = new ServiceManagerState()
    const owner = registration()
    state.register(owner)
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-a',
      startedAt: '2026-08-01T00:00:00.000Z',
      state,
      flushState: async () => { throw new Error('disk full') }
    })

    await expect(dispatchRequest(router, request(
      `/v1/runtimes/production/${owner.instanceId}`,
      { method: 'DELETE' }
    ))).rejects.toThrow('disk full')
  })

  it.each([
    ['unauthorized', async () => Response.json({ code: 'unauthorized' }, { status: 401 })],
    ['server failure', async () => Response.json({ code: 'internal_error' }, { status: 500 })],
    ['invalid JSON', async () => new Response('not-json', { status: 200 })],
    ['connection failure', async () => { throw new Error('connection refused') }]
  ])('surfaces %s instead of treating unregister as success', async (_label, fetchImpl) => {
    await expect(unregisterRuntimeWithManager({
      manager: manager(),
      flavor: 'production',
      instanceId: 'production-runtime',
      fetch: fetchImpl as typeof fetch
    })).rejects.toThrow()
  })
})
