import { describe, expect, it } from 'vitest'
import type { RoomRunRecord } from '@shared/rooms-api'
import { sessionRuns } from './room-agent-session-runs'

const run = (id: string, createdAt: string, extra: Partial<RoomRunRecord> = {}) => ({ id, roomId: 'room', memberId: 'member',
  memberLabel: 'Kun', phase: 'conversation', attempt: 1, clientRequestId: id, input: id, attachmentIds: [], status: 'completed',
  createdAt, updatedAt: createdAt, threadId: 'thread-a', ...extra }) as RoomRunRecord

describe('sessionRuns', () => {
  it('orders every conversation run oldest first', () => {
    expect(sessionRuns([run('b', '2026-10-09T02:00:00Z', { turnId: 't2' }), run('a', '2026-10-09T01:00:00Z', { turnId: 't1' }),
      run('memory', '2026-10-09T01:30:00Z', { phase: 'memory' })]).map((item) => item.id)).toEqual(['a', 'b'])
  })
  it('renders a steered message with the turn it joined', () => {
    expect(sessionRuns([run('a', '2026-10-09T01:00:00Z', { turnId: 't1' }),
      run('steer', '2026-10-09T01:01:00Z', { turnId: 't1', mergedIntoRunId: 'a' }),
      run('same-turn', '2026-10-09T01:02:00Z', { turnId: 't1' }),
      run('queued', '2026-10-09T01:03:00Z', { status: 'queued' })]).map((item) => item.id)).toEqual(['a', 'queued'])
  })
})
