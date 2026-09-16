import { describe, expect, it } from 'vitest'
import type { ModelContextProfile } from './model-context-profile.js'
import { ContextWindowBudget, CONTEXT_WINDOW_USAGE_THRESHOLDS } from './context-window-budget.js'

function profile(canonicalModel: string, contextWindowTokens: number, maxOutputTokens?: number): ModelContextProfile {
  return {
    canonicalModel,
    modelIds: [canonicalModel],
    contextWindowTokens,
    softThreshold: Math.floor(contextWindowTokens * 0.75),
    hardThreshold: Math.floor(contextWindowTokens * 0.85),
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsToolCalling: true,
    messageParts: ['text'],
    ...(maxOutputTokens ? { maxOutputTokens } : {})
  }
}

function makeBudget() {
  return new ContextWindowBudget({
    profiles: [profile('big-model', 100_000, 8_192), profile('small-model', 1_000, 100)],
    nowIso: () => '2026-09-14T00:00:00.000Z'
  })
}

describe('ContextWindowBudget', () => {
  it('resolves effective capacity and bounded output reserve from the model profile', () => {
    const budget = makeBudget()
    expect(budget.capacityFor('big-model')).toBe(100_000)
    expect(budget.capacityFor('small-model')).toBe(1_000)
    expect(budget.capacityFor('unknown-model')).toBe(256_000)
    // The ordinary reserve is bounded by the runtime default even when the
    // provider advertises a huge max output.
    expect(budget.outputReserveFor('big-model', 0)).toBeLessThanOrEqual(8_192)
    expect(budget.outputReserveFor('small-model', 0)).toBeLessThanOrEqual(100)
  })

  it('starts a window with zero notices and full remaining capacity', () => {
    const budget = makeBudget()
    const state = budget.startWindow({
      threadId: 't1', windowId: 'win-1', windowSeq: 1, model: 'small-model'
    })
    expect(state).toMatchObject({
      capacityTokens: 1_000,
      noticeTokens: 0,
      coveredThresholds: [],
      lastActualInputTokens: null
    })
    const reading = budget.readUsage(state, { estimatedInputTokens: 100, outputReserveTokens: 100 })
    expect(reading.remainingTokens).toBe(800)
    expect(reading.usageRatio).toBeCloseTo(0.2)
  })

  it('floors remaining capacity at zero for oversized input plus output reservation', () => {
    const budget = makeBudget()
    const state = budget.startWindow({
      threadId: 't1', windowId: 'win-1', windowSeq: 1, model: 'small-model'
    })
    const reading = budget.readUsage(state, { estimatedInputTokens: 950, outputReserveTokens: 200 })
    expect(reading.remainingTokens).toBe(0)
    expect(reading.usageRatio).toBe(1)
  })

  it('fires each threshold at most once per window and dedupes repeats', () => {
    const budget = makeBudget()
    const state = budget.startWindow({
      threadId: 't1', windowId: 'win-1', windowSeq: 2, model: 'small-model'
    })
    const first = budget.thresholdNotice(state, { estimatedInputTokens: 260, outputReserveTokens: 100 })
    expect(first.threshold).toBe(0.25)
    expect(first.notice).toContain('context window 2')
    expect(first.notice).toContain('36%')

    const second = budget.thresholdNotice(state, { estimatedInputTokens: 560, outputReserveTokens: 100 })
    expect(second.threshold).toBe(0.5)
    const repeat = budget.thresholdNotice(state, { estimatedInputTokens: 560, outputReserveTokens: 100 })
    expect(repeat.notice).toBeNull()
    expect(repeat.threshold).toBeNull()
    expect(state.coveredThresholds).toEqual([0.25, 0.5])
  })

  it('announces only the highest threshold when one request crosses several', () => {
    const budget = makeBudget()
    const state = budget.startWindow({
      threadId: 't1', windowId: 'win-1', windowSeq: 0, model: 'small-model'
    })
    const notice = budget.thresholdNotice(state, { estimatedInputTokens: 800, outputReserveTokens: 100 })
    expect(notice.threshold).toBe(0.75)
    expect(notice.notice).toContain('90%')
    // Lower thresholds are marked covered without individual notices.
    expect(state.coveredThresholds).toEqual([...CONTEXT_WINDOW_USAGE_THRESHOLDS])
    const later = budget.thresholdNotice(state, { estimatedInputTokens: 950, outputReserveTokens: 100 })
    expect(later.notice).toBeNull()
  })

  it('counts emitted notices into the budget', () => {
    const budget = makeBudget()
    const state = budget.startWindow({
      threadId: 't1', windowId: 'win-1', windowSeq: 1, model: 'small-model'
    })
    const before = budget.readUsage(state, { estimatedInputTokens: 260, outputReserveTokens: 100 })
    budget.thresholdNotice(state, { estimatedInputTokens: 260, outputReserveTokens: 100 })
    expect(state.noticeTokens).toBeGreaterThan(0)
    const after = budget.readUsage(state, { estimatedInputTokens: 260, outputReserveTokens: 100 })
    expect(after.remainingTokens).toBe(before.remainingTokens - state.noticeTokens)
  })

  it('calibrates from same-window provider actuals without cross-window leakage', () => {
    const budget = makeBudget()
    const state = budget.startWindow({
      threadId: 't1', windowId: 'win-1', windowSeq: 1, model: 'small-model'
    })
    const reading = budget.thresholdNotice(state, {
      estimatedInputTokens: 100,
      outputReserveTokens: 100,
      actualInputTokens: 400
    })
    // Usage follows the provider actual (400 + 100 = 50%), not the estimate.
    expect(reading.usageRatio).toBeCloseTo(0.5)
    expect(state.lastActualInputTokens).toBe(400)

    const nextWindow = budget.startWindow({
      threadId: 't1', windowId: 'win-2', windowSeq: 2, model: 'small-model'
    })
    expect(nextWindow.lastActualInputTokens).toBeNull()
  })

  it('recomputes capacity on model switch while keeping threshold marks', () => {
    const budget = makeBudget()
    const state = budget.startWindow({
      threadId: 't1', windowId: 'win-1', windowSeq: 1, model: 'small-model'
    })
    budget.thresholdNotice(state, { estimatedInputTokens: 260, outputReserveTokens: 100 })
    const switched = budget.switchModel('t1', 'win-1', 'big-model')!
    expect(switched.capacityTokens).toBe(100_000)
    expect(switched.coveredThresholds).toEqual([0.25])
    const reading = budget.readUsage(switched, { estimatedInputTokens: 30_000, outputReserveTokens: 8_192 })
    expect(reading.usageRatio).toBeCloseTo((30_000 + 8_192) / 100_000)
  })

  it('restores threshold marks through snapshot/restore', () => {
    const budget = makeBudget()
    const state = budget.startWindow({
      threadId: 't1', windowId: 'win-1', windowSeq: 1, model: 'small-model'
    })
    budget.thresholdNotice(state, { estimatedInputTokens: 560, outputReserveTokens: 100 })

    const restarted = makeBudget()
    restarted.restore(budget.snapshot())
    const restored = restarted.stateFor('t1', 'win-1')!
    expect(restored.coveredThresholds).toEqual([0.25, 0.5])
    expect(restored.windowSeq).toBe(1)
    const again = restarted.thresholdNotice(restored, {
      estimatedInputTokens: 560, outputReserveTokens: 100
    })
    expect(again.notice).toBeNull()
  })
})
