import { describe, expect, it } from 'vitest'
import { makeHarness } from '../../tests/loop-test-harness.js'
import type { ModelClient } from '../ports/model-client.js'
import { ContextCompactor } from './context-compactor.js'
import { ContextWindowBudget } from './context-window-budget.js'
import { assumedWindowOutputBudget, sourceResultBudgetTokensFor } from './context-cap-guard.js'
import { modelCapabilitiesForModel, modelContextProfilesFromConfig } from './model-context-profile.js'
import { modelStepRequestBudget } from './model-step-request-budget.js'

const profiles = modelContextProfilesFromConfig({ models: { profiles: {
  limited: { contextWindowTokens: 128_000, maxInputTokens: 16_000, maxOutputTokens: 120_000 }
} } })
const capability = modelCapabilitiesForModel('limited', profiles)

describe('independent model input limits', () => {
  it('preserves maxInput in profiles and keeps the ordinary output reservation bounded', () => {
    expect(capability.maxInputTokens).toBe(16_000)
    const budget = modelStepRequestBudget(capability, 100_000)
    expect(budget.requestMaxInputTokens).toBe(16_000)
    expect(budget.outputReserveTokens).toBeLessThanOrEqual(32_768)
    expect(budget.effectiveBudget(15_000)).toBe(93_800)
  })
  it('compacts on input pressure even when input plus output fits total context', () => {
    const compactor = new ContextCompactor({ models: { profiles: { limited: { contextWindowTokens: 128_000, maxInputTokens: 16_000 } } } })
    expect(compactor.thresholds('limited')).toEqual({ softThreshold: 12_000, hardThreshold: 13_600 })
    expect(compactor.planCompaction([], { model: 'limited', requestInputTokens: 17_000,
      requestMaxInputTokens: 16_000, requestHardCapTokens: 108_800, outputBudgetTokens: 1024 })?.mode).toBe('force')
  })
  it('shows input allowance in window pressure without charging output against input allowance', () => {
    const budget = new ContextWindowBudget({ profiles })
    const state = budget.startWindow({ threadId: 't', windowId: 'w', windowSeq: 0, model: 'limited' })
    expect(budget.readUsage(state, { estimatedInputTokens: 12_000, outputReserveTokens: 8_000 }))
      .toMatchObject({ usageRatio: 0.75, remainingTokens: 4_000 })
  })
  it('never relaxes known input bounds or source-tool allowance with an assumed context', () => {
    const unknown = modelCapabilitiesForModel('unknown', [])
    const bounds = { inputTokens: 44_000, outputBudgetTokens: 1, outputReserveTokens: 6800,
      requestHardCapTokens: 27_200, requestMaxInputTokens: 16_000 }
    expect(assumedWindowOutputBudget(unknown, bounds)).toBeUndefined()
    expect(sourceResultBudgetTokensFor(unknown, bounds)).toBe(0)
    expect(sourceResultBudgetTokensFor(capability, { ...bounds, inputTokens: 15_000, requestHardCapTokens: 108_800 })).toBe(1000)
  })
  it('fails before dispatch when the final non-history input alone exceeds the model input cap', async () => {
    let sent = 0
    const model: ModelClient = { provider: 'fixture', model: 'tiny-input', async *stream() {
      sent++; yield { kind: 'completed', stopReason: 'stop' }
    } }
    const tinyProfiles = modelContextProfilesFromConfig({ models: { profiles: {
      'tiny-input': { contextWindowTokens: 128_000, maxInputTokens: 1, maxOutputTokens: 1024 }
    } } })
    const h = makeHarness(model, { tools: [], modelCapabilities: (id) => modelCapabilitiesForModel(id, tinyProfiles),
      contextCompaction: { summaryMode: 'heuristic' } })
    const thread = await h.threads.create({ model: model.model, mode: 'agent', workspace: '/tmp', title: 'Input limit' })
    const admitted = await h.turns.startTurn({ threadId: thread.id, request: { prompt: 'Keep this original message intact.' } })
    expect(await h.loop.runTurn(thread.id, admitted.turnId)).toBe('failed')
    expect(sent).toBe(0)
    const errors = h.bus.snapshotSince(thread.id, 0).filter((event) => event.kind === 'error')
    expect(errors).toContainEqual(expect.objectContaining({ code: 'context_window_exceeded', message: expect.stringContaining('maximum input') }))
  })
})
