import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_GRAPH_RUNTIME_CONFIG } from '../config/kun-config.js'
import { GraphReducerError } from '../graph/graph-reducer.js'
import { GraphRunConflictError } from '../graph/graph-run-store.js'
import { dispatchRequest } from '../server/http-server.js'
import { startNodeHttpServer } from '../server/node-http-server.js'
import {
  ManagerRuntimeSlotBusyError,
  requestManagerJson,
  registerRuntimeWithManager,
  type ServiceManagerConnection
} from './manager-client.js'
import { ManagerRemoteGraphRunStore } from './remote-data-stores.js'
import type { ManagerSharedDataStore } from './shared-data-store.js'
import {
  buildServiceManagerRouter,
  RUNTIME_HEARTBEAT_TTL_MS,
  RuntimeSlotBusyError,
  ServiceManagerState,
  THREAD_EXECUTION_LEASE_TTL_MS,
  ThreadLeaseBusyError
} from './service-manager.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function registration(flavor: 'production' | 'development', instanceId = `${flavor}-runtime`) {
  return {
    flavor,
    instanceId,
    pid: process.pid,
    startedAt: '2026-08-01T00:00:00.000Z',
    host: '127.0.0.1',
    port: flavor === 'production' ? 18899 : 18999,
    baseUrl: `http://127.0.0.1:${flavor === 'production' ? 18899 : 18999}`,
    runtimeToken: `${flavor}-secret`
  }
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://127.0.0.1${path}`, {
    ...init,
    headers: {
      authorization: 'Bearer manager-secret',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers
    }
  })
}

describe('service manager control plane', () => {
  it('reports health without exposing the manager token', async () => {
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-a',
      startedAt: '2026-08-01T00:00:00.000Z',
      buildId: 'b'.repeat(64),
      state: new ServiceManagerState()
    })
    const response = await dispatchRequest(router, new Request('http://127.0.0.1/health'))
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(JSON.parse(text)).toMatchObject({
      status: 'ok',
      service: 'kun-service-manager',
      protocolVersion: 5,
      instanceId: 'manager-a',
      buildId: 'b'.repeat(64),
      capabilities: expect.arrayContaining(['item-page-v1'])
    })
    expect(text).not.toContain('manager-secret')
  })

  it('preserves resource fencing high-water across expiry, release, and v1 migration', () => {
    const first = new ServiceManagerState()
    const resource = 'data:state'
    const leaseA = first.acquireResource({
      resource,
      ownerFlavor: 'production',
      ownerInstanceId: 'runtime-a'
    }, new Date('2026-08-01T00:00:00.000Z')).lease
    expect(leaseA.fencingToken).toBe(1)
    expect(first.renewResource(leaseA, new Date('2026-08-01T00:00:01.000Z'))?.fencingToken).toBe(1)
    expect(first.releaseResource(leaseA)).toBe(true)
    const leaseB = first.acquireResource({
      resource,
      ownerFlavor: 'development',
      ownerInstanceId: 'runtime-b'
    }, new Date('2026-08-01T00:00:02.000Z')).lease
    expect(leaseB.fencingToken).toBe(2)
    expect(first.releaseResource(leaseA)).toBe(false)
    expect(first.validateResource(leaseB, new Date('2026-08-01T00:00:03.000Z'))).toBe(true)

    const v1 = {
      version: 1 as const,
      slots: [],
      leases: [],
      resourceLeases: [{
        resource: 'data:legacy',
        ownerFlavor: 'production' as const,
        ownerInstanceId: 'legacy',
        acquiredAt: '2026-08-01T00:00:00.000Z',
        expiresAt: '2026-08-01T00:00:10.000Z'
      }]
    }
    const restored = ServiceManagerState.restore(v1)
    const migrated = restored.durableSnapshot()
    expect(migrated.version).toBe(5)
    const next = restored.acquireResource({
      resource: 'data:legacy',
      ownerFlavor: 'development',
      ownerInstanceId: 'runtime-new'
    }, new Date('2026-08-01T00:00:11.000Z')).lease
    expect(next.fencingToken).toBe(2)
  })

  it('keeps independent production and development runtime slots', async () => {
    const state = new ServiceManagerState()
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-a',
      startedAt: '2026-08-01T00:00:00.000Z',
      state
    })
    for (const flavor of ['production', 'development'] as const) {
      const response = await dispatchRequest(router, request(`/v1/runtimes/${flavor}/register`, {
        method: 'PUT',
        body: JSON.stringify(registration(flavor))
      }))
      expect(response.status).toBe(200)
    }
    expect(state.registration('production')?.port).toBe(18899)
    expect(state.registration('development')?.port).toBe(18999)
  })

  it('preserves one owner per flavor until the registered slot expires', async () => {
    const state = new ServiceManagerState()
    const started = new Date('2026-08-01T00:00:00.000Z')
    const owner = registration('production', 'runtime-owner')
    state.register(owner, started)

    expect(() => state.register(
      registration('production', 'runtime-contender'),
      new Date('2026-08-01T00:00:01.000Z')
    )).toThrow(RuntimeSlotBusyError)
    expect(state.registration('production')).toMatchObject({ instanceId: owner.instanceId })

    expect(state.register({ ...owner, port: 18901 }, new Date('2026-08-01T00:00:02.000Z')))
      .toMatchObject({ instanceId: owner.instanceId, port: 18901 })

    state.expireStale(new Date('2026-08-01T00:00:23.000Z'))
    expect(state.register(
      registration('production', 'runtime-contender'),
      new Date('2026-08-01T00:00:23.000Z')
    )).toMatchObject({ instanceId: 'runtime-contender' })
  })

  it('returns the current registration when a runtime slot is busy', async () => {
    const state = new ServiceManagerState()
    const owner = registration('production', 'runtime-owner')
    state.register(owner)
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-a',
      startedAt: '2026-08-01T00:00:00.000Z',
      state
    })

    const response = await dispatchRequest(router, request('/v1/runtimes/production/register', {
      method: 'PUT',
      body: JSON.stringify(registration('production', 'runtime-contender'))
    }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: 'runtime_slot_busy',
      owner: { flavor: 'production', instanceId: owner.instanceId }
    })
    expect(state.registration('production')).toMatchObject({ instanceId: owner.instanceId })
  })

  it('parses runtime slot conflicts into a typed manager client error', async () => {
    const state = new ServiceManagerState()
    const owner = registration('production', 'runtime-owner')
    state.register(owner)
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-a',
      startedAt: '2026-08-01T00:00:00.000Z',
      state
    })
    const manager: ServiceManagerConnection = {
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
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) =>
      dispatchRequest(router, new Request(url, init))) as typeof fetch

    const conflict = await registerRuntimeWithManager({
      manager,
      registration: registration('production', 'runtime-contender'),
      fetch: fetchImpl
    }).catch((error: unknown) => error)
    expect(conflict).toBeInstanceOf(ManagerRuntimeSlotBusyError)
    expect(conflict).toMatchObject({
      name: 'ManagerRuntimeSlotBusyError',
      owner: { instanceId: owner.instanceId }
    })
  })

  it('preserves GraphRunConflictError across the manager graph-store boundary', async () => {
    const executeGraph = vi.fn().mockRejectedValue(new GraphRunConflictError('graph changed concurrently'))
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-a',
      startedAt: '2026-08-01T00:00:00.000Z',
      state: new ServiceManagerState(),
      sharedData: { executeGraph } as unknown as ManagerSharedDataStore
    })
    const response = await dispatchRequest(router, request('/v1/data/graph/get', {
      method: 'POST',
      body: JSON.stringify({ config: DEFAULT_GRAPH_RUNTIME_CONFIG, value: { runId: 'run_1' } })
    }))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      code: 'graph_run_conflict',
      message: 'graph changed concurrently'
    })

    const manager: ServiceManagerConnection = {
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
    vi.stubGlobal('fetch', (async (url: string | URL | Request, init?: RequestInit) =>
      dispatchRequest(router, new Request(url, init))) as typeof fetch)
    const store = new ManagerRemoteGraphRunStore(manager, () => DEFAULT_GRAPH_RUNTIME_CONFIG)

    const conflict = await store.get('run_1').catch((error: unknown) => error)
    expect(conflict).toBeInstanceOf(GraphRunConflictError)
    expect(conflict).toMatchObject({ message: 'graph changed concurrently' })
  })

  it('does not classify manager failures by GraphRunConflictError message', async () => {
    const manager = {
      discovery: {
        baseUrl: 'http://127.0.0.1:18700',
        managerToken: 'manager-secret'
      }
    } as ServiceManagerConnection
    const error = await requestManagerJson(manager, '/v1/data/graph/get', {
      method: 'POST',
      fetch: (async () => new Response(JSON.stringify({
        code: 'internal_error',
        message: 'graph changed concurrently'
      }), { status: 409 })) as typeof fetch
    }).catch((failure: unknown) => failure)

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(GraphRunConflictError)
  })

  it('leaves GraphReducerError on the manager graph route as HTTP 500', async () => {
    const executeGraph = vi.fn().mockRejectedValue(new GraphReducerError('invalid graph transition'))
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-a',
      startedAt: '2026-08-01T00:00:00.000Z',
      state: new ServiceManagerState(),
      sharedData: { executeGraph } as unknown as ManagerSharedDataStore
    })
    const server = await startNodeHttpServer({ router, host: '127.0.0.1', port: 0 })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/v1/data/graph/get`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer manager-secret',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ config: DEFAULT_GRAPH_RUNTIME_CONFIG, value: { runId: 'run_1' } })
      })
      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toEqual({
        code: 'internal_error',
        message: 'Internal server error.'
      })
    } finally {
      consoleError.mockRestore()
      await server.close()
    }
  })

  it('rejects unauthenticated registration and stale heartbeats', async () => {
    const state = new ServiceManagerState()
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-a',
      startedAt: '2026-08-01T00:00:00.000Z',
      state
    })
    const unauthorized = await dispatchRequest(router, new Request(
      'http://127.0.0.1/v1/runtimes/production/register',
      { method: 'PUT', body: JSON.stringify(registration('production')) }
    ))
    expect(unauthorized.status).toBe(401)

    state.register(registration('production'))
    const heartbeat = await dispatchRequest(router, request('/v1/runtimes/production/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ instanceId: 'stale-runtime' })
    }))
    expect(heartbeat.status).toBe(409)
  })

  it('persists a new fencing token before the acquire response is returned', async () => {
    const state = new ServiceManagerState()
    state.register(registration('production'))
    const flushState = vi.fn(async () => undefined)
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-a',
      startedAt: '2026-08-01T00:00:00.000Z',
      state,
      flushState
    })
    const response = await dispatchRequest(router, request(
      '/v1/leases/threads/thread-durable/acquire',
      {
        method: 'POST',
        body: JSON.stringify({
          turnId: 'turn-durable',
          ownerFlavor: 'production',
          ownerInstanceId: 'production-runtime'
        })
      }
    ))

    expect(response.status).toBe(200)
    expect(flushState).toHaveBeenCalledOnce()
  })

  it('persists an accepted host power report before acknowledging it', async () => {
    const state = new ServiceManagerState()
    const flushState = vi.fn(async () => undefined)
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-a',
      startedAt: '2026-08-01T00:00:00.000Z',
      state,
      flushState
    })
    const response = await dispatchRequest(router, request('/v1/manager/host-power', {
      method: 'POST',
      body: JSON.stringify({
        phase: 'suspend',
        sourceId: 'electron-main',
        sequence: 1,
        observedAt: '2026-08-01T00:00:01.000Z'
      })
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ accepted: true })
    expect(flushState).toHaveBeenCalledOnce()
  })

  it('rejects a valid fence when it targets a different mutation thread', async () => {
    const state = new ServiceManagerState()
    const now = new Date()
    state.register(registration('production'), now)
    const fence = state.acquireLease({
      threadId: 'thread-parent',
      turnId: 'turn-parent',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, now)
    const executeSession = vi.fn(async () => undefined)
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-a',
      startedAt: now.toISOString(),
      state,
      sharedData: { executeSession } as unknown as ManagerSharedDataStore
    })
    const response = await dispatchRequest(router, request('/v1/data/session/appendEvent', {
      method: 'POST',
      body: JSON.stringify({
        value: {
          threadId: 'thread-side',
          event: { threadId: 'thread-side', turnId: 'turn-side' }
        },
        turnFence: {
          threadId: fence.threadId,
          turnId: fence.turnId,
          ownerFlavor: fence.ownerFlavor,
          ownerInstanceId: fence.ownerInstanceId,
          fencingToken: fence.fencingToken
        }
      })
    }))

    expect(response.status).toBe(409)
    expect(executeSession).not.toHaveBeenCalled()
  })

  it('rejects an unfenced write while a turn owns the thread', async () => {
    const state = new ServiceManagerState()
    const now = new Date()
    state.register(registration('production'), now)
    state.acquireLease({
      threadId: 'thread-owned',
      turnId: 'turn-owned',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, now)
    const executeSession = vi.fn(async () => undefined)
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-a',
      startedAt: now.toISOString(),
      state,
      sharedData: { executeSession } as unknown as ManagerSharedDataStore
    })
    const response = await dispatchRequest(router, request('/v1/data/session/appendItem', {
      method: 'POST',
      body: JSON.stringify({
        value: {
          threadId: 'thread-owned',
          item: { threadId: 'thread-owned', turnId: 'turn-owned' }
        }
      })
    }))

    expect(response.status).toBe(409)
    expect(executeSession).not.toHaveBeenCalled()
  })

  it('accepts shutdown only for the current manager instance', async () => {
    const shutdown = vi.fn()
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-a',
      startedAt: '2026-08-01T00:00:00.000Z',
      state: new ServiceManagerState(),
      requestShutdown: shutdown
    })
    const stale = await dispatchRequest(router, request('/v1/manager/shutdown', {
      method: 'POST', body: JSON.stringify({ instanceId: 'manager-old' })
    }))
    expect(stale.status).toBe(409)
    const current = await dispatchRequest(router, request('/v1/manager/shutdown', {
      method: 'POST', body: JSON.stringify({ instanceId: 'manager-a' })
    }))
    expect(current.status).toBe(200)
    expect(shutdown).toHaveBeenCalledOnce()
  })

  it('allows only one runtime flavor to lease a thread', () => {
    const state = new ServiceManagerState()
    const now = new Date('2026-08-01T00:00:00.000Z')
    state.register(registration('production'), now)
    state.register(registration('development'), now)
    const lease = state.acquireLease({
      threadId: 'thread-shared',
      turnId: 'turn-production',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, now)
    expect(lease.ownerFlavor).toBe('production')
    expect(() => state.acquireLease({
      threadId: 'thread-shared',
      turnId: 'turn-development',
      ownerFlavor: 'development',
      ownerInstanceId: 'development-runtime'
    }, now)).toThrow(ThreadLeaseBusyError)
    expect(state.releaseLease({
      threadId: 'thread-shared',
      turnId: 'turn-production',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime',
      fencingToken: lease.fencingToken
    })).toBe(true)
    expect(state.acquireLease({
      threadId: 'thread-shared',
      turnId: 'turn-development',
      ownerFlavor: 'development',
      ownerInstanceId: 'development-runtime'
    }, now).ownerFlavor).toBe('development')
  })

  it('expires leases when the owning runtime heartbeat disappears', () => {
    const state = new ServiceManagerState()
    const started = new Date('2026-08-01T00:00:00.000Z')
    state.register(registration('production'), started)
    state.acquireLease({
      threadId: 'thread-orphan',
      turnId: 'turn-orphan',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, started)
    const expired = state.expireStale(new Date('2026-08-01T00:00:21.000Z'))
    expect(expired).toMatchObject([{ threadId: 'thread-orphan', turnId: 'turn-orphan' }])
    expect(state.lease('thread-orphan', new Date('2026-08-01T00:00:21.000Z'))).toBeNull()
  })

  it('keeps a live owner lease past the former thread-only deadline', () => {
    const state = new ServiceManagerState()
    const started = new Date('2026-08-01T00:00:00.000Z')
    state.register(registration('production'), started)
    const lease = state.acquireLease({
      threadId: 'thread-stalled',
      turnId: 'turn-stalled',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, started)

    const recoveredAt = new Date(started.getTime() + 16_000)
    expect(state.lease('thread-stalled', recoveredAt)).not.toBeNull()
    expect(state.heartbeat('production', 'production-runtime', recoveredAt)).toBe(true)
    const renewed = state.renewLease({
      threadId: 'thread-stalled',
      turnId: 'turn-stalled',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime',
      fencingToken: lease.fencingToken
    }, recoveredAt)
    expect(Date.parse(renewed!.expiresAt) - recoveredAt.getTime())
      .toBe(THREAD_EXECUTION_LEASE_TTL_MS)

    const ownerStaleAt = new Date(recoveredAt.getTime() + RUNTIME_HEARTBEAT_TTL_MS + 1)
    expect(Date.parse(renewed!.expiresAt)).toBeGreaterThan(ownerStaleAt.getTime())
    expect(state.expireStale(ownerStaleAt)).toMatchObject([{
      threadId: 'thread-stalled', turnId: 'turn-stalled'
    }])
  })

  it('expires only the exact Runtime owner recorded by verified forced handoff', () => {
    const state = new ServiceManagerState()
    const now = new Date('2026-08-01T00:00:00.000Z')
    state.register(registration('production', 'production-forced'), now)
    state.register(registration('development', 'development-live'), now)
    state.acquireLease({
      threadId: 'thread-forced',
      turnId: 'turn-forced',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-forced'
    }, now)
    state.acquireLease({
      threadId: 'thread-live',
      turnId: 'turn-live',
      ownerFlavor: 'development',
      ownerInstanceId: 'development-live'
    }, now)
    state.acquireResource({
      resource: 'forced-resource',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-forced'
    }, now)

    const expired = state.expireVerifiedRuntimeOwners([{
      flavor: 'production',
      instanceId: 'production-forced',
      pid: 4101,
      startedAt: now.toISOString()
    }])

    expect(expired).toMatchObject([{
      threadId: 'thread-forced',
      turnId: 'turn-forced'
    }])
    expect(state.registration('production')).toBeNull()
    expect(state.registration('development')).toMatchObject({
      instanceId: 'development-live'
    })
    expect(state.lease('thread-forced', now)).toBeNull()
    expect(state.lease('thread-live', now)).toMatchObject({ turnId: 'turn-live' })
    expect(state.acquireResource({
      resource: 'forced-resource',
      ownerFlavor: 'development',
      ownerInstanceId: 'development-live'
    }, now).acquired).toBe(true)
  })

  it('gives production preference for singleton desktop resources', () => {
    const state = new ServiceManagerState()
    const now = new Date('2026-08-01T00:00:00.000Z')
    expect(state.acquireResource({
      resource: 'desktop-background-services',
      ownerFlavor: 'development',
      ownerInstanceId: 'dv-gui'
    }, now).acquired).toBe(true)
    const production = state.acquireResource({
      resource: 'desktop-background-services',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-gui'
    }, now)
    expect(production).toMatchObject({
      acquired: true,
      lease: { ownerFlavor: 'production', ownerInstanceId: 'production-gui' }
    })
    expect(state.acquireResource({
      resource: 'desktop-background-services',
      ownerFlavor: 'development',
      ownerInstanceId: 'dv-gui'
    }, now).acquired).toBe(false)
  })

  it('does not let production preempt a development data-plane mutex', () => {
    const state = new ServiceManagerState()
    const now = new Date('2026-08-01T00:00:00.000Z')
    expect(state.acquireResource({
      resource: 'data:graph-write-coordinator',
      ownerFlavor: 'development',
      ownerInstanceId: 'development-runtime'
    }, now).acquired).toBe(true)
    expect(state.acquireResource({
      resource: 'data:graph-write-coordinator',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, now).acquired).toBe(false)
  })

  it('restores runtime and lease ownership after a manager restart', () => {
    const before = new ServiceManagerState()
    const now = new Date('2026-08-01T00:00:00.000Z')
    before.register(registration('production'), now)
    before.acquireLease({
      threadId: 'thread-restart',
      turnId: 'turn-restart',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-runtime'
    }, now)
    before.acquireResource({
      resource: 'desktop-background-services',
      ownerFlavor: 'production',
      ownerInstanceId: 'production-gui'
    }, now)

    const after = ServiceManagerState.restore(before.durableSnapshot())
    expect(after.registration('production')).toMatchObject({ instanceId: 'production-runtime' })
    expect(after.lease('thread-restart', new Date('2026-08-01T00:00:01.000Z'))).toMatchObject({
      turnId: 'turn-restart',
      ownerFlavor: 'production'
    })
    expect(after.acquireResource({
      resource: 'desktop-background-services',
      ownerFlavor: 'development',
      ownerInstanceId: 'development-gui'
    }, new Date('2026-08-01T00:00:01.000Z')).acquired).toBe(false)
  })
})
