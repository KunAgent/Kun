import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ManagerResourceLeaseClient,
  type ServiceManagerConnection
} from './manager-client.js'

const manager = {
  discovery: {
    baseUrl: 'http://127.0.0.1:19001',
    managerToken: 'manager-token'
  }
} as ServiceManagerConnection

describe('ManagerResourceLeaseClient', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not overlap a slow heartbeat and schedules the next tick after it completes', async () => {
    vi.useFakeTimers()
    let resolveAcquire!: (response: Response) => void
    const pendingAcquire = new Promise<Response>((resolve) => { resolveAcquire = resolve })
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls += 1
      return calls === 1 ? pendingAcquire : renewResponse(1)
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new ManagerResourceLeaseClient(manager, 'production', 'runtime-1')

    const maintained = client.maintain({
      resource: 'desktop-background-services',
      onAcquired: vi.fn(),
      onLost: vi.fn()
    })
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).toHaveBeenCalledOnce()

    resolveAcquire(acquireResponse(true, 1))
    await expect(maintained).resolves.toBe(true)
    await vi.advanceTimersByTimeAsync(2_999)
    expect(fetchMock).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await client.shutdown()
  })

  it('waits for lifecycle callbacks before scheduling the next heartbeat', async () => {
    vi.useFakeTimers()
    let resolveCallback!: () => void
    const callback = new Promise<void>((resolve) => { resolveCallback = resolve })
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      return calls === 1 ? acquireResponse(true, 1) : renewResponse(1)
    }))
    const onAcquired = vi.fn(async () => callback)
    const client = new ManagerResourceLeaseClient(manager, 'production', 'runtime-1')

    const maintained = client.maintain({
      resource: 'desktop-background-services',
      onAcquired,
      onLost: vi.fn()
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(onAcquired).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls).toBe(1)

    resolveCallback()
    await expect(maintained).resolves.toBe(true)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(calls).toBe(2)
    await client.shutdown()
  })

  it('runs lifecycle callbacks only for real held-state transitions', async () => {
    vi.useFakeTimers()
    const responses = [
      acquireResponse(true, 1),
      renewResponse(1),
      new Response(JSON.stringify({ code: 'resource_lease_lost' }), { status: 409 }),
      acquireResponse(false, 2),
      acquireResponse(true, 2)
    ]
    vi.stubGlobal('fetch', vi.fn(async () => responses.shift()!))
    const onAcquired = vi.fn()
    const onLost = vi.fn()
    const client = new ManagerResourceLeaseClient(manager, 'production', 'runtime-1')

    await expect(client.maintain({
      resource: 'desktop-background-services', onAcquired, onLost
    })).resolves.toBe(true)
    await vi.advanceTimersByTimeAsync(3_000)
    await vi.advanceTimersByTimeAsync(3_000)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(onAcquired).toHaveBeenCalledOnce()
    expect(onLost).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(3_000)
    expect(onAcquired).toHaveBeenCalledTimes(2)
    expect(onLost).toHaveBeenCalledOnce()
    await client.shutdown()
  })

  it('invalidates an in-flight heartbeat during shutdown', async () => {
    vi.useFakeTimers()
    let resolveAcquire!: (response: Response) => void
    const pendingAcquire = new Promise<Response>((resolve) => { resolveAcquire = resolve })
    const fetchMock = vi.fn(async () => pendingAcquire)
    vi.stubGlobal('fetch', fetchMock)
    const onAcquired = vi.fn()
    const onLost = vi.fn()
    const client = new ManagerResourceLeaseClient(manager, 'production', 'runtime-1')

    const maintained = client.maintain({
      resource: 'desktop-background-services', onAcquired, onLost
    })
    await Promise.resolve()
    await client.shutdown()
    resolveAcquire(acquireResponse(true, 1))

    await expect(maintained).resolves.toBe(false)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(onAcquired).not.toHaveBeenCalled()
    expect(onLost).not.toHaveBeenCalled()
  })
})

function acquireResponse(acquired: boolean, fencingToken: number): Response {
  return resourceResponse({ acquired, lease: lease(fencingToken) })
}

function renewResponse(fencingToken: number): Response {
  return resourceResponse({ lease: lease(fencingToken) })
}

function resourceResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function lease(fencingToken: number) {
  const now = Date.now()
  return {
    resource: 'desktop-background-services',
    ownerFlavor: 'production',
    ownerInstanceId: 'runtime-1',
    fencingToken,
    acquiredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 10_000).toISOString()
  }
}
