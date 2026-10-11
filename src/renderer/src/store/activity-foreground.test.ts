import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ACTIVITY_FOREGROUND_REFRESH_MS,
  startActivityForegroundReporting,
  type ActivityForegroundDeps
} from './activity-foreground'

function harness(input: Partial<ActivityForegroundDeps> = {}) {
  const report = vi.fn(input.report ?? (() => Promise.resolve()))
  let active: string | null = 't1'
  let visible = true
  let listener: (() => void) | undefined
  const deps: ActivityForegroundDeps = {
    report,
    activeThreadId: () => active,
    subscribeActiveThread: (fn) => {
      listener = fn
      return () => {
        listener = undefined
      }
    },
    isVisible: () => visible,
    refreshMs: ACTIVITY_FOREGROUND_REFRESH_MS,
    ...input
  }
  return {
    deps,
    report,
    setActive: (id: string | null) => {
      active = id
      listener?.()
    },
    setVisible: (v: boolean) => {
      visible = v
    }
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('startActivityForegroundReporting', () => {
  it('reports the current thread immediately and on every change', async () => {
    const h = harness()
    const stop = startActivityForegroundReporting(h.deps)
    await Promise.resolve()
    expect(h.report).toHaveBeenCalledWith('t1')
    h.setActive('t2')
    await Promise.resolve()
    expect(h.report).toHaveBeenLastCalledWith('t2')
    stop()
  })

  it('refreshes on the interval under the 30s TTL', async () => {
    vi.useFakeTimers()
    const h = harness()
    const stop = startActivityForegroundReporting(h.deps)
    await vi.advanceTimersByTimeAsync(ACTIVITY_FOREGROUND_REFRESH_MS * 2 + 1)
    // initial + 2 interval ticks
    expect(h.report).toHaveBeenCalledTimes(3)
    stop()
  })

  it('skips reporting while hidden or with no active thread', async () => {
    const h = harness()
    const stop = startActivityForegroundReporting(h.deps)
    h.setVisible(false)
    h.setActive('t2')
    await Promise.resolve()
    expect(h.report).not.toHaveBeenCalledWith('t2')
    h.setVisible(true)
    h.setActive(null)
    await Promise.resolve()
    expect(h.report).toHaveBeenCalledTimes(1)
    stop()
  })

  it('swallows report failures and keeps reporting', async () => {
    vi.useFakeTimers()
    const h = harness({
      report: vi.fn(() => Promise.reject(new Error('offline')))
    })
    const stop = startActivityForegroundReporting(h.deps)
    await vi.advanceTimersByTimeAsync(ACTIVITY_FOREGROUND_REFRESH_MS + 1)
    expect(h.report).toHaveBeenCalledTimes(2)
    stop()
  })
})
