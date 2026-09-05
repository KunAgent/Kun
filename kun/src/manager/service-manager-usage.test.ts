import { afterEach, describe, expect, it, vi } from 'vitest'
import { dispatchRequest } from '../server/http-server.js'
import {
  requestManagerJson,
  type ServiceManagerConnection
} from './manager-client.js'
import { SessionUsageQuerySchema } from './shared-data-store-contracts.js'
import type { ManagerSharedDataStore } from './shared-data-store.js'
import {
  buildServiceManagerRouter,
  ServiceManagerState
} from './service-manager.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

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

describe('manager usage query contract', () => {
  it('accepts complete UTC ranges and rejects partial ranges', () => {
    expect(SessionUsageQuerySchema.parse({
      fromInclusive: '2026-08-01T00:00:00.000Z',
      toExclusive: '2026-08-02T00:00:00.000Z'
    })).toEqual({
      fromInclusive: '2026-08-01T00:00:00.000Z',
      toExclusive: '2026-08-02T00:00:00.000Z'
    })

    expect(() => SessionUsageQuerySchema.parse({
      fromInclusive: '2026-08-01T00:00:00.000Z'
    })).toThrow('usage range requires both boundaries')
  })

  it('maps degraded usage index errors to a typed 503 on the session-store boundary', async () => {
    const executeSession = vi.fn(async () => {
      throw new Error('usage_index_unavailable: hybrid sqlite unavailable')
    })
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-a',
      startedAt: '2026-08-01T00:00:00.000Z',
      state: new ServiceManagerState(),
      sharedData: { executeSession } as unknown as ManagerSharedDataStore
    })

    const response = await dispatchRequest(router, request('/v1/data/session/aggregateUsage', {
      method: 'POST',
      body: JSON.stringify({ value: {} })
    }))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      code: 'usage_index_unavailable',
      message: 'Usage index is temporarily unavailable.'
    })
  })

  it('preserves the manager error code on the remote client error', async () => {
    const executeSession = vi.fn(async () => {
      throw new Error('usage_query_timeout')
    })
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-a',
      startedAt: '2026-08-01T00:00:00.000Z',
      state: new ServiceManagerState(),
      sharedData: { executeSession } as unknown as ManagerSharedDataStore
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

    const error = await requestManagerJson(manager, '/v1/data/session/aggregateUsage', {
      method: 'POST',
      body: { value: {} }
    }).catch((failure: unknown) => failure)

    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      code: 'usage_query_timeout',
      message: expect.stringContaining('usage_query_timeout')
    })
  })
})
