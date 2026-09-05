import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ManagerThreadExecutionLeaseClient,
  type ServiceManagerConnection
} from './manager-client.js'
import { THREAD_EXECUTION_LEASE_TTL_MS } from './service-manager.js'
import { mutationFenceForValue } from './turn-mutation-context.js'

const manager = {
  discovery: {
    baseUrl: 'http://127.0.0.1:19001',
    managerToken: 'manager-token'
  }
} as ServiceManagerConnection

describe('ManagerThreadExecutionLeaseClient renewal', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('retries a transient renewal failure instead of aborting the live turn', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let renewAttempts = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/acquire')) return leaseResponse(0)
      if (url.endsWith('/renew')) {
        renewAttempts += 1
        if (renewAttempts === 1) throw new Error('temporary manager timeout')
        return leaseResponse(10)
      }
      throw new Error(`unexpected request: ${url}`)
    }))
    const client = new ManagerThreadExecutionLeaseClient(manager, 'production', 'runtime-1')
    const leaseLost = vi.fn()
    client.setLeaseLostHandler(leaseLost)

    await client.acquire('thread-1', 'turn-1')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(renewAttempts).toBe(1)
    expect(leaseLost).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)
    expect(renewAttempts).toBe(2)
    expect(leaseLost).not.toHaveBeenCalled()
    await client.shutdown().catch(() => undefined)
  })

  it('aborts only after the manager definitively rejects the renewal', async () => {
    vi.useFakeTimers()
    let renewAttempts = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/acquire')) return leaseResponse(0)
      if (url.endsWith('/renew')) {
        renewAttempts += 1
        return new Response(JSON.stringify({ code: 'thread_lease_lost' }), {
          status: 409,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.endsWith('/release')) return jsonResponse({ released: false })
      throw new Error(`unexpected request: ${url}`)
    }))
    const client = new ManagerThreadExecutionLeaseClient(manager, 'production', 'runtime-1')
    const leaseLost = vi.fn()
    client.setLeaseLostHandler(leaseLost)

    const lease = await client.acquire('thread-1', 'turn-1')
    await vi.advanceTimersByTimeAsync(5_000)

    expect(leaseLost).toHaveBeenCalledOnce()
    expect(leaseLost).toHaveBeenCalledWith(expect.objectContaining({
      threadId: lease.threadId,
      turnId: lease.turnId,
      fencingToken: lease.fencingToken
    }))
    expect(mutationFenceForValue({
      threadId: lease.threadId,
      turnId: lease.turnId
    })).toMatchObject({ fencingToken: lease.fencingToken })
    await client.release(lease.threadId, lease.turnId)
    expect(mutationFenceForValue({
      threadId: lease.threadId,
      turnId: lease.turnId
    })).toBeUndefined()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(renewAttempts).toBe(1)
    await client.shutdown().catch(() => undefined)
    expect(mutationFenceForValue({
      threadId: lease.threadId,
      turnId: lease.turnId
    })).toBeUndefined()
  })

  it('does not overlap renewals while a slow manager request is still pending', async () => {
    vi.useFakeTimers()
    let resolveRenewal!: (response: Response) => void
    const pendingRenewal = new Promise<Response>((resolve) => { resolveRenewal = resolve })
    let renewAttempts = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/acquire')) return leaseResponse(0)
      if (url.endsWith('/renew')) {
        renewAttempts += 1
        return pendingRenewal
      }
      throw new Error(`unexpected request: ${url}`)
    }))
    const client = new ManagerThreadExecutionLeaseClient(manager, 'production', 'runtime-1')

    await client.acquire('thread-1', 'turn-1')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(renewAttempts).toBe(1)

    resolveRenewal(leaseResponse(10))
    await vi.advanceTimersByTimeAsync(0)
    await client.shutdown().catch(() => undefined)
  })

  it('aborts the turn once renewals stay broken past the lease expiry', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let renewAttempts = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/acquire')) return leaseResponse(0)
      if (url.endsWith('/renew')) {
        renewAttempts += 1
        throw new Error('manager unreachable')
      }
      throw new Error(`unexpected request: ${url}`)
    }))
    const client = new ManagerThreadExecutionLeaseClient(manager, 'production', 'runtime-1')
    const leaseLost = vi.fn()
    client.setLeaseLostHandler(leaseLost)

    const lease = await client.acquire('thread-1', 'turn-1')
    await vi.advanceTimersByTimeAsync(THREAD_EXECUTION_LEASE_TTL_MS - 100)
    expect(leaseLost).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(200)
    expect(leaseLost).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(leaseLost).toHaveBeenCalledOnce()
    expect(leaseLost).toHaveBeenCalledWith(expect.objectContaining({
      threadId: lease.threadId,
      turnId: lease.turnId,
      fencingToken: lease.fencingToken
    }))
    const attemptsAtLoss = renewAttempts

    // The dead runtime stops renewing entirely after the local deadline.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(renewAttempts).toBe(attemptsAtLoss)
    await client.shutdown().catch(() => undefined)
  })

  it('extends the local deadline on every successful renewal', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let networkDown = false
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/acquire')) return leaseResponse(0)
      if (url.endsWith('/renew')) {
        if (networkDown) throw new Error('manager unreachable')
        return leaseResponse(0)
      }
      throw new Error(`unexpected request: ${url}`)
    }))
    const client = new ManagerThreadExecutionLeaseClient(manager, 'production', 'runtime-1')
    const leaseLost = vi.fn()
    client.setLeaseLostHandler(leaseLost)

    await client.acquire('thread-1', 'turn-1')
    // Renewal at t=5s pushes the expiry forward by one lease lifetime.
    await vi.advanceTimersByTimeAsync(5_000)
    networkDown = true

    // Past the original expiry: the turn must still be alive.
    await vi.advanceTimersByTimeAsync(THREAD_EXECUTION_LEASE_TTL_MS - 4_600)
    expect(leaseLost).not.toHaveBeenCalled()

    // Past the renewed expiry: one bounded authoritative-renewal grace runs.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(leaseLost).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(leaseLost).toHaveBeenCalledOnce()
    await client.shutdown().catch(() => undefined)
  })

  it('stops the dead runtime so another runtime can acquire the thread', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let networkDown = false
    const renewAttempts: Record<string, number> = { 'runtime-a': 0, 'runtime-b': 0 }
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        turnId?: string
        ownerInstanceId?: string
      }
      const owner = body.ownerInstanceId ?? 'runtime-1'
      if (url.endsWith('/acquire')) {
        return leaseResponse(0, { turnId: body.turnId ?? 'turn-1', ownerInstanceId: owner })
      }
      if (url.endsWith('/renew')) {
        renewAttempts[owner] = (renewAttempts[owner] ?? 0) + 1
        if (networkDown) throw new Error('manager unreachable')
        return leaseResponse(0, { turnId: body.turnId ?? 'turn-1', ownerInstanceId: owner })
      }
      throw new Error(`unexpected request: ${url}`)
    }))
    const clientA = new ManagerThreadExecutionLeaseClient(manager, 'production', 'runtime-a')
    const lostA = vi.fn()
    clientA.setLeaseLostHandler(lostA)
    const clientB = new ManagerThreadExecutionLeaseClient(manager, 'production', 'runtime-b')
    const lostB = vi.fn()
    clientB.setLeaseLostHandler(lostB)

    // Runtime A holds the thread, then loses connectivity past the lease TTL.
    const leaseA = await clientA.acquire('thread-1', 'turn-a')
    networkDown = true
    await vi.advanceTimersByTimeAsync(THREAD_EXECUTION_LEASE_TTL_MS)
    expect(lostA).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(lostA).toHaveBeenCalledOnce()
    expect(lostA).toHaveBeenCalledWith(expect.objectContaining({
      threadId: leaseA.threadId,
      turnId: leaseA.turnId,
      fencingToken: leaseA.fencingToken
    }))
    const attemptsAAtLoss = renewAttempts['runtime-a']

    // Runtime B takes over; runtime A must stay silent even after recovery.
    networkDown = false
    const leaseB = await clientB.acquire('thread-1', 'turn-b')
    expect(leaseB.turnId).toBe('turn-b')
    await vi.advanceTimersByTimeAsync(10_000)

    expect(renewAttempts['runtime-a']).toBe(attemptsAAtLoss)
    expect(renewAttempts['runtime-b']).toBeGreaterThan(0)
    expect(lostB).not.toHaveBeenCalled()
    await clientA.shutdown().catch(() => undefined)
    await clientB.shutdown().catch(() => undefined)
  })

  it('releases an older turn fence after the same thread acquires a new turn', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as { turnId?: string }
      if (url.endsWith('/acquire')) {
        return leaseResponse(0, { turnId: body.turnId ?? 'turn-old' })
      }
      if (url.endsWith('/release')) {
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`unexpected request: ${url}`)
    }))
    const client = new ManagerThreadExecutionLeaseClient(manager, 'production', 'runtime-1')
    const oldLease = await client.acquire('thread-1', 'turn-old')
    const newLease = await client.acquire('thread-1', 'turn-new')

    await client.release('thread-1', 'turn-old')
    expect(mutationFenceForValue({ threadId: 'thread-1', turnId: 'turn-old' })).toBeUndefined()
    expect(mutationFenceForValue({ threadId: 'thread-1', turnId: 'turn-new' }))
      .toMatchObject({ fencingToken: newLease.fencingToken })

    await client.release('thread-1', 'turn-new')
    await client.shutdown()
    expect(oldLease.turnId).toBe('turn-old')
  })

  it('keeps the mutation fence until shutdown release is acknowledged', async () => {
    let resolveRelease!: (response: Response) => void
    const pendingRelease = new Promise<Response>((resolve) => { resolveRelease = resolve })
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/acquire')) return leaseResponse(0)
      if (url.endsWith('/release')) return pendingRelease
      throw new Error(`unexpected request: ${url}`)
    }))
    const client = new ManagerThreadExecutionLeaseClient(manager, 'production', 'runtime-1')
    const lease = await client.acquire('thread-1', 'turn-1')

    const shutdown = client.shutdown()
    expect(client.shutdown()).toBe(shutdown)
    expect(mutationFenceForValue({ threadId: 'thread-1', turnId: 'turn-1' }))
      .toMatchObject({ fencingToken: lease.fencingToken })

    resolveRelease(jsonResponse({ released: true }))
    await shutdown
    expect(mutationFenceForValue({ threadId: 'thread-1', turnId: 'turn-1' })).toBeUndefined()
  })

  it('waits for a same-turn release before reacquiring a fresh Manager generation', async () => {
    vi.useFakeTimers()
    let resolveOldRelease!: () => void
    const oldRelease = new Promise<void>((resolve) => { resolveOldRelease = resolve })
    let acquireCalls = 0
    let releaseCalls = 0
    let issuedToken = 0
    let managerToken: number | undefined
    const renewedTokens: number[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as { fencingToken?: number }
      if (url.endsWith('/acquire')) {
        acquireCalls += 1
        managerToken ??= ++issuedToken
        return leaseResponse(0, { fencingToken: managerToken })
      }
      if (url.endsWith('/release')) {
        releaseCalls += 1
        if (releaseCalls === 1) {
          await oldRelease
          managerToken = undefined
        }
        return jsonResponse({ released: true })
      }
      if (url.endsWith('/renew')) {
        renewedTokens.push(body.fencingToken ?? -1)
        return leaseResponse(0, { fencingToken: body.fencingToken })
      }
      throw new Error(`unexpected request: ${url}`)
    }))
    const client = new ManagerThreadExecutionLeaseClient(manager, 'production', 'runtime-1')
    await client.acquire('thread-1', 'turn-1')
    const releasingOld = client.release('thread-1', 'turn-1')
    const acquiringNew = client.acquire('thread-1', 'turn-1')
    await Promise.resolve()
    expect(acquireCalls).toBe(1)

    resolveOldRelease()
    await releasingOld
    const newer = await acquiringNew
    expect(newer.fencingToken).toBe(2)
    expect(mutationFenceForValue({ threadId: 'thread-1', turnId: 'turn-1' }))
      .toMatchObject({ fencingToken: newer.fencingToken })

    await vi.advanceTimersByTimeAsync(5_000)
    expect(renewedTokens).toEqual([newer.fencingToken])
    await client.release('thread-1', 'turn-1')
    await client.shutdown()
  })

  it('deduplicates a normal release racing with shutdown', async () => {
    let resolveRelease!: (response: Response) => void
    const pendingRelease = new Promise<Response>((resolve) => { resolveRelease = resolve })
    let releaseCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/acquire')) return leaseResponse(0)
      if (url.endsWith('/release')) {
        releaseCalls += 1
        return pendingRelease
      }
      throw new Error(`unexpected request: ${url}`)
    }))
    const client = new ManagerThreadExecutionLeaseClient(manager, 'production', 'runtime-1')
    await client.acquire('thread-1', 'turn-1')

    const release = client.release('thread-1', 'turn-1')
    const shutdown = client.shutdown()
    expect(releaseCalls).toBe(1)
    resolveRelease(jsonResponse({ released: true }))
    await Promise.all([release, shutdown])
    expect(releaseCalls).toBe(1)
  })

  it('releases an acquire that arrives after shutdown begins', async () => {
    let resolveAcquire!: (response: Response) => void
    const pendingAcquire = new Promise<Response>((resolve) => { resolveAcquire = resolve })
    let releaseCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/acquire')) return pendingAcquire
      if (url.endsWith('/release')) {
        releaseCalls += 1
        return jsonResponse({ released: true })
      }
      throw new Error(`unexpected request: ${url}`)
    }))
    const client = new ManagerThreadExecutionLeaseClient(manager, 'production', 'runtime-1')

    const acquire = client.acquire('thread-1', 'turn-1')
    const shutdown = client.shutdown()
    resolveAcquire(leaseResponse(0))

    await expect(acquire).rejects.toThrow('shutting down')
    await shutdown
    expect(releaseCalls).toBe(1)
    expect(mutationFenceForValue({ threadId: 'thread-1', turnId: 'turn-1' })).toBeUndefined()
  })

  it('ignores a renewal response that arrives after shutdown starts', async () => {
    vi.useFakeTimers()
    let resolveRenewal!: (response: Response) => void
    const pendingRenewal = new Promise<Response>((resolve) => { resolveRenewal = resolve })
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/acquire')) return leaseResponse(0)
      if (url.endsWith('/renew')) return pendingRenewal
      if (url.endsWith('/release')) return jsonResponse({ released: true })
      throw new Error(`unexpected request: ${url}`)
    }))
    const client = new ManagerThreadExecutionLeaseClient(manager, 'production', 'runtime-1')
    await client.acquire('thread-1', 'turn-1')
    await vi.advanceTimersByTimeAsync(5_000)

    await client.shutdown()
    resolveRenewal(leaseResponse(10))
    await vi.advanceTimersByTimeAsync(0)

    expect(mutationFenceForValue({ threadId: 'thread-1', turnId: 'turn-1' })).toBeUndefined()
    await vi.advanceTimersByTimeAsync(10_000)
  })

  it('drains all leases in parallel and aggregates release failures', async () => {
    const releasedTurns: string[] = []
    let failTurnOne = true
    let pendingReleaseCount = 0
    let resolveReleases!: () => void
    const releaseGate = new Promise<void>((resolve) => { resolveReleases = resolve })
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as { turnId?: string }
      if (url.endsWith('/acquire')) {
        const threadId = url.includes('thread-2') ? 'thread-2' : 'thread-1'
        return leaseResponse(0, { threadId, turnId: body.turnId })
      }
      if (url.endsWith('/release')) {
        pendingReleaseCount += 1
        releasedTurns.push(body.turnId ?? '')
        await releaseGate
        if (body.turnId === 'turn-1' && failTurnOne) throw new Error('manager release failed')
        return jsonResponse({ released: false })
      }
      throw new Error(`unexpected request: ${url}`)
    }))
    const client = new ManagerThreadExecutionLeaseClient(manager, 'production', 'runtime-1')
    await client.acquire('thread-1', 'turn-1')
    await client.acquire('thread-2', 'turn-2')

    const shutdown = client.shutdown()
    await vi.waitFor(() => expect(pendingReleaseCount).toBe(2))
    resolveReleases()

    await expect(shutdown).rejects.toThrow('one or more thread execution leases')
    expect(releasedTurns.filter((turnId) => turnId === 'turn-1')).toHaveLength(3)
    expect(releasedTurns.filter((turnId) => turnId === 'turn-2')).toHaveLength(1)
    expect(mutationFenceForValue({ threadId: 'thread-1', turnId: 'turn-1' }))
      .toMatchObject({ fencingToken: 1 })
    expect(mutationFenceForValue({ threadId: 'thread-2', turnId: 'turn-2' })).toBeUndefined()
    failTurnOne = false
    await client.release('thread-1', 'turn-1')
    expect(mutationFenceForValue({ threadId: 'thread-1', turnId: 'turn-1' })).toBeUndefined()
  })
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function leaseResponse(
  seconds: number,
  overrides: {
    threadId?: string
    turnId?: string
    ownerInstanceId?: string
    fencingToken?: number
  } = {}
): Response {
  const now = Date.now()
  return new Response(JSON.stringify({
    lease: {
      threadId: overrides.threadId ?? 'thread-1',
      turnId: overrides.turnId ?? 'turn-1',
      ownerFlavor: 'production',
      ownerInstanceId: overrides.ownerInstanceId ?? 'runtime-1',
      fencingToken: overrides.fencingToken ?? 1,
      acquiredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + seconds * 1_000 + THREAD_EXECUTION_LEASE_TTL_MS).toISOString()
    }
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}
