import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ManagerThreadExecutionLeaseClient,
  type ServiceManagerConnection
} from './manager-client.js'

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
    client.shutdown()
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
      throw new Error(`unexpected request: ${url}`)
    }))
    const client = new ManagerThreadExecutionLeaseClient(manager, 'production', 'runtime-1')
    const leaseLost = vi.fn()
    client.setLeaseLostHandler(leaseLost)

    const lease = await client.acquire('thread-1', 'turn-1')
    await vi.advanceTimersByTimeAsync(5_000)

    expect(leaseLost).toHaveBeenCalledOnce()
    expect(leaseLost).toHaveBeenCalledWith(lease)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(renewAttempts).toBe(1)
    client.shutdown()
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
    client.shutdown()
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
    await vi.advanceTimersByTimeAsync(14_900)
    expect(leaseLost).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(200)
    expect(leaseLost).toHaveBeenCalledOnce()
    expect(leaseLost).toHaveBeenCalledWith(lease)
    const attemptsAtLoss = renewAttempts

    // The dead runtime stops renewing entirely after the local deadline.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(renewAttempts).toBe(attemptsAtLoss)
    client.shutdown()
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
    // Renewal at t=5s pushes the expiry from t=15s to t=20s.
    await vi.advanceTimersByTimeAsync(5_000)
    networkDown = true

    // Past the original expiry: the turn must still be alive.
    await vi.advanceTimersByTimeAsync(10_400)
    expect(leaseLost).not.toHaveBeenCalled()

    // Past the renewed expiry: the local deadline aborts the turn.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(leaseLost).toHaveBeenCalledOnce()
    client.shutdown()
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

    // Runtime A holds the thread, then loses connectivity past the 15s TTL.
    const leaseA = await clientA.acquire('thread-1', 'turn-a')
    networkDown = true
    await vi.advanceTimersByTimeAsync(15_000)
    expect(lostA).toHaveBeenCalledOnce()
    expect(lostA).toHaveBeenCalledWith(leaseA)
    const attemptsAAtLoss = renewAttempts['runtime-a']

    // Runtime B takes over; runtime A must stay silent even after recovery.
    networkDown = false
    const leaseB = await clientB.acquire('thread-1', 'turn-b')
    expect(leaseB.turnId).toBe('turn-b')
    await vi.advanceTimersByTimeAsync(10_000)

    expect(renewAttempts['runtime-a']).toBe(attemptsAAtLoss)
    expect(renewAttempts['runtime-b']).toBeGreaterThan(0)
    expect(lostB).not.toHaveBeenCalled()
    clientA.shutdown()
    clientB.shutdown()
  })
})

function leaseResponse(
  seconds: number,
  overrides: { threadId?: string, turnId?: string, ownerInstanceId?: string } = {}
): Response {
  const now = Date.now()
  return new Response(JSON.stringify({
    lease: {
      threadId: overrides.threadId ?? 'thread-1',
      turnId: overrides.turnId ?? 'turn-1',
      ownerFlavor: 'production',
      ownerInstanceId: overrides.ownerInstanceId ?? 'runtime-1',
      acquiredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + (seconds + 15) * 1_000).toISOString()
    }
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}
