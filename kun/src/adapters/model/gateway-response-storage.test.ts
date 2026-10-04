import { describe, expect, it } from 'vitest'
import type { ModelRequest } from '../../ports/model-client.js'
import { createCompatRequestCodecs } from './compat-request-builder.js'

describe('gateway upstream response storage', () => {
  it.each(['responses', 'chat_completions'] as const)('disables stored responses for gateway %s calls only', (endpointFormat) => {
    const codecs = createCompatRequestCodecs()
    const request: ModelRequest = { prefix: [], threadId: 'test', turnId: 'turn', model: 'model', history: [], tools: [],
      abortSignal: new AbortController().signal }
    const input = { request, model: 'model', messages: [{ role: 'user' as const, content: 'hello' }], tools: [],
      stream: true, endpointFormat, baseUrl: 'https://api.example.invalid/v1', isCodex: false,
      isCodexLite: false, codexNativeImageGeneration: false }
    expect(codecs.build(input)).not.toHaveProperty('store')
    expect(codecs.build({ ...input, request: { ...request,
      gatewayRouting: { allowedTargets: [{ providerId: 'api', modelId: 'model' }] } } }).store).toBe(false)
  })
})
