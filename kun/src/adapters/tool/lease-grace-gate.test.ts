import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ManagerThreadExecutionLeaseClient,
  type ServiceManagerConnection
} from '../../manager/manager-client.js'
import { THREAD_EXECUTION_LEASE_TTL_MS } from '../../manager/service-manager.js'
import { LocalToolHost } from './local-tool-host-core.js'
import type { LocalTool } from './local-tool-host-types.js'
import type { ToolHostContext } from '../../ports/tool-host.js'

const manager = {
  discovery: {
    baseUrl: 'http://127.0.0.1:19001',
    managerToken: 'manager-token'
  }
} as ServiceManagerConnection

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function leaseResponse(
  ttlMs: number,
  overrides?: { turnId?: string; ownerInstanceId?: string; fencingToken?: number }
): Response {
  const now = Date.now()
  return jsonResponse({
    lease: {
      threadId: 'thread-1',
      turnId: overrides?.turnId ?? 'turn-a',
      ownerFlavor: 'production',
      ownerInstanceId: overrides?.ownerInstanceId ?? 'runtime-a',
      fencingToken: overrides?.fencingToken ?? 1,
      acquiredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString()
    }
  })
}

const NEVER = new Promise<Response>(() => undefined)

function sideEffectTool(name: string, run: () => Promise<{ output: unknown }>): LocalTool {
  return {
    name,
    description: `${name} (side effecting)`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    toolKind: 'tool_call',
    sideEffect: 'unknown',
    policy: 'auto',
    execute: run
  }
}

function readOnlyTool(name: string, run: () => Promise<{ output: unknown }>): LocalTool {
  return {
    name,
    description: `${name} (read only)`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    toolKind: 'tool_call',
    sideEffect: 'read-only',
    policy: 'auto',
    execute: run
  }
}

function toolContext(signal: AbortSignal): ToolHostContext {
  return {
    threadId: 'thread-1',
    turnId: 'turn-a',
    workspace: '/tmp/kun-lease-gate-test',
    approvalPolicy: 'auto',
    abortSignal: signal,
    awaitApproval: async () => 'allow'
  }
}

describe('lease grace window side-effect tool gate', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('holder state never pauses side-effecting tools', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/acquire')) return leaseResponse(THREAD_EXECUTION_LEASE_TTL_MS)
      if (url.endsWith('/renew')) return leaseResponse(THREAD_EXECUTION_LEASE_TTL_MS)
      throw new Error(`unexpected request: ${url}`)
    }))
    const client = new ManagerThreadExecutionLeaseClient(manager, 'production', 'runtime-a')
    const executed: string[] = []
    const host = new LocalToolHost({
      tools: [sideEffectTool('mutate', async () => {
        executed.push('mutate')
        return { output: { ok: true } }
      })],
      leaseAuthority: client
    })
    await client.acquire('thread-1', 'turn-a')

    const result = await host.execute(
      { callId: 'c1', toolName: 'mutate', arguments: {} },
      toolContext(new AbortController().signal)
    )
    expect(result.item.kind === 'tool_result' && result.item.isError).toBe(false)
    expect(executed).toEqual(['mutate'])
    await client.shutdown().catch(() => undefined)
  })

  it('suspends side-effecting tools during sleep/wake grace and resumes after renewal recovers', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let hostAsleep = false
    let resolveSuspendedRenewal: (() => void) | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/acquire')) return leaseResponse(THREAD_EXECUTION_LEASE_TTL_MS)
      if (url.endsWith('/renew')) {
        // A suspended host cannot even fail the renewal: the request hangs
        // until the host wakes and the network path answers again. A hanging
        // renewal keeps the local deadline anchored at t=30s.
        if (hostAsleep) {
          await new Promise<void>((resolve) => { resolveSuspendedRenewal = resolve })
        }
        return leaseResponse(THREAD_EXECUTION_LEASE_TTL_MS)
      }
      throw new Error(`unexpected request: ${url}`)
    }))
    const client = new ManagerThreadExecutionLeaseClient(manager, 'production', 'runtime-a')
    const leaseLost = vi.fn()
    client.setLeaseLostHandler(leaseLost)
    const executed: string[] = []
    const host = new LocalToolHost({
      tools: [
        sideEffectTool('mutate', async () => {
          executed.push('mutate')
          return { output: { ok: true } }
        }),
        readOnlyTool('inspect', async () => {
          executed.push('inspect')
          return { output: { ok: true } }
        })
      ],
      leaseAuthority: client
    })
    await client.acquire('thread-1', 'turn-a')
    hostAsleep = true

    // Sleep past the lease TTL: the local deadline fires at t=30s and the
    // runtime enters its unilateral 20s grace window.
    await vi.advanceTimersByTimeAsync(THREAD_EXECUTION_LEASE_TTL_MS)
    expect(client.authorityState('thread-1')).toBe('grace')
    expect(leaseLost).not.toHaveBeenCalled()

    // Side-effecting dispatch parks; read-only dispatch still flows.
    const parked = host.execute(
      { callId: 'c2', toolName: 'mutate', arguments: {} },
      toolContext(new AbortController().signal)
    )
    await vi.advanceTimersByTimeAsync(5_000)
    expect(executed).toEqual([])
    const readResult = await host.execute(
      { callId: 'c3', toolName: 'inspect', arguments: {} },
      toolContext(new AbortController().signal)
    )
    expect(readResult.item.kind === 'tool_result' && readResult.item.isError).toBe(false)
    expect(executed).toEqual(['inspect'])

    // Wake up inside the grace window: the hanging renewal settles
    // successfully, the parked side-effecting call resumes, and the fence
    // generation is unchanged.
    hostAsleep = false
    resolveSuspendedRenewal?.()
    await vi.advanceTimersByTimeAsync(500)
    const parkedResult = await parked
    expect(parkedResult.item.kind === 'tool_result' && parkedResult.item.isError).toBe(false)
    expect(executed).toEqual(['inspect', 'mutate'])
    expect(client.authorityState('thread-1')).toBe('holder')
    expect(leaseLost).not.toHaveBeenCalled()
    await client.shutdown().catch(() => undefined)
  })

  it('keeps side-effecting tools parked through network isolation until lease loss aborts', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/acquire')) return leaseResponse(THREAD_EXECUTION_LEASE_TTL_MS)
      // An isolated manager never answers; the renewal hangs instead of
      // failing, so the local deadline stays anchored at t=30s.
      if (url.endsWith('/renew')) return NEVER
      throw new Error(`unexpected request: ${url}`)
    }))
    const client = new ManagerThreadExecutionLeaseClient(manager, 'production', 'runtime-a')
    const leaseLost = vi.fn()
    client.setLeaseLostHandler(leaseLost)
    const executed: string[] = []
    const controller = new AbortController()
    const host = new LocalToolHost({
      tools: [
        sideEffectTool('mutate', async () => {
          executed.push('mutate')
          return { output: { ok: true } }
        }),
        readOnlyTool('inspect', async () => {
          executed.push('inspect')
          return { output: { ok: true } }
        })
      ],
      leaseAuthority: client
    })
    const lease = await client.acquire('thread-1', 'turn-a')

    await vi.advanceTimersByTimeAsync(THREAD_EXECUTION_LEASE_TTL_MS)
    expect(client.authorityState('thread-1')).toBe('grace')

    const parked = host.execute(
      { callId: 'c4', toolName: 'mutate', arguments: {} },
      toolContext(controller.signal)
    )
    // Attach a swallow handler before the rejection can surface.
    const parkedOutcome = parked.catch((error: unknown) => error)
    const readResult = await host.execute(
      { callId: 'c5', toolName: 'inspect', arguments: {} },
      toolContext(new AbortController().signal)
    )
    expect(readResult.item.kind === 'tool_result' && readResult.item.isError).toBe(false)
    expect(executed).toEqual(['inspect'])

    // Grace expires without a successful renewal: lease is lost, the turn
    // aborts, and the parked side-effecting call never starts.
    await vi.advanceTimersByTimeAsync(20_000)
    expect(leaseLost).toHaveBeenCalledOnce()
    expect(leaseLost).toHaveBeenCalledWith(expect.objectContaining({
      threadId: lease.threadId,
      turnId: lease.turnId,
      fencingToken: lease.fencingToken
    }))
    expect(client.authorityState('thread-1')).toBe('lost')
    controller.abort(new Error('owner lease expired'))
    const outcome = await parkedOutcome
    expect(outcome).toBeInstanceOf(Error)
    expect(executed).toEqual(['inspect'])
    await client.shutdown().catch(() => undefined)
  })

  it('blocks the old runtime side effects after a takeover even when its grace renewal gets 409', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let hostAAsleep = false
    let resolveSuspendedRenewal: (() => void) | undefined
    let owner: string | undefined
    let fenceHighWater = 0
    const ownerToken = new Map<string, number>()
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        turnId?: string
        ownerInstanceId?: string
        fencingToken?: number
      }
      const instance = body.ownerInstanceId ?? 'runtime-a'
      if (url.endsWith('/acquire')) {
        if (owner && owner !== instance) {
          return jsonResponse({ code: 'thread_busy' }, 409)
        }
        owner = instance
        const token = ++fenceHighWater
        ownerToken.set(instance, token)
        return leaseResponse(THREAD_EXECUTION_LEASE_TTL_MS, {
          turnId: body.turnId,
          ownerInstanceId: instance,
          fencingToken: token
        })
      }
      if (url.endsWith('/renew')) {
        // A's renewal hangs while the host is suspended; it only settles
        // (with a now-stale token) after the host wakes.
        if (instance === 'runtime-a' && hostAAsleep) {
          await new Promise<void>((resolve) => { resolveSuspendedRenewal = resolve })
        }
        if (owner !== instance || ownerToken.get(instance) !== body.fencingToken) {
          return jsonResponse({ code: 'thread_lease_lost' }, 409)
        }
        return leaseResponse(THREAD_EXECUTION_LEASE_TTL_MS, {
          turnId: body.turnId,
          ownerInstanceId: instance,
          fencingToken: body.fencingToken
        })
      }
      throw new Error(`unexpected request: ${url}`)
    }))
    const clientA = new ManagerThreadExecutionLeaseClient(manager, 'production', 'runtime-a')
    const lostA = vi.fn()
    clientA.setLeaseLostHandler(lostA)
    const clientB = new ManagerThreadExecutionLeaseClient(manager, 'production', 'runtime-b')
    const executed: string[] = []
    const controller = new AbortController()
    const hostA = new LocalToolHost({
      tools: [sideEffectTool('mutate', async () => {
        executed.push('mutate')
        return { output: { ok: true } }
      })],
      leaseAuthority: clientA
    })
    const leaseA = await clientA.acquire('thread-1', 'turn-a')
    hostAAsleep = true

    // A sleeps past its lease TTL; Manager expires it and B takes over with a
    // fresh fencing token while A is inside its local grace window.
    await vi.advanceTimersByTimeAsync(THREAD_EXECUTION_LEASE_TTL_MS)
    expect(clientA.authorityState('thread-1')).toBe('grace')
    owner = undefined
    const leaseB = await clientB.acquire('thread-1', 'turn-b')
    expect(leaseB.fencingToken).toBeGreaterThan(leaseA.fencingToken)

    // A wakes inside its grace window and parks a side-effecting call.
    const parked = hostA.execute(
      { callId: 'c6', toolName: 'mutate', arguments: {} },
      toolContext(controller.signal)
    )
    const parkedOutcome = parked.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(executed).toEqual([])

    // A's grace renewal reaches Manager but its token is stale: 409, lease
    // lost, parked side effect is released only into the abort path.
    hostAAsleep = false
    resolveSuspendedRenewal?.()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(lostA).toHaveBeenCalledOnce()
    expect(clientA.authorityState('thread-1')).toBe('lost')
    controller.abort(new Error('owner lease expired'))
    const outcome = await parkedOutcome
    expect(outcome).toBeInstanceOf(Error)
    expect(executed).toEqual([])
    await clientA.shutdown().catch(() => undefined)
    await clientB.shutdown().catch(() => undefined)
  })

  it('resolves a parked wait immediately when authority is lost before any waiter attaches', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/acquire')) return leaseResponse(THREAD_EXECUTION_LEASE_TTL_MS)
      if (url.endsWith('/renew')) return NEVER
      throw new Error(`unexpected request: ${url}`)
    }))
    const client = new ManagerThreadExecutionLeaseClient(manager, 'production', 'runtime-a')
    const leaseLost = vi.fn()
    client.setLeaseLostHandler(leaseLost)
    await client.acquire('thread-1', 'turn-a')

    // Drive the client through grace into authoritative loss with no waiter
    // attached, then attach one: it must resolve `lost` immediately instead
    // of hanging forever.
    await vi.advanceTimersByTimeAsync(THREAD_EXECUTION_LEASE_TTL_MS + 20_000)
    expect(leaseLost).toHaveBeenCalledOnce()
    expect(client.authorityState('thread-1')).toBe('lost')
    await expect(client.waitAuthorityResolution('thread-1')).resolves.toBe('lost')
    await client.shutdown().catch(() => undefined)
  })
})
