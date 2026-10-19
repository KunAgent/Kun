import { afterEach, expect, it, vi } from 'vitest'
import { notifyRoomStoreCommit } from '../../rooms/room-commit-signal.js'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RoomStoreEvent } from '../../rooms/room-store.js'
import { roomEventStream } from './room-event-stream.js'
import type { ServerRuntime } from './server-runtime.js'

afterEach(() => { vi.useRealTimers() })

it('backs off while a room is quiet and wakes on a local room write', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const pending: RoomStoreEvent[] = []
  const events = vi.fn(async (_roomId: string, sinceSeq = 0) => pending.filter((event) => event.seq > sinceSeq))
  const controller = new AbortController()
  const response = roomEventStream({
    runtime: {} as ServerRuntime,
    rooms: { service: { store: { events } } } as unknown as RoomRuntime,
    roomId: 'room-a',
    request: new Request('http://kun.test/v1/rooms/room-a/events', { signal: controller.signal }),
    sinceSeq: 0
  })
  const reader = response.body!.getReader()
  await reader.read()
  await vi.advanceTimersByTimeAsync(0)
  events.mockClear()

  // Quiet polls step from 500 ms to a 2 s cap.
  await vi.advanceTimersByTimeAsync(10_000)
  expect(events.mock.calls.length).toBeLessThanOrEqual(6)
  expect(events.mock.calls.length).toBeGreaterThanOrEqual(4)

  pending.push({ seq: 1, roomId: 'room-a', kind: 'room_updated', payload: {}, createdAt: new Date().toISOString() } as RoomStoreEvent)
  events.mockClear()
  notifyRoomStoreCommit()
  await vi.advanceTimersByTimeAsync(0)
  expect(events).toHaveBeenCalledTimes(1)
  const delivered = await reader.read()
  expect(new TextDecoder().decode(delivered.value)).toContain('event: room_updated')

  controller.abort()
  await reader.cancel().catch(() => undefined)
})
