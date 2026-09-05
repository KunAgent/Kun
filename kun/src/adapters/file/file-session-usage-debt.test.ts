import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '../../contracts/events.js'
import { UsageCompactionDebtTracker } from './file-session-usage-debt.js'

type UsageEvent = Extract<RuntimeEvent, { kind: 'usage' }>

describe('UsageCompactionDebtTracker', () => {
  it('backs off inspections for a large mixed log with no known reclaimable usage', () => {
    const tracker = new UsageCompactionDebtTracker(1_000, 100)
    for (let index = 1; index < 32; index += 1) {
      expect(tracker.record('thread_mixed', usage(index), 50, 2_000)).toBe(false)
    }
    expect(tracker.record('thread_mixed', usage(32), 50, 2_000)).toBe(true)
    tracker.inspected('thread_mixed', false)
    for (let index = 33; index < 96; index += 1) {
      expect(tracker.record('thread_mixed', usage(index), 50, 2_000)).toBe(false)
    }
    expect(tracker.record('thread_mixed', usage(96), 50, 2_000)).toBe(true)
  })

  it('triggers from coalescible usage debt before the periodic inspection', () => {
    const tracker = new UsageCompactionDebtTracker(10_000, 100)
    expect(tracker.record('thread_debt', usage(1, '2026-08-30', 'same'), 60, 20_000)).toBe(false)
    expect(tracker.record('thread_debt', usage(2, '2026-08-30', 'same'), 60, 20_000)).toBe(false)
    expect(tracker.record('thread_debt', usage(3, '2026-08-30', 'same'), 60, 20_000)).toBe(true)
  })
})

function usage(seq: number, day = `2026-${String(Math.floor((seq - 1) / 28) + 1).padStart(2, '0')}-${String((seq - 1) % 28 + 1).padStart(2, '0')}`, model = `model-${seq}`): UsageEvent {
  return {
    kind: 'usage', seq, timestamp: `${day}T00:00:00.000Z`, threadId: 'thread_usage',
    model,
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, cacheHitRate: null, turns: 1 }
  }
}
