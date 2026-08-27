import { describe, expect, it, vi } from 'vitest'
import type { ServiceManagerConnection } from '../../../kun/src/manager/manager-client.js'
import { listServiceManagerRuntimeActiveWork } from './service-manager-runtime-active-work'

function manager(): ServiceManagerConnection {
  return {
    discovery: {
      version: 1,
      protocolVersion: 3,
      instanceId: 'manager-a',
      pid: process.pid,
      startedAt: '2026-08-16T00:00:00.000Z',
      host: '127.0.0.1',
      port: 18700,
      baseUrl: 'http://127.0.0.1:18700',
      managerToken: 'manager-token',
      serviceVersion: '0.3.3',
      dataDir: '/tmp/kun-data',
      settingsPath: '/tmp/kun-settings.json'
    }
  }
}

function registration(pid: number) {
  return {
    flavor: 'production' as const,
    instanceId: 'runtime-a',
    pid,
    startedAt: '2026-08-16T00:00:00.000Z',
    host: '127.0.0.1',
    port: 18899,
    baseUrl: 'http://127.0.0.1:18899',
    runtimeToken: 'runtime-token'
  }
}

describe('Service Manager Runtime active-work discovery', () => {
  it('removes a dead Manager registration before migration sees an external writer', async () => {
    const current = manager()
    let productionRegistration: ReturnType<typeof registration> | null = registration(2_147_483_647)
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url)
      if (target === `${current.discovery.baseUrl}/v1/runtimes/production`) {
        return Response.json({ registration: productionRegistration })
      }
      if (target === `${current.discovery.baseUrl}/v1/runtimes/development`) {
        return Response.json({ registration: null })
      }
      if (
        target === `${current.discovery.baseUrl}/v1/runtimes/production/runtime-a` &&
        init?.method === 'DELETE'
      ) {
        productionRegistration = null
        return Response.json({ removed: true })
      }
      return new Response('', { status: 404 })
    })

    await expect(listServiceManagerRuntimeActiveWork(current, {
      fetch: fetchMock as unknown as typeof fetch
    })).resolves.toEqual([])

    expect(fetchMock).toHaveBeenCalledWith(
      `${current.discovery.baseUrl}/v1/runtimes/production/runtime-a`,
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('keeps a live but unresponsive Runtime as a non-interruptible external writer', async () => {
    const current = manager()
    const live = registration(process.pid)
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const target = String(url)
      if (target === `${current.discovery.baseUrl}/v1/runtimes/production`) {
        return Response.json({ registration: live })
      }
      if (target === `${current.discovery.baseUrl}/v1/runtimes/development`) {
        return Response.json({ registration: null })
      }
      if (target === `${live.baseUrl}/v1/runtime/info` ||
        target === `${live.baseUrl}/v1/threads?limit=500&include=side`) {
        return new Response('', { status: 503 })
      }
      return new Response('', { status: 404 })
    })

    await expect(listServiceManagerRuntimeActiveWork(current, {
      fetch: fetchMock as unknown as typeof fetch
    })).resolves.toEqual([{
      kind: 'external-writer',
      id: 'runtime:production:runtime-a',
      label: 'production Runtime could not be inspected',
      interruptible: false
    }])

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
  })
})
