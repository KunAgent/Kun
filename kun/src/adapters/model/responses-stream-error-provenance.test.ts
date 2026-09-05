import { describe, expect, it } from 'vitest'
import { decodeResponsesStreamPayload, createResponsesContentTracker } from './responses-stream-decoder.js'
import { DEFAULT_MODEL_STREAM_LIMITS, ModelStreamResourceBudget } from './model-stream-resource-budget.js'

describe('Responses stream error provenance', () => {
  it('preserves the provider error code and message', () => {
    const decoded = decodeResponsesStreamPayload({
      payload: {
        type: 'error',
        error: {
          code: 'server_is_overloaded',
          message: 'Our servers are currently overloaded. Please try again later.'
        }
      },
      pendingArguments: new Map(),
      pendingByIndex: new Map(),
      completedToolCalls: new Set(),
      sawTextDelta: false,
      contentTracker: createResponsesContentTracker(),
      budget: new ModelStreamResourceBudget(DEFAULT_MODEL_STREAM_LIMITS),
      parseToolArguments: () => ({}),
      normalizeUsage: () => ({
        promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitRate: null, turns: 1
      })
    })

    expect(decoded.finishReason).toBe('error')
    expect(decoded.chunks).toEqual([expect.objectContaining({
      kind: 'error', code: 'server_is_overloaded',
      message: 'Our servers are currently overloaded. Please try again later.',
      failure: {
        category: 'unavailable', responseReceived: true,
        providerCode: 'server_is_overloaded', failoverAllowed: false
      }
    })])
  })
})
