import { describe, expect, it } from 'vitest'
import { SequencedRuntimeEventSchema } from './sse-sequence'

describe('SequencedRuntimeEventSchema', () => {
  it('accepts a stable stream sequence envelope', () => {
    const event = {
      streamId: 'stream_123',
      sequence: 42,
      eventId: 'evt_42',
      occurredAt: '2026-07-14T00:00:00.000Z'
    }

    expect(SequencedRuntimeEventSchema.parse(event)).toEqual(event)
  })

  it('accepts sequence zero for a newly-created stream', () => {
    expect(SequencedRuntimeEventSchema.parse({
      streamId: 'stream_123',
      sequence: 0,
      eventId: 'evt_0',
      occurredAt: '2026-07-14T00:00:00+00:00'
    }).sequence).toBe(0)
  })

  it('rejects unsafe sequences, invalid timestamps, and unknown fields', () => {
    expect(() => SequencedRuntimeEventSchema.parse({
      streamId: 'stream_123',
      sequence: Number.MAX_SAFE_INTEGER + 1,
      eventId: 'evt',
      occurredAt: '2026-07-14T00:00:00.000Z'
    })).toThrow()
    expect(() => SequencedRuntimeEventSchema.parse({
      streamId: 'stream_123',
      sequence: 1,
      eventId: 'evt',
      occurredAt: 'yesterday'
    })).toThrow()
    expect(() => SequencedRuntimeEventSchema.parse({
      streamId: 'stream_123',
      sequence: 1,
      eventId: 'evt',
      occurredAt: '2026-07-14T00:00:00.000Z',
      payload: {}
    })).toThrow()
  })
})
