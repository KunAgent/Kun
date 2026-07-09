import { describe, expect, it } from 'vitest'
import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import { resolveCompatModelCapabilities } from './compat-capabilities.js'

function metadata(overrides: Partial<ModelCapabilityMetadata> = {}): ModelCapabilityMetadata {
  return {
    id: 'vision-reasoning',
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    supportsToolCalling: false,
    messageParts: ['text', 'image_url'],
    maxOutputTokens: 12_000,
    reasoning: {
      supportedEfforts: ['auto', 'off', 'high'],
      defaultEffort: 'auto',
      requestProtocol: 'openai-responses'
    },
    ...overrides
  }
}

describe('compat model capabilities', () => {
  it('inherits provider endpoint format without model metadata', () => {
    expect(resolveCompatModelCapabilities({
      model: 'plain-model',
      providerEndpointFormat: 'messages'
    })).toMatchObject({
      model: 'plain-model',
      endpointFormat: 'messages',
      inputModalities: ['text'],
      messageParts: ['text'],
      supportsStreaming: true,
      supportsVision: false,
      supportsReasoning: false,
      supportsCacheUsage: true,
      supportsToolCalling: true
    })
  })

  it('lets per-model metadata override endpoint format and capabilities', () => {
    const capabilities = resolveCompatModelCapabilities({
      model: 'vision-reasoning',
      providerEndpointFormat: 'chat_completions',
      modelCapabilities: (model) => metadata({ id: model, endpointFormat: 'responses' })
    })

    expect(capabilities.endpointFormat).toBe('responses')
    expect(capabilities.supportsVision).toBe(true)
    expect(capabilities.supportsReasoning).toBe(true)
    expect(capabilities.supportsToolCalling).toBe(false)
    expect(capabilities.maxOutputTokens).toBe(12_000)
    expect(capabilities.reasoning?.requestProtocol).toBe('openai-responses')
  })
})
