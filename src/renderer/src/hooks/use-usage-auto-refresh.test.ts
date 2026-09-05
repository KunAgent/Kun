import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { USAGE_SUMMARY_FRESH_MS } from './usage-summary-cache'
import { useUsageAutoRefresh } from './use-usage-auto-refresh'

function Probe({ refreshedAt, refresh }: { refreshedAt?: string; refresh: () => void }): null {
  useUsageAutoRefresh(true, 0, 0, refreshedAt, refresh)
  return null
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
})

describe('useUsageAutoRefresh', () => {
  it('schedules from cached updatedAt and pauses while the document is hidden', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-31T00:29:00.000Z'))
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const documentTarget = new EventTarget() as EventTarget & { visibilityState: string }
    documentTarget.visibilityState = 'visible'
    vi.stubGlobal('document', documentTarget)
    const refresh = vi.fn()

    let renderer!: ReturnType<typeof create>
    await act(async () => {
      renderer = create(createElement(Probe, {
        refreshedAt: '2026-08-31T00:00:00.000Z',
        refresh
      }))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999)
    })
    expect(refresh).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(refresh).toHaveBeenCalledOnce()

    documentTarget.visibilityState = 'hidden'
    documentTarget.dispatchEvent(new Event('visibilitychange'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(USAGE_SUMMARY_FRESH_MS)
    })
    expect(refresh).toHaveBeenCalledOnce()
    await act(async () => renderer.unmount())
  })
})
