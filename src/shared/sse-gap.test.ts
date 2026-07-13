import { describe, expect, it } from 'vitest'
import { inspectSseSequence, SseSequenceDecision, type SseSequenceCursor } from './sse-gap'

const event = (sequence: number, streamId = 'stream_1') => ({
  streamId,
  sequence,
  eventId: `event_${sequence}`,
  occurredAt: '2026-07-14T00:00:00.000Z'
})

describe('inspectSseSequence', () => {
  it('accepts the first event and creates a cursor', () => {
    const result = inspectSseSequence(null, event(0))
    expect(result.decision).toBe(SseSequenceDecision.Accepted)
    expect(result.nextCursor).toEqual({ streamId: 'stream_1', lastSequence: 0 })
  })

  it('accepts the next contiguous event and advances only the returned cursor', () => {
    const cursor: SseSequenceCursor = { streamId: 'stream_1', lastSequence: 0 }
    const result = inspectSseSequence(cursor, event(1))
    expect(result.decision).toBe(SseSequenceDecision.Accepted)
    expect(result.nextCursor?.lastSequence).toBe(1)
    expect(cursor.lastSequence).toBe(0)
  })

  it('classifies duplicate and out-of-order events without moving the cursor', () => {
    const cursor = { streamId: 'stream_1', lastSequence: 4 }
    expect(inspectSseSequence(cursor, event(4)).decision).toBe(SseSequenceDecision.Duplicate)
    expect(inspectSseSequence(cursor, event(2)).decision).toBe(SseSequenceDecision.OutOfOrder)
    expect(inspectSseSequence(cursor, event(4)).nextCursor).toEqual(cursor)
  })

  it('reports a gap and leaves projection at the last confirmed sequence', () => {
    const cursor = { streamId: 'stream_1', lastSequence: 4 }
    const result = inspectSseSequence(cursor, event(7))
    expect(result.decision).toBe(SseSequenceDecision.Gap)
    expect(result.expectedSequence).toBe(5)
    expect(result.nextCursor).toEqual(cursor)
  })

  it('rejects events from an old or replaced stream', () => {
    const cursor = { streamId: 'stream_2', lastSequence: 4 }
    const result = inspectSseSequence(cursor, event(5, 'stream_1'))
    expect(result.decision).toBe(SseSequenceDecision.OldStream)
    expect(result.nextCursor).toEqual(cursor)
  })

  it('validates event metadata before making a projection decision', () => {
    expect(() => inspectSseSequence(null, { ...event(0), eventId: '' })).toThrow()
  })
})
