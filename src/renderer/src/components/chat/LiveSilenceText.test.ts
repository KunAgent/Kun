// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import { noteThreadLiveActivity, resetThreadLiveActivityForTests } from '../../store/thread-live-activity'
import { LIVE_SILENCE_NOTICE_MS, LiveSilenceText, liveSilenceMinutes } from './LiveElapsedText'

describe('live turn silence', () => {
  it('counts from the later of turn start and the last event, after two minutes', () => {
    expect(liveSilenceMinutes(LIVE_SILENCE_NOTICE_MS - 1, 0, undefined)).toBeNull()
    expect(liveSilenceMinutes(LIVE_SILENCE_NOTICE_MS, 0, undefined)).toBe(2)
    expect(liveSilenceMinutes(10 * 60_000, 0, 9 * 60_000)).toBeNull()
    expect(liveSilenceMinutes(10 * 60_000, 0, 5 * 60_000)).toBe(5)
    expect(liveSilenceMinutes(10 * 60_000, 6 * 60_000, 1_000)).toBe(4)
  })

  describe('LiveSilenceText', () => {
    let container: HTMLDivElement
    let root: Root

    beforeEach(() => {
      ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
      vi.useFakeTimers()
      vi.setSystemTime(0)
      resetThreadLiveActivityForTests()
      container = document.createElement('div')
      root = createRoot(container)
    })

    afterEach(async () => {
      await act(async () => root.unmount())
      vi.useRealTimers()
      ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
    })

    it('appears after two quiet minutes and clears when an event arrives', async () => {
      await act(async () => root.render(createElement(LiveSilenceText, { threadId: 't1', sinceMs: 0 })))
      const label = () => container.querySelector('[data-live-silence]')?.textContent
      expect(label()).toBe('')
      await act(async () => { vi.advanceTimersByTime(LIVE_SILENCE_NOTICE_MS) })
      expect(label()).toMatch(/2/)
      noteThreadLiveActivity('t1', Date.now())
      await act(async () => { vi.advanceTimersByTime(1000) })
      expect(label()).toBe('')
      noteThreadLiveActivity('other-thread', Date.now() + 10 * 60_000)
      await act(async () => { vi.advanceTimersByTime(3 * 60_000) })
      expect(label()).toMatch(/3/)
    })
  })
})
