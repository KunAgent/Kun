import { describe, expect, it } from 'vitest'
import { inspectSseSequence } from './sse-gap'
import { planSseRecovery } from './sse-recovery'

const event = (sequence: number, streamId = 'stream_1') => ({
  streamId,
  sequence,
  eventId: `event_${sequence}`,
  occurredAt: '2026-07-14T00:00:00.000Z'
})

describe('planSseRecovery', () => {
  it('does nothing for accepted, duplicate, and out-of-order events', () => {
    const accepted = inspectSseSequence({ streamId: 'stream_1', lastSequence: 0 }, event(1))
    const duplicate = inspectSseSequence({ streamId: 'stream_1', lastSequence: 1 }, event(1))
    const stale = inspectSseSequence({ streamId: 'stream_1', lastSequence: 2 }, event(0))
    expect(planSseRecovery(accepted).action).toBe('none')
    expect(planSseRecovery(duplicate).action).toBe('none')
    expect(planSseRecovery(stale).action).toBe('none')
  })

  it('plans a bounded replay for a small gap', () => {
    const inspection = inspectSseSequence({ streamId: 'stream_1', lastSequence: 2 }, event(5))
    expect(planSseRecovery(inspection, { maxReplayEvents: 8 })).toEqual({
      action: 'replay',
      streamId: 'stream_1',
      fromSequence: 3,
      toSequence: 4,
      maxEvents: 8
    })
  })

  it('reloads when a gap exceeds the replay budget or replay failed', () => {
    const inspection = inspectSseSequence({ streamId: 'stream_1', lastSequence: 2 }, event(10))
    expect(planSseRecovery(inspection, { maxReplayEvents: 3 })).toMatchObject({
      action: 'reload',
      reason: 'gap-too-large'
    })
    expect(planSseRecovery(inspection, { replayFailed: true })).toMatchObject({
      action: 'reload',
      reason: 'replay-failed'
    })
  })

  it('reloads for an old stream and caps unsafe replay budgets', () => {
    const oldStream = inspectSseSequence({ streamId: 'stream_2', lastSequence: 2 }, event(3, 'stream_1'))
    expect(planSseRecovery(oldStream)).toEqual({
      action: 'reload',
      streamId: 'stream_1',
      reason: 'old-stream'
    })
    const gap = inspectSseSequence({ streamId: 'stream_1', lastSequence: 0 }, event(2))
    expect(planSseRecovery(gap, { maxReplayEvents: 99999 })).toMatchObject({ maxEvents: 1000 })
  })
})
