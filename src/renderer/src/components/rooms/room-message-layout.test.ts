import { describe, expect, it } from 'vitest'
import type { RoomMessage } from '@shared/rooms-api'
import { roomMessageLayout } from './room-message-layout'

const message = (time: Date, overrides: Partial<RoomMessage> = {}) => ({
  authorKind: 'member', authorMemberId: 'agent-a', authorLabelSnapshot: 'Agent A',
  createdAt: time.toISOString(), ...overrides
}) as RoomMessage

describe('IM message grouping', () => {
  it('groups nearby messages from the same agent without changing the day label', () => {
    const first = message(new Date(2026, 8, 15, 12, 0))
    expect(roomMessageLayout(undefined, first)).toEqual({ newDay: true, continuation: false })
    expect(roomMessageLayout(first, message(new Date(2026, 8, 15, 12, 4))))
      .toEqual({ newDay: false, continuation: true })
  })

  it('breaks groups when the speaker, day, gap or message presentation changes', () => {
    const first = message(new Date(2026, 8, 15, 23, 59))
    expect(roomMessageLayout(first, message(new Date(2026, 8, 16, 0, 1))).continuation).toBe(false)
    expect(roomMessageLayout(first, message(new Date(2026, 8, 15, 23, 59, 30), { authorMemberId: 'agent-b' })).continuation).toBe(false)
    expect(roomMessageLayout(message(new Date(2026, 8, 15, 12, 0)),
      message(new Date(2026, 8, 15, 12, 7))).continuation).toBe(false)
    expect(roomMessageLayout(first, message(new Date(2026, 8, 15, 23, 59, 30), { presentationKind: 'choice' })).continuation).toBe(false)
  })
})
