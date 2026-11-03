import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManagerThreadExecutionLeaseClient } from './manager-thread-execution-lease-client.js'
import type { ServiceManagerConnection } from './manager-client.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host-core.js'
import { awaitLeaseAuthorityForSideEffectingTool } from '../adapters/tool/lease-grace-gate.js'
import type { ToolHostContext } from '../ports/tool-host.js'

const manager = { discovery: { baseUrl: 'http://127.0.0.1:19001', managerToken: 'test-token' } } as ServiceManagerConnection
const context: ToolHostContext = {
  threadId: 'thread', turnId: 'turn', workspace: '/tmp/kun-runtime-heartbeat',
  approvalPolicy: 'auto', abortSignal: new AbortController().signal, awaitApproval: async () => 'allow'
}
function setup() {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/release')) return Response.json({ released: true })
    return Response.json({ lease: {
      threadId: 'thread', turnId: 'turn', ownerFlavor: 'production', ownerInstanceId: 'runtime',
      fencingToken: 1, acquiredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30_000).toISOString()
    } })
  }))
  return new ManagerThreadExecutionLeaseClient(manager, 'production', 'runtime')
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Runtime heartbeat authority and thread leases', () => {
  it('parks mutations while heartbeat ownership is uncertain even if thread renewals succeed', async () => {
    const client = setup()
    await client.acquire('thread', 'turn')
    const mutate = vi.fn(async () => ({ output: 'changed' }))
    const inspect = vi.fn(async () => ({ output: 'read' }))
    const host = new LocalToolHost({ leaseAuthority: client, tools: [
      { name: 'mutate', description: 'mutate', toolKind: 'tool_call', inputSchema: { type: 'object' }, sideEffect: 'unknown', policy: 'auto', execute: mutate },
      { name: 'inspect', description: 'inspect', toolKind: 'tool_call', inputSchema: { type: 'object' }, sideEffect: 'read-only', policy: 'auto', execute: inspect }
    ] })
    client.setRuntimeAuthority('grace')
    const parked = host.execute({ callId: 'call', toolName: 'mutate', arguments: {} }, context)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(client.authorityState('thread')).toBe('grace')
    expect(mutate).not.toHaveBeenCalled()
    await host.execute({ callId: 'read', toolName: 'inspect', arguments: {} }, context)
    expect(inspect).toHaveBeenCalledOnce()
    client.setRuntimeAuthority('holder')
    await parked
    expect(mutate).toHaveBeenCalledOnce()
    await client.shutdown()
  })

  it('aborts held leases on confirmed Runtime ownership loss and cannot revive them with a late success', async () => {
    const client = setup(), onLost = vi.fn()
    client.setLeaseLostHandler(onLost)
    await client.acquire('thread', 'turn')
    client.setRuntimeAuthority('grace')
    const waiting = client.waitAuthorityResolution('thread')
    client.setRuntimeAuthority('lost')
    await expect(waiting).resolves.toBe('lost')
    expect(onLost).toHaveBeenCalledOnce()
    client.setRuntimeAuthority('holder')
    expect(client.authorityState('thread')).toBe('lost')
    await expect(awaitLeaseAuthorityForSideEffectingTool({ authority: client, threadId: 'thread', signal: context.abortSignal }))
      .resolves.toBe('lost')
    await expect(client.acquire('thread', 'new-turn')).rejects.toThrow('no longer owns')
    await client.shutdown()
  })

  it('waits for a thread renewal acknowledgement after the Runtime heartbeat recovers', async () => {
    const client = setup()
    await client.acquire('thread', 'turn')
    let resolve!: (response: Response) => void
    const renewal = new Promise<Response>(done => { resolve = done })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/renew')
      ? renewal : Response.json({ released: true })))
    client.setRuntimeAuthority('grace')
    const settled = vi.fn()
    const waiting = client.waitAuthorityResolution('thread').then(settled)
    client.setRuntimeAuthority('holder')
    await vi.advanceTimersByTimeAsync(0)
    expect(client.authorityState('thread')).toBe('grace')
    expect(settled).not.toHaveBeenCalled()
    resolve(Response.json({ lease: {
      threadId: 'thread', turnId: 'turn', ownerFlavor: 'production', ownerInstanceId: 'runtime', fencingToken: 1,
      acquiredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30_000).toISOString()
    } }))
    await waiting
    expect(settled).toHaveBeenCalledWith('holder')
    await client.shutdown()
  })

  it('does not revive an expired thread lease when the Runtime heartbeat later recovers', async () => {
    const client = setup()
    await client.acquire('thread', 'turn')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/renew')
      ? Response.json({ code: 'thread_lease_lost' }, { status: 409 })
      : Response.json({ released: false })))
    client.setRuntimeAuthority('grace')
    const waiting = client.waitAuthorityResolution('thread')
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(waiting).resolves.toBe('lost')
    client.setRuntimeAuthority('holder')
    expect(client.authorityState('thread')).toBe('lost')
    await client.shutdown()
  })

  it('releases parked waiters during shutdown even if the Manager never recovers', async () => {
    const client = setup()
    await client.acquire('thread', 'turn')
    client.setRuntimeAuthority('grace')
    const waiting = client.waitAuthorityResolution('thread')
    await client.shutdown()
    await expect(waiting).resolves.toBe('lost')
  })
})
