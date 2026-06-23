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

  it('lets live message estimates raise a stale measured total while streaming', () => {
    const cap = buildContextCapacity({
      windowTokens: 200_000,
      lastTurnInputTokens: 20_000,
      messageTokens: 40_000,
      toolCount: 20,
      skillCount: 4
    })
    expect(cap.hasMeasuredTotal).toBe(true)
    expect(cap.usedTokens).toBeGreaterThan(20_000)
    expect(cap.usedTokens).toBeGreaterThan(cap.categories.find((c) => c.key === 'messages')?.tokens ?? 0)
  })

  it('clamps a measured total that exceeds the window', () => {
    const cap = buildContextCapacity({
      windowTokens: 100_000,
      // A conversation that genuinely fills the window; the measured total is a
      // little over it (overhead/formatting) and must clamp. messageTokens keeps
      // the measured total within the trust factor so it is not mistaken for
      // provider inflation.
      lastTurnInputTokens: 150_000,
      messageTokens: 90_000,
      toolCount: 10,
      skillCount: 0
    })
    expect(cap.hasMeasuredTotal).toBe(true)
    expect(cap.usedTokens).toBe(100_000)
    expect(cap.freeTokens).toBe(0)
    expect(cap.usedRatio).toBe(1)
  })

  it('rejects a measured total that dwarfs the local estimate (provider inflation)', () => {
    // Regression: MiniMax-M3 reported ~1.2M prompt tokens for a thread whose real
    // content was ~33k, pinning the gauge at 100%. The measured total must be
    // ignored in favour of the estimate so the gauge shows the true ~3%.
    const cap = buildContextCapacity({
      windowTokens: 1_000_000,
      lastTurnInputTokens: 1_246_505,
      messageTokens: 33_000,
      toolCount: 20,
      skillCount: 2
    })
    expect(cap.hasMeasuredTotal).toBe(false)
    // Falls back to the estimate (conversation + prefix), nowhere near 100%.
    expect(cap.usedTokens).toBeLessThan(120_000)
    expect(cap.usedRatio).toBeLessThan(0.15)
    // A plausible measured total (within the trust factor) is still honoured.
    const trusted = buildContextCapacity({
      windowTokens: 1_000_000,
      lastTurnInputTokens: 120_000,
      messageTokens: 33_000,
      toolCount: 20,
      skillCount: 2
    })
    expect(trusted.hasMeasuredTotal).toBe(true)
    expect(trusted.usedTokens).toBe(120_000)
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

  it('counts the compaction summary (re-sent to the model), not just the pinned constraints', () => {
    // Regression: a compaction block's `detail` is only the short
    // pinned-constraints line (~a handful of tokens), but the runtime re-sends
    // the much larger `summary` as a system message. The gauge must count the
    // summary, else "消息" collapses to ~7 after compaction.
    const summary = 'Conversation and work summary:\n' + 'point. '.repeat(400)
    const tokens = estimateBlockTokens({
      kind: 'compaction',
      id: 'c1',
      status: 'success',
      summary,
      detail: 'user: preserve recent turns'
    } as unknown as ChatBlock)
    expect(tokens).toBeGreaterThan(300)
  })

  it('discounts base64 screenshot payloads instead of counting them as text', () => {
    // A computer_use screenshot tool result: detail is JSON.stringify(output)
    // carrying a huge base64 image. Counting it as text would read as ~100k+
    // tokens (the bug that pegged the gauge at 100% after one turn).
    const base64 = 'A'.repeat(800_000)
    const detail = JSON.stringify({ type: 'computer_screenshot', data_base64: base64 })
    const tokens = estimateBlockTokens({
      kind: 'tool',
      id: 't-shot',
      name: 'computer_use',
      status: 'done',
      detail
    } as unknown as ChatBlock)
    // Raw text would be ~200k tokens; the flat per-image cost keeps it bounded.
    expect(tokens).toBeLessThan(2_000)
    expect(estimateTokensFromText(detail)).toBeGreaterThan(150_000)
  })

  it('leaves ordinary (non-base64) tool detail unchanged', () => {
    const detail = 'ls -la\ntotal 42\ndrwxr-xr-x  5 user staff  160 file.txt'
    expect(
      estimateBlockTokens({ kind: 'tool', id: 't2', name: 'bash', status: 'done', detail } as unknown as ChatBlock)
    ).toBe(estimateTokensFromText(detail))
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
