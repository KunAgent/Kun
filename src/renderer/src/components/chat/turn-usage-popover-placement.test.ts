import { describe, expect, it } from 'vitest'
import { calculateTurnUsagePopoverPlacement } from './turn-usage-popover-placement'

describe('calculateTurnUsagePopoverPlacement', () => {
  it('opens above and clamps horizontally in a normal viewport', () => {
    const placement = calculateTurnUsagePopoverPlacement({
      anchorRect: { left: 900, right: 1000, top: 700, bottom: 720 },
      contentHeight: 400,
      viewportWidth: 1024,
      viewportHeight: 768
    })

    expect(placement.left).toBe(660)
    expect(placement.top).toBe(292)
    expect(placement.width).toBe(352)
  })

  it('fits a narrow scaled viewport and opens below when it has more room', () => {
    const placement = calculateTurnUsagePopoverPlacement({
      anchorRect: { left: 16, right: 160, top: 40, bottom: 60 },
      contentHeight: 800,
      viewportWidth: 300,
      viewportHeight: 600,
      coordinateScale: 0.75
    })

    expect(placement.width).toBe(352)
    expect(placement.left).toBe(21.333333333333332)
    expect(placement.top).toBeGreaterThan(60 / 0.75)
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(600 / 0.75 - 12)
  })
})
