import { afterEach, expect, it, vi } from 'vitest'
import type { RoomMessage } from '@shared/rooms-api'
import { noteRoomMessageCommitted, noteRoomMessageRendered, roomResponseLatencySnapshot } from './room-im-response-metrics'

afterEach(() => vi.useRealTimers())

it('separately records a bounded commit-to-render sample for a live public bubble', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-29T18:00:00.000Z'))
  const id = 'delivery-metric-test'
  noteRoomMessageCommitted({ roomId: 'room', kind: 'message.created',
    payload: { id }, createdAt: '2026-09-29T17:59:59.800Z' })
  const message = { id, roomId: 'room', deliveryPhase: 'start' } as RoomMessage
  noteRoomMessageRendered(message)
  noteRoomMessageRendered(message)
  expect(roomResponseLatencySnapshot().filter((item) => item.messageId === id)).toEqual([
    { roomId: 'room', messageId: id, phase: 'start', commitToRenderMs: 200 }
  ])
})
