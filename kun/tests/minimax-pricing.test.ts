import { describe, expect, it } from 'vitest'
import { estimateMiniMaxCost } from '../src/adapters/model/minimax-pricing.js'

describe('MiniMax pricing', () => {
  it('estimates MiniMax M2.7 highspeed Token Plan equivalent CNY cost', () => {
    const cost = estimateMiniMaxCost({
      model: 'MiniMax-M2.7-highspeed',
      providerHost: 'https://api.minimaxi.com/anthropic',
      inputTokens: 10_000,
      cacheReadTokens: 12_000,
      cacheWriteTokens: 2_000,
      outputTokens: 1_000
    })

    expect(cost).not.toBeNull()
    expect(cost!.costCny).toBeCloseTo(0.06909)
    expect(cost!.costUsd).toBeUndefined()
  })

  it('uses the higher MiniMax M3 tier above the 512k input threshold', () => {
    const shortContext = estimateMiniMaxCost({
      model: 'MiniMax-M3',
      providerHost: 'https://api.minimaxi.com/anthropic',
      inputTokens: 512_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000
    })
    const longContext = estimateMiniMaxCost({
      model: 'MiniMax-M3',
      providerHost: 'https://api.minimaxi.com/anthropic',
      inputTokens: 512_001,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000
    })

    expect(shortContext?.costCny).toBeCloseTo(1.0836)
    expect(longContext?.costCny).toBeCloseTo(2.1672042)
  })

  it('returns null for non-MiniMax hosts when providerHost is provided', () => {
    expect(estimateMiniMaxCost({
      model: 'MiniMax-M2.7',
      providerHost: 'https://example.com/anthropic',
      inputTokens: 10_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000
    })).toBeNull()
  })

  it('prices MiniMax-M3.1-Flash with the China platform CNY rates', () => {
    const cost = estimateMiniMaxCost({
      model: 'MiniMax-M3.1-Flash',
      providerHost: 'https://api.minimaxi.com/anthropic',
      inputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000
    })

    expect(cost).not.toBeNull()
    expect(cost!.costCny).toBeCloseTo(5.1)
    expect(cost!.costUsd).toBeUndefined()
  })

  it('prices MiniMax-M3.1-Flash with the international platform USD rates', () => {
    const cost = estimateMiniMaxCost({
      model: 'minimax-m3.1-flash',
      providerHost: 'https://api.minimax.io/anthropic',
      inputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000
    })

    expect(cost).not.toBeNull()
    expect(cost!.costUsd).toBeCloseTo(0.765)
    expect(cost!.costCny).toBeUndefined()
  })

  it('does not reuse M3 prices for unknown MiniMax models', () => {
    expect(estimateMiniMaxCost({
      model: 'MiniMax-M9',
      providerHost: 'https://api.minimaxi.com/anthropic',
      inputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000
    })).toBeNull()
  })
})
