import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../agent/types'
import {
  buildContextCapacity,
  estimateBlockTokens,
  estimateTokensFromText
} from './context-capacity'

describe('estimateTokensFromText', () => {
  it('returns 0 for empty input', () => {
    expect(estimateTokensFromText('')).toBe(0)
  })

  it('treats latin text as roughly 4 chars per token', () => {
    expect(estimateTokensFromText('a'.repeat(40))).toBe(10)
  })

  it('treats CJK characters as roughly one token each', () => {
    expect(estimateTokensFromText('上下文容量')).toBe(5)
  })

  it('counts astral-plane characters once, not twice', () => {
    // An emoji is a single surrogate pair; latin heuristic -> ceil(1/4) = 1.
    expect(estimateTokensFromText('😀')).toBe(1)
  })
})

describe('buildContextCapacity', () => {
  it('uses the measured total and keeps categories + free summing to the window', () => {
    const cap = buildContextCapacity({
      windowTokens: 200_000,
      lastTurnInputTokens: 138_389,
      messageTokens: 90_000,
      toolCount: 40,
      skillCount: 12
    })
    expect(cap.hasMeasuredTotal).toBe(true)
    expect(cap.usedTokens).toBe(138_389)
    expect(cap.freeTokens).toBe(200_000 - 138_389)
    const sum = cap.categories.reduce((acc, c) => acc + c.tokens, 0) + cap.freeTokens
    // Allow ±1 token of rounding drift across the five categories.
    expect(Math.abs(sum - cap.windowTokens)).toBeLessThanOrEqual(2)
    expect(cap.usedRatio).toBeCloseTo(138_389 / 200_000, 5)
  })

  it('clamps a measured total that exceeds the window', () => {
    const cap = buildContextCapacity({
      windowTokens: 100_000,
      lastTurnInputTokens: 150_000,
      messageTokens: 0,
      toolCount: 10,
      skillCount: 0
    })
    expect(cap.usedTokens).toBe(100_000)
    expect(cap.freeTokens).toBe(0)
    expect(cap.usedRatio).toBe(1)
  })

  it('falls back to a pure estimate when there is no measured turn', () => {
    const cap = buildContextCapacity({
      windowTokens: 200_000,
      lastTurnInputTokens: null,
      messageTokens: 2,
      toolCount: 20,
      skillCount: 5
    })
    expect(cap.hasMeasuredTotal).toBe(false)
    const prefix = cap.categories
      .filter((c) => c.key !== 'messages')
      .reduce((acc, c) => acc + c.tokens, 0)
    expect(prefix).toBeGreaterThan(0)
    expect(cap.usedTokens).toBeGreaterThan(0)
    expect(cap.usedTokens).toBeLessThan(cap.windowTokens)
  })

  it('scales a pure estimate down so it never overflows the window', () => {
    const cap = buildContextCapacity({
      windowTokens: 1000,
      lastTurnInputTokens: null,
      messageTokens: 25_000,
      toolCount: 100,
      skillCount: 50
    })
    expect(cap.usedTokens).toBeLessThanOrEqual(cap.windowTokens)
    expect(cap.freeTokens).toBeGreaterThanOrEqual(0)
  })
})

describe('estimateBlockTokens', () => {
  it('estimates model-visible text per block kind', () => {
    expect(estimateBlockTokens({ kind: 'user', id: 'u1', text: 'hello world!' } as ChatBlock)).toBe(3)
    expect(
      estimateBlockTokens({
        kind: 'tool',
        id: 't1',
        name: 'read',
        status: 'done',
        detail: 'file contents here'
      } as unknown as ChatBlock)
    ).toBeGreaterThan(0)
  })

  it('returns 0 for blocks with no model-visible text', () => {
    expect(
      estimateBlockTokens({
        kind: 'approval',
        id: 'p1',
        requestId: 'req',
        toolName: 'bash',
        createdAt: ''
      } as unknown as ChatBlock)
    ).toBe(0)
  })
})
