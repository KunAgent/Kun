import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServiceManagerConnection } from './manager-client.js'
import { RemoteRoomStore } from './remote-room-store.js'
import { RoomExecutionLease } from './room-execution-lease.js'
import { RoomCoordinatorUnavailableError, RoomStoreConflictError } from '../rooms/room-store.js'

const manager = { discovery: { baseUrl: 'http://127.0.0.1:19001', managerToken: 'test' } } as ServiceManagerConnection
const leases: RoomExecutionLease[] = []
afterEach(async () => {
  await Promise.all(leases.splice(0).map((lease) => lease.close()))
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function fixture(responses: Response[]) {
  vi.useFakeTimers()
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/release')) return Response.json({ released: true })
    const response = responses.shift()
    if (!response) throw new Error('Unexpected Manager request: ' + url)
    return response
  })
  vi.stubGlobal('fetch', fetchMock)
  const lease = new RoomExecutionLease({ manager, flavor: 'production', instanceId: 'runtime' })
  leases.push(lease)
  return { lease, fetchMock }
}

function response(acquired: boolean, token = 1) {
  return Response.json({ acquired, lease: { resource: 'rooms-coordinator', ownerFlavor: 'production',
    ownerInstanceId: acquired ? 'runtime' : 'foreign-runtime', fencingToken: token,
    acquiredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 10_000).toISOString() } })
}

describe('Room coordinator admission readiness', () => {
  it('waits before maintenance starts and coalesces startup acquisition', async () => {
    const { lease, fetchMock } = fixture([response(true)])
    const settled = vi.fn()
    const ready = lease.ready().then(settled)
    await vi.advanceTimersByTimeAsync(100)
    expect(settled).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await Promise.all([lease.start(), lease.start()])).toEqual([true, true])
    await ready
    expect(settled).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(lease.getFence()).toMatchObject({ ownerInstanceId: 'runtime', fencingToken: 1 })
  })

  it('waits for actual ownership after the first acquisition attempt fails', async () => {
    const { lease, fetchMock } = fixture([new Response('', { status: 503 }), response(true)])
    expect(await lease.start()).toBe(false)
    const settled = vi.fn()
    const ready = lease.ready().then(settled)
    await vi.advanceTimersByTimeAsync(2_999)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await ready
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(lease.held).toBe(true)
  })

  it('waits at new-request admission after lease loss but keeps ongoing commits fail-closed', async () => {
    const { lease, fetchMock } = fixture([response(true), new Response('', { status: 409 }), response(true, 2)])
    await lease.start()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(lease.held).toBe(false)
    const store = new RemoteRoomStore(manager, { getFence: () => lease.getFence(), ready: () => lease.ready() })
    await expect(store.commit({ requestId: 'old-operation' })).rejects.toBeInstanceOf(RoomStoreConflictError)
    await expect(lease.assertOwnership()).rejects.toBeInstanceOf(RoomStoreConflictError)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const settled = vi.fn()
    const admitted = lease.waitForOwnership().then(settled)
    await vi.advanceTimersByTimeAsync(2_999)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await admitted
    expect(lease.getFence()).toMatchObject({ fencingToken: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('times out while a foreign owner retains the lease without ever receiving its fence', async () => {
    const { lease } = fixture(Array.from({ length: 4 }, () => response(false)))
    await lease.start()
    const ready = expect(lease.waitForOwnership()).rejects.toBeInstanceOf(RoomCoordinatorUnavailableError)
    await vi.advanceTimersByTimeAsync(10_000)
    await ready
    expect(lease.getFence()).toBeUndefined()
  })

  it('releases pending admissions before shutdown drains work and cannot restart afterward', async () => {
    const { lease, fetchMock } = fixture([])
    const ready = expect(lease.ready()).rejects.toBeInstanceOf(RoomCoordinatorUnavailableError)
    lease.closeAdmission()
    await ready
    await expect(lease.waitForOwnership()).rejects.toBeInstanceOf(RoomCoordinatorUnavailableError)
    expect(await lease.start()).toBe(false)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels disconnected admission without cancelling other waiters or lease acquisition', async () => {
    const { lease } = fixture([response(true)])
    const controller = new AbortController()
    const cancelled = expect(lease.waitForOwnership(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    const other = lease.waitForOwnership()
    controller.abort()
    await cancelled
    await lease.start()
    await expect(other).resolves.toBeUndefined()
    await expect(lease.waitForOwnership(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('does not admit a waiting request if shutdown wins against acquisition', async () => {
    const { lease } = fixture([response(true)])
    const ready = expect(lease.waitForOwnership()).rejects.toBeInstanceOf(RoomCoordinatorUnavailableError)
    const starting = lease.start()
    lease.closeAdmission()
    await starting
    await ready
  })
})
