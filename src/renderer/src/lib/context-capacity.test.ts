import { describe, expect, it } from 'vitest'
import type { RequestContextSnapshot } from '../agent/types'
import { buildContextCapacity } from './context-capacity'

function snapshot(overrides: Partial<RequestContextSnapshot> = {}): RequestContextSnapshot {
  return {
    threadId: 'thr_context',
    turnId: 'turn_context',
    model: 'deepseek-v4-pro',
    providerId: 'deepseek',
    stepIndex: 0,
    contextWindowTokens: 200_000,
    softThresholdTokens: 150_000,
    hardThresholdTokens: 170_000,
    estimatedInputTokens: 60_000,
    breakdown: {
      tools: 10_000,
      system: 8_000,
      skills: 7_000,
      messages: 30_000,
      other: 5_000
    },
    toolCount: 21,
    activeSkillIds: ['skill-a'],
    ...overrides
  }
}

describe('buildContextCapacity', () => {
  it('renders the runtime categories directly and keeps them summing to used tokens', () => {
    const cap = buildContextCapacity(snapshot())

    expect(cap.categories.map((category) => [category.key, category.tokens])).toEqual([
      ['tools', 10_000],
      ['system', 8_000],
      ['skills', 7_000],
      ['messages', 30_000],
      ['other', 5_000]
    ])
    expect(cap.usedTokens).toBe(60_000)
    expect(cap.freeTokens).toBe(140_000)
    expect(cap.categories.reduce((sum, category) => sum + category.tokens, 0))
      .toBe(cap.usedTokens)
    expect(cap.usedRatio).toBe(0.3)
  })

  it('uses the runtime model window and compaction thresholds', () => {
    const cap = buildContextCapacity(snapshot({
      contextWindowTokens: 256_000,
      softThresholdTokens: 192_000,
      hardThresholdTokens: 217_600
    }))

    expect(cap.windowTokens).toBe(256_000)
    expect(cap.softThresholdRatio).toBe(0.75)
    expect(cap.hardThresholdRatio).toBe(0.85)
  })

  it('uses a smaller input limit for occupancy while retaining the total window', () => {
    const cap = buildContextCapacity(snapshot({ maxInputTokens: 100_000 }))
    expect(cap.totalWindowTokens).toBe(200_000)
    expect(cap.windowTokens).toBe(100_000)
    expect(cap.usedRatio).toBe(0.6)
    expect(cap.freeTokens).toBe(40_000)
  })

  it('does not scale category values to an unexplained total', () => {
    const cap = buildContextCapacity(snapshot({
      estimatedInputTokens: 322_900,
      breakdown: {
        tools: 3_000,
        system: 2_000,
        skills: 1_000,
        messages: 5_000,
        other: 1_000
      }
    }))

    expect(cap.usedTokens).toBe(12_000)
    expect(cap.categories.find((category) => category.key === 'tools')?.tokens).toBe(3_000)
  })

  it('clamps rendering ratios while retaining request-derived token values', () => {
    const cap = buildContextCapacity(snapshot({
      contextWindowTokens: 1_000,
      softThresholdTokens: 1_500,
      hardThresholdTokens: 2_000,
      breakdown: {
        tools: 800,
        system: 800,
        skills: 0,
        messages: 0,
        other: 0
      }
    }))

    expect(cap.usedTokens).toBe(1_600)
    expect(cap.usedRatio).toBe(1)
    expect(cap.freeTokens).toBe(0)
    expect(cap.softThresholdRatio).toBe(1)
    expect(cap.hardThresholdRatio).toBe(1)
  })

  it('marks SDK-managed native history as unknown instead of zero', () => {
    const cap = buildContextCapacity(snapshot({
      contextManagement: 'sdk-managed',
      nativeHistory: 'unknown'
    }))
    expect(cap.nativeHistoryUnknown).toBe(true)
    expect(cap.usedTokens).toBe(60_000)
  })
})
