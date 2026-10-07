import { describe, expect, it } from 'vitest'
import {
  attributeSdkContext,
  rebaseContextProfile,
  SdkContextOccupancyTracker
} from './sdk-context-occupancy.js'

function assistant(
  usage: Record<string, number>,
  options: { model?: string; parent?: string | null } = {}
) {
  return {
    type: 'assistant',
    parent_tool_use_id: options.parent ?? null,
    message: {
      role: 'assistant',
      model: options.model ?? 'claude-haiku-4-5-20251001',
      content: [],
      usage
    }
  }
}

describe('SdkContextOccupancyTracker', () => {
  it('reports nothing before any model request was observed', () => {
    expect(new SdkContextOccupancyTracker().snapshot()).toBeUndefined()
  })

  it('counts input, cache reads/writes and the reply of the last main request', () => {
    const tracker = new SdkContextOccupancyTracker()
    tracker.observe(assistant({
      input_tokens: 10,
      cache_read_input_tokens: 30_000,
      cache_creation_input_tokens: 5_000,
      output_tokens: 200
    }))

    expect(tracker.snapshot()).toEqual({ usedTokens: 35_210 })
  })

  it('tracks the latest request, not the cumulative sum across requests', () => {
    const tracker = new SdkContextOccupancyTracker()
    tracker.observe(assistant({ input_tokens: 1_000, output_tokens: 50 }))
    tracker.observe(assistant({ input_tokens: 1_400, output_tokens: 80 }))

    expect(tracker.snapshot()?.usedTokens).toBe(1_480)
  })

  it('ignores subagent traffic and non-assistant messages', () => {
    const tracker = new SdkContextOccupancyTracker()
    tracker.observe(assistant({ input_tokens: 900, output_tokens: 10 }))
    tracker.observe(assistant({ input_tokens: 90_000, output_tokens: 10 }, { parent: 'toolu_1' }))
    tracker.observe({ type: 'user', message: { role: 'user', content: 'x', usage: { input_tokens: 5_000 } } })
    tracker.observe({ type: 'stream_event', event: { type: 'message_start' } })

    expect(tracker.snapshot()?.usedTokens).toBe(910)
  })

  it('takes the real window from the result entry of the model that served the request', () => {
    const tracker = new SdkContextOccupancyTracker()
    tracker.observe(assistant({ input_tokens: 40_000, output_tokens: 700 }))
    tracker.observe({
      type: 'result',
      subtype: 'success',
      modelUsage: {
        'claude-haiku-4-5-20251001': { contextWindow: 200_000, inputTokens: 1 },
        'claude-sonnet-4-6': { contextWindow: 1_000_000, inputTokens: 1 }
      }
    })

    expect(tracker.snapshot()).toEqual({ usedTokens: 40_700, contextWindowTokens: 200_000 })
  })

  it('does not guess a window when several models report and none matches', () => {
    const tracker = new SdkContextOccupancyTracker()
    tracker.observe(assistant({ input_tokens: 100, output_tokens: 1 }, { model: 'haiku' }))
    tracker.observe({
      type: 'result',
      modelUsage: {
        'claude-haiku-4-5-20251001': { contextWindow: 200_000 },
        'claude-sonnet-4-6': { contextWindow: 1_000_000 }
      }
    })

    expect(tracker.snapshot()).toEqual({ usedTokens: 101 })
  })

  it('uses the only reported window when the model alias differs from the result key', () => {
    const tracker = new SdkContextOccupancyTracker()
    tracker.observe(assistant({ input_tokens: 100, output_tokens: 1 }, { model: 'haiku' }))
    tracker.observe({
      type: 'result',
      modelUsage: { 'claude-haiku-4-5-20251001': { contextWindow: 200_000 } }
    })

    expect(tracker.snapshot()).toEqual({ usedTokens: 101, contextWindowTokens: 200_000 })
  })

  it('ignores malformed usage and window values', () => {
    const tracker = new SdkContextOccupancyTracker()
    tracker.observe(assistant({ input_tokens: Number.NaN, output_tokens: -4 }))
    tracker.observe({ type: 'result', modelUsage: { m: { contextWindow: 'big' } } })

    expect(tracker.snapshot()).toBeUndefined()
  })
})

describe('attributeSdkContext', () => {
  it('keeps Kun-supplied estimates and puts the rest of the real total in messages', () => {
    expect(attributeSdkContext({ tools: 31_400, system: 1_600, skills: 2_500 }, 40_700)).toEqual({
      tools: 31_400,
      system: 1_600,
      skills: 2_500,
      messages: 5_200,
      other: 0
    })
  })

  it('never reports more than the real total when estimates overshoot', () => {
    const breakdown = attributeSdkContext({ tools: 31_400, system: 1_600, skills: 2_500 }, 20_000)

    expect(breakdown).toEqual({ tools: 20_000, system: 0, skills: 0, messages: 0, other: 0 })
  })
})

describe('rebaseContextProfile', () => {
  const conservative = {
    contextWindowTokens: 32_000,
    softThresholdTokens: 24_000,
    hardThresholdTokens: 27_200
  }

  it('moves thresholds onto the reported window and keeps their ratios', () => {
    expect(rebaseContextProfile(conservative, 200_000)).toEqual({
      contextWindowTokens: 200_000,
      softThresholdTokens: 150_000,
      hardThresholdTokens: 170_000
    })
  })

  it('returns the profile untouched when the window already agrees', () => {
    expect(rebaseContextProfile(conservative, 32_000)).toBe(conservative)
  })
})
