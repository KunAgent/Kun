import { describe, expect, it } from 'vitest'
import {
  MainWindowRendererRecoveryBudget,
  shouldRecoverMainFrameLoad,
  shouldRecoverRendererProcess
} from './main-window-renderer-recovery'

describe('main window renderer recovery', () => {
  it('ignores subframe failures and Chromium navigation cancellation', () => {
    expect(shouldRecoverMainFrameLoad(-105, false)).toBe(false)
    expect(shouldRecoverMainFrameLoad(-3, true)).toBe(false)
    expect(shouldRecoverMainFrameLoad(-105, true)).toBe(true)
  })

  it('recovers unexpected renderer exits but ignores a normal clean exit', () => {
    expect(shouldRecoverRendererProcess('clean-exit')).toBe(false)
    expect(shouldRecoverRendererProcess('crashed')).toBe(true)
    expect(shouldRecoverRendererProcess('oom')).toBe(true)
    expect(shouldRecoverRendererProcess('memory-eviction')).toBe(true)
  })

  it('bounds automatic reloads inside a sliding time window', () => {
    const budget = new MainWindowRendererRecoveryBudget(2, 60_000)

    expect(budget.reserve(1_000)).toBe(1)
    expect(budget.reserve(2_000)).toBe(2)
    expect(budget.reserve(3_000)).toBeNull()
    expect(budget.reserve(61_000)).toBe(2)
    expect(budget.reserve(62_000)).toBe(2)
    expect(budget.reserve(63_000)).toBeNull()
  })
})
