import { describe, expect, it } from 'vitest'
import { grokPromptResultUsage } from './grok-usage.js'
import { providerModule } from './providers/registry.js'

// `_meta` of a real `session/prompt` result from grok 1.0.50 (one model call, cache read, reasoning).
const meta = {
  sessionId: '01a1219c-7a89-7021-941d-10aee51cc0bf',
  totalTokens: 16678,
  modelId: 'grok-4.7',
  inputTokens: 16643,
  usage: {
    inputTokens: 16643, outputTokens: 28, totalTokens: 16671, cachedReadTokens: 1664, cacheCreationTokens: 0,
    reasoningTokens: 27, modelCalls: 1, apiDurationMs: 7097, costUsdTicks: 105257200, numTurns: 1
  }
}

describe('Grok prompt-result usage', () => {
  it('reads the turn totals from _meta.usage in ACP shape and leaves the cost out', () => {
    expect(grokPromptResultUsage(meta)).toEqual({
      inputTokens: 16643, outputTokens: 28, totalTokens: 16671, cachedReadTokens: 1664, thoughtTokens: 27
    })
  })

  it('forwards cache writes and drops zero-valued optional counts', () => {
    expect(grokPromptResultUsage({ usage: { inputTokens: 10, outputTokens: 2, cacheCreationTokens: 4, cachedReadTokens: 0, reasoningTokens: 0 } }))
      .toEqual({ inputTokens: 10, outputTokens: 2, cachedWriteTokens: 4 })
  })

  it.each([{}, { usage: null }, { usage: [] }, { usage: 'x' }, { usage: { inputTokens: 0, outputTokens: 0 } },
    { usage: { inputTokens: -5, outputTokens: Number.NaN } }])('reports nothing for %j', (value) => {
    expect(grokPromptResultUsage(value as Record<string, unknown>)).toBeUndefined()
  })

  it('is registered for Grok Build only', () => {
    expect(providerModule('grok')?.acp?.promptResultUsage).toBe(grokPromptResultUsage)
    expect(providerModule('qoder')?.acp?.promptResultUsage).toBeUndefined()
  })
})
