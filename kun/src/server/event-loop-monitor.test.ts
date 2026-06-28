import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveEventLoopStallThresholdMs, startEventLoopMonitor } from './event-loop-monitor.js'

describe('startEventLoopMonitor', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('logs a stall when a heartbeat is serviced far later than scheduled', () => {
    vi.useFakeTimers()
    let clock = 0
    const logs: string[] = []
    const handle = startEventLoopMonitor({
      intervalMs: 1_000,
      stallThresholdMs: 2_000,
      now: () => clock,
      log: (line) => logs.push(line)
    })

    // Healthy tick: the wall clock advanced exactly one interval → no stall.
    clock = 1_000
    vi.advanceTimersByTime(1_000)
    expect(logs).toHaveLength(0)

    // The loop was blocked: the heartbeat is serviced 6s after the previous one,
    // i.e. ~5s later than its 1s schedule.
    clock = 7_000
    vi.advanceTimersByTime(1_000)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatch(/event loop stalled for ~5000ms/)

    handle.stop()
  })

  it('does not log sub-threshold jitter', () => {
    vi.useFakeTimers()
    let clock = 0
    const logs: string[] = []
    const handle = startEventLoopMonitor({
      intervalMs: 1_000,
      stallThresholdMs: 2_000,
      now: () => clock,
      log: (line) => logs.push(line)
    })

    // 1.5s gap → 500ms drift, below the 2s threshold.
    clock = 1_500
    vi.advanceTimersByTime(1_000)
    expect(logs).toHaveLength(0)

    handle.stop()
  })

  it('stops emitting after stop()', () => {
    vi.useFakeTimers()
    let clock = 0
    const logs: string[] = []
    const handle = startEventLoopMonitor({
      intervalMs: 1_000,
      stallThresholdMs: 2_000,
      now: () => clock,
      log: (line) => logs.push(line)
    })
    handle.stop()

    clock = 10_000
    vi.advanceTimersByTime(2_000)
    expect(logs).toHaveLength(0)
  })
})

describe('resolveEventLoopStallThresholdMs', () => {
  it('defaults to 2000ms', () => {
    expect(resolveEventLoopStallThresholdMs({})).toBe(2_000)
  })

  it('honors a positive override', () => {
    expect(resolveEventLoopStallThresholdMs({ KUN_EVENT_LOOP_STALL_LOG_MS: '5000' })).toBe(5_000)
  })

  it('ignores garbage and non-positive overrides', () => {
    expect(resolveEventLoopStallThresholdMs({ KUN_EVENT_LOOP_STALL_LOG_MS: 'abc' })).toBe(2_000)
    expect(resolveEventLoopStallThresholdMs({ KUN_EVENT_LOOP_STALL_LOG_MS: '0' })).toBe(2_000)
    expect(resolveEventLoopStallThresholdMs({ KUN_EVENT_LOOP_STALL_LOG_MS: '-5' })).toBe(2_000)
  })
})
