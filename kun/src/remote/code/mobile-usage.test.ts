import { describe, expect, it } from 'vitest'
import { mobileUsage } from './mobile-usage.js'
import type { UsageSnapshot } from '../../contracts/usage.js'
describe('mobile usage projection', () => {
  it('does not invent known usage or model capacity and strips sensitive context', () => {
    expect(mobileUsage(undefined, undefined)).toBeUndefined()
    const projected = mobileUsage(undefined, { estimatedInputTokens: 123, contextWindowTokens: 200000,
      contextWindowKnown: false, model: 'private-model', activeSkillIds: ['secret'], breakdown: { system: 'secret' } })
    expect(projected).toEqual({ context: { usedTokens: 123, source: 'estimate' } })
  })
  it('carries recorded counters and an explicitly known context window', () => {
    expect(mobileUsage({ turns: 2, promptTokens: 100, completionTokens: 20, totalTokens: 120 } as UsageSnapshot,
      { estimatedInputTokens: 50, contextWindowTokens: 100, contextWindowKnown: true, occupancySource: 'agent' }))
      .toEqual({ inputTokens: 100, outputTokens: 20, totalTokens: 120, context: { usedTokens: 50, windowTokens: 100, source: 'agent' } })
    expect(mobileUsage(undefined, { estimatedInputTokens: NaN })).toBeUndefined()
  })
})
