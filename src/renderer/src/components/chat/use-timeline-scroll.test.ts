import { describe, expect, it } from 'vitest'
import {
  deriveTimelineRenderedTurnCount,
  deriveTimelineVisibleTurnCount,
  isTimelineNearBottom,
  shouldCollapseTimelineHistory
} from './use-timeline-scroll'

describe('isTimelineNearBottom', () => {
  it('keeps automatic bottom following while the reader remains near the latest content', () => {
    expect(isTimelineNearBottom({
      scrollHeight: 2_000,
      scrollTop: 1_500,
      clientHeight: 500
    })).toBe(true)
    expect(isTimelineNearBottom({
      scrollHeight: 2_000,
      scrollTop: 1_405,
      clientHeight: 500
    })).toBe(true)
  })

  it('stops automatic bottom following after the reader scrolls up', () => {
    expect(isTimelineNearBottom({
      scrollHeight: 2_000,
      scrollTop: 1_404,
      clientHeight: 500
    })).toBe(false)
    expect(isTimelineNearBottom({
      scrollHeight: 2_000,
      scrollTop: 900,
      clientHeight: 500
    })).toBe(false)
  })
})

describe('deriveTimelineVisibleTurnCount', () => {
  it('keeps long conversations on the latest page instead of expanding all turns', () => {
    expect(
      deriveTimelineVisibleTurnCount({
        currentVisibleTurnCount: 18,
        totalTurns: 36,
        pageSize: 18,
        shouldCollapseHistory: true,
        historyExpansionRequested: false
      })
    ).toBe(18)
  })

  it('renders every turn for short conversations below the collapse threshold', () => {
    expect(
      deriveTimelineVisibleTurnCount({
        currentVisibleTurnCount: 5,
        totalTurns: 6,
        pageSize: 18,
        shouldCollapseHistory: false,
        historyExpansionRequested: false
      })
    ).toBe(6)
  })

  it('preserves a user-expanded history window while new turns arrive', () => {
    expect(
      deriveTimelineVisibleTurnCount({
        currentVisibleTurnCount: 36,
        totalTurns: 50,
        pageSize: 18,
        shouldCollapseHistory: true,
        historyExpansionRequested: true
      })
    ).toBe(36)
  })

  it('caps a user-expanded history window at the current turn count', () => {
    expect(
      deriveTimelineVisibleTurnCount({
        currentVisibleTurnCount: 36,
        totalTurns: 24,
        pageSize: 18,
        shouldCollapseHistory: true,
        historyExpansionRequested: true
      })
    ).toBe(24)
  })

  it('collapses issue 885-sized histories as soon as they exceed one page', () => {
    expect(shouldCollapseTimelineHistory(18, 18)).toBe(false)
    expect(shouldCollapseTimelineHistory(23, 18)).toBe(true)
    expect(
      deriveTimelineVisibleTurnCount({
        currentVisibleTurnCount: 0,
        totalTurns: 23,
        pageSize: 18,
        shouldCollapseHistory: true,
        historyExpansionRequested: false
      })
    ).toBe(18)
  })

  it('allows a user-expanded history window during a busy render', () => {
    expect(
      deriveTimelineRenderedTurnCount({
        visibleTurnCount: 23,
        totalTurns: 24,
        pageSize: 18,
        busy: true,
        historyExpansionRequested: true
      })
    ).toBe(23)
  })

  it('keeps an automatically growing busy history window collapsed', () => {
    expect(
      deriveTimelineRenderedTurnCount({
        visibleTurnCount: 23,
        totalTurns: 24,
        pageSize: 18,
        busy: true
      })
    ).toBe(18)
  })
})
