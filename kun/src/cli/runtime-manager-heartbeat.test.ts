import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeRegistration } from '../contracts/runtime-flavor.js'
import { ManagerRuntimeSlotBusyError, type ServiceManagerConnection } from '../manager/manager-client.js'
import { ServiceManagerTransportError } from '../manager/usage-errors.js'
import { startRuntimeManagerHeartbeat } from './runtime-manager-heartbeat.js'

const registration: RuntimeRegistration = {
  flavor: 'production', instanceId: 'runtime-a', pid: 42,
  startedAt: '2026-10-25T00:00:00.000Z', host: '127.0.0.1', port: 18899,
  baseUrl: 'http://127.0.0.1:18899', runtimeToken: 'private-runtime-token'
}
const manager = { discovery: {
  instanceId: 'manager-a', baseUrl: 'http://127.0.0.1:19001', managerToken: 'private-manager-token',
  appOwner: { ownerSessionId: 'app-a', ownerKind: 'gui', ownerPid: 41,
    ownerStartedAt: '2026-10-25T00:00:00.000Z', ownerProcessIdentity: 'test', generation: 1 }
} } as ServiceManagerConnection
const timeout = () => new ServiceManagerTransportError('timeout', 'private-manager-token private-runtime-token')

function fixture(heartbeat = vi.fn().mockResolvedValue(true), owned = true) {
  const onAuthorityChange = vi.fn(), onOwnershipLost = vi.fn(), log = vi.fn()
  const recoverUnownedManager = vi.fn(async (_signal: AbortSignal) => undefined)
  const connection = owned ? manager : { discovery: { ...manager.discovery, appOwner: undefined } }
  const handle = startRuntimeManagerHeartbeat({
    manager: connection, registration, heartbeat,
    onAuthorityChange, onOwnershipLost, log, recoverUnownedManager
  })
  return { handle, heartbeat, onAuthorityChange, onOwnershipLost, log, recoverUnownedManager }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('steady Runtime Manager heartbeat', () => {
  it('retries one timeout on the same Manager and resumes without closing the Runtime', async () => {
    vi.useFakeTimers()
    const f = fixture(vi.fn().mockRejectedValueOnce(timeout()).mockResolvedValue(true))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(f.onAuthorityChange).toHaveBeenLastCalledWith('grace')
    expect(f.onOwnershipLost).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(f.heartbeat).toHaveBeenCalledTimes(2)
    expect(f.heartbeat.mock.calls.every(([input]) => input.manager === manager)).toBe(true)
    expect(f.onAuthorityChange).toHaveBeenLastCalledWith('holder')
    expect(f.onOwnershipLost).not.toHaveBeenCalled()
    expect(f.recoverUnownedManager).not.toHaveBeenCalled()
    expect(f.log.mock.calls.flat().join('\n')).toContain('heartbeat recovered')
    expect(f.log.mock.calls.flat().join('\n')).not.toContain('private-')
    f.handle.stop()
  })

  it('bounds retry frequency during a sustained outage without declaring ownership lost or replacing an app Manager', async () => {
    vi.useFakeTimers()
    const f = fixture(vi.fn().mockRejectedValue(timeout()))
    await vi.advanceTimersByTimeAsync(5_000 + 500 + 1_000 + 2_000)
    expect(f.heartbeat).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(f.heartbeat).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(1)
    expect(f.heartbeat).toHaveBeenCalledTimes(5)
    expect(f.onAuthorityChange.mock.calls.every(([state]) => state === 'grace')).toBe(true)
    expect(f.onOwnershipLost).not.toHaveBeenCalled()
    expect(f.recoverUnownedManager).not.toHaveBeenCalled()
    f.handle.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.heartbeat).toHaveBeenCalledTimes(5)
  })

  it('stops once after an authoritative rejection and never retries that owner', async () => {
    vi.useFakeTimers()
    const f = fixture(vi.fn().mockRejectedValueOnce(timeout()).mockResolvedValue(false))
    await vi.advanceTimersByTimeAsync(5_500)
    expect(f.onAuthorityChange).toHaveBeenLastCalledWith('lost')
    expect(f.onOwnershipLost).toHaveBeenCalledExactlyOnceWith({
      code: 'manager_runtime_ownership_lost', source: 'heartbeat_rejected', managerInstanceId: 'manager-a'
    })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.heartbeat).toHaveBeenCalledTimes(2)
  })

  it.each([false, true])('does not overlap slow heartbeats and ignores a late %s response after shutdown', async (accepted) => {
    vi.useFakeTimers()
    let resolve!: (accepted: boolean) => void
    const pending = new Promise<boolean>(done => { resolve = done })
    const f = fixture(vi.fn(() => pending))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(f.heartbeat).toHaveBeenCalledOnce()
    const signal = f.heartbeat.mock.calls[0]![0].signal as AbortSignal
    f.handle.stop()
    expect(signal.aborted).toBe(true)
    resolve(accepted)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(f.onOwnershipLost).not.toHaveBeenCalled()
    expect(f.onAuthorityChange).not.toHaveBeenCalled()
    expect(f.heartbeat).toHaveBeenCalledOnce()
  })

  it('preserves shared Manager recovery after the retry burst and reports a replacement owner', async () => {
    vi.useFakeTimers()
    const f = fixture(vi.fn().mockRejectedValue(timeout()), false)
    f.recoverUnownedManager.mockRejectedValue(new ManagerRuntimeSlotBusyError({ ...registration, instanceId: 'runtime-b' }))
    await vi.advanceTimersByTimeAsync(5_500)
    expect(f.recoverUnownedManager).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(f.recoverUnownedManager).toHaveBeenCalledOnce()
    expect(f.onOwnershipLost).toHaveBeenCalledExactlyOnceWith({
      code: 'manager_runtime_ownership_lost', source: 'runtime_slot_busy',
      managerInstanceId: 'manager-a', ownerInstanceId: 'runtime-b'
    })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(f.heartbeat).toHaveBeenCalledTimes(3)
  })

  it('treats an ambiguous HTTP conflict as unavailable and stops only on the ownership-loss protocol code', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ code: 'unrelated_conflict', secret: 'private-manager-token' }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ code: 'runtime_instance_changed' }, { status: 409 }))
    vi.stubGlobal('fetch', fetchMock)
    const onAuthorityChange = vi.fn(), onOwnershipLost = vi.fn(), log = vi.fn()
    const handle = startRuntimeManagerHeartbeat({ manager, registration, onAuthorityChange, onOwnershipLost, log })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(onOwnershipLost).not.toHaveBeenCalled()
    expect(onAuthorityChange).toHaveBeenLastCalledWith('grace')
    await vi.advanceTimersByTimeAsync(500)
    expect(onOwnershipLost).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls.every(([url]) => url === `${manager.discovery.baseUrl}/v1/runtimes/production/heartbeat`)).toBe(true)
    expect(log.mock.calls.flat().join('\n')).not.toContain('private-')
    handle.stop()
  })
})
