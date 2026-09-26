import { describe, expect, it } from 'vitest'
import { normalizeDragRect, PAPER_REGION_MAX_EDGE_PX } from './paper-visual-mark'

function expectRect(actual: ReturnType<typeof normalizeDragRect>, expected: number[]): void {
  expect(actual).not.toBeNull()
  expected.forEach((value, index) => {
    expect(actual?.[index]).toBeCloseTo(value, 6)
  })
}

describe('normalizeDragRect', () => {
  it('normalizes a left-to-right drag into [x, y, w, h]', () => {
    expectRect(normalizeDragRect(10, 20, 110, 60, 200, 100), [0.05, 0.2, 0.5, 0.4])
  })

  it('flips a backwards drag', () => {
    expectRect(normalizeDragRect(110, 60, 10, 20, 200, 100), [0.05, 0.2, 0.5, 0.4])
  })

  it('clamps to the page bounds', () => {
    expectRect(normalizeDragRect(-50, -10, 250, 120, 200, 100), [0, 0, 1, 1])
  })

  it('rejects zero-size and degenerate drags', () => {
    expect(normalizeDragRect(10, 10, 10, 10, 200, 100)).toBeNull()
    expect(normalizeDragRect(0, 0, 10, 10, 0, 100)).toBeNull()
  })
})

describe('constants', () => {
  it('caps captures well under the IPC byte limit', () => {
    expect(PAPER_REGION_MAX_EDGE_PX).toBeLessThanOrEqual(1600)
  })
})
