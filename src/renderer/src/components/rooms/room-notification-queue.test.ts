import { describe, expect, it, vi } from 'vitest'
import { RoomNotificationQueue } from './room-notification-queue'
import { roomResourceAffected, sharedRoomRead } from './room-resource-events'
const request = vi.hoisted(() => vi.fn())
vi.mock('./rooms-client', () => ({ roomsRequest: request }))
const event = (seq: number) => ({ seq, roomId: 'room', kind: 'request.updated', payload: { id: 'request' } })
describe('durable Room notification compensation', () => {
  it('retries a transient failure without another event, including after a reload', async () => {
    let saved = ''
    const queue = new RoomNotificationQueue(0, (value) => { saved = value })
    queue.accept(event(1))
    const deliver = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('request:needs_input:1')
    await queue.drain(deliver, 0)
    expect(queue.pendingCount).toBe(1)
    const resumed = new RoomNotificationQueue(999, (value) => { saved = value }, saved)
    await resumed.drain(deliver, 999)
    expect(deliver).toHaveBeenCalledTimes(1)
    await resumed.drain(deliver, 1000)
    expect(deliver).toHaveBeenCalledTimes(2)
    expect(resumed.pendingCount).toBe(0)
    expect(resumed.accept(event(1))).toBe(false)
    resumed.accept(event(2))
    await resumed.drain(async (_event, known) => {
      expect(known('request:needs_input:1')).toBe(true)
      return 'request:needs_input:1'
    }, 2000)
    expect(resumed.pendingCount).toBe(0)
  })
  it('keeps a newer gate pending if it arrives while an older notice is being handled', async () => {
    const queue = new RoomNotificationQueue(0, () => {})
    queue.accept(event(1))
    let finish!: (value: string) => void
    const pending = queue.drain(() => new Promise<string>((resolve) => { finish = resolve }), 0)
    queue.accept(event(2))
    finish('first-gate')
    await pending
    expect(queue.pendingCount).toBe(1)
    await queue.drain(async (item, known) => {
      expect(item.seq).toBe(2)
      expect(known('first-gate')).toBe(true)
      return 'second-gate'
    }, 1)
    expect(queue.pendingCount).toBe(0)
  })
  it('clears already resolved or unavailable entities without inventing a notification', async () => {
    const queue = new RoomNotificationQueue(0, () => {})
    queue.accept(event(1))
    await queue.drain(async () => null, 0)
    expect(queue.pendingCount).toBe(0)
  })
})
describe('room resource invalidation', () => {
  it('ignores message streams for histories and targets task detail refreshes', () => {
    const path = '/v1/rooms/room/tasks/one/deliveries'
    expect(roomResourceAffected(path, { roomId: 'room', kind: 'message.updated', payload: { id: 'message' } })).toBe(false)
    expect(roomResourceAffected(path, { roomId: 'room', kind: 'delivery.updated', payload: { taskId: 'two' } })).toBe(false)
    expect(roomResourceAffected(path, { roomId: 'room', kind: 'delivery.updated', payload: { taskId: 'one' } })).toBe(true)
  })
  it('coalesces concurrent reads without caching obsolete completed responses', async () => {
    let resolve!: (value: object) => void
    request.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const a = sharedRoomRead('/example'), b = sharedRoomRead('/example')
    expect(request).toHaveBeenCalledTimes(1)
    resolve({ revision: 1 })
    expect(await a).toEqual(await b)
    request.mockResolvedValueOnce({ revision: 2 })
    expect(await sharedRoomRead('/example')).toEqual({ revision: 2 })
    expect(request).toHaveBeenCalledTimes(2)
  })
})
