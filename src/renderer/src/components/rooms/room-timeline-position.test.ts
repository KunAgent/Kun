import { describe, expect, it } from 'vitest'
import { captureTimelinePosition, restoreTimelinePosition } from './room-timeline-position'

describe('message-based timeline anchors', () => {
  it('captures an exact message and relative offset instead of relying on global sequence gaps', () => {
    const rows = [{ dataset: { timelineId: 'before' }, getBoundingClientRect: () => ({ top: -200, bottom: 50 }) },
      { dataset: { timelineId: 'reading' }, getBoundingClientRect: () => ({ top: 80, bottom: 250 }) }]
    const scroller = { scrollTop: 900, getBoundingClientRect: () => ({ top: 100 }), querySelectorAll: () => rows } as unknown as HTMLElement
    expect(captureTimelinePosition(scroller, false)).toEqual({ messageId: 'reading', offset: -20, top: 900, atBottom: false })
    rows[1].getBoundingClientRect = () => ({ top: 280, bottom: 450 })
    expect(restoreTimelinePosition(scroller, { messageId: 'reading', offset: -20, top: 900, atBottom: false })).toBe(true)
    expect(scroller.scrollTop).toBe(1100)
  })
  it('requests missing-message recovery and treats explicit latest position separately', () => {
    const scroller = { scrollTop: 10, scrollHeight: 1000, querySelectorAll: () => [] } as unknown as HTMLElement
    expect(restoreTimelinePosition(scroller, { messageId: 'missing', top: 500, offset: 20, atBottom: false })).toBe(false)
    expect(scroller.scrollTop).toBe(500)
    expect(restoreTimelinePosition(scroller, { top: 10, offset: 0, atBottom: true })).toBe(true)
    expect(scroller.scrollTop).toBe(1000)
  })
})
