import { beforeEach, expect, it } from 'vitest'
import { resetSdkSessionCosts, sdkCostIncrement } from './sdk-session-cost.js'

beforeEach(() => resetSdkSessionCosts())

it('turns running session totals into per-result increments', () => {
  expect(sdkCostIncrement('s1', 0.4, false)).toBe(0.4)
  expect(sdkCostIncrement('s1', 0.65, true)).toBeCloseTo(0.25)
  expect(sdkCostIncrement('s1', 0.65, true)).toBe(0)
})

it('omits the restored spend of a resumed session it has not seen, and handles counter restarts', () => {
  expect(sdkCostIncrement('restored', 3.2, true)).toBeUndefined()
  expect(sdkCostIncrement('restored', 3.5, true)).toBeCloseTo(0.3)
  expect(sdkCostIncrement('restored', 0.1, true)).toBe(0.1)
  expect(sdkCostIncrement(undefined, 0.2, false)).toBe(0.2)
  expect(sdkCostIncrement('s2', Number.NaN, false)).toBeUndefined()
})
