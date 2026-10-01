import { describe, expect, it, vi } from 'vitest'
import {
  activeModelConnectionProviderId,
  extensionAgentRunOptionsForOptions
} from './runtime-factory.js'
import { modelConnectionSeedsForOptions, modelContextProfilesByProvider } from './runtime-factory-model.js'
import { resolveModelContextProfile } from '../loop/model-context-profile.js'

describe('activeModelConnectionProviderId', () => {
  const providers = {
    deepseek: {
      apiKey: '',
      baseUrl: 'https://api.deepseek.com',
      endpointFormat: 'chat_completions' as const,
      models: ['deepseek-chat']
    }
  }

  it('keeps the provider identity for legacy and Registry-owned credential sources', () => {
    expect(activeModelConnectionProviderId({
      credentialSourceId: 'settings:provider:deepseek',
      providers
    })).toBe('deepseek')
    expect(activeModelConnectionProviderId({
      credentialSourceId: 'model-connection:deepseek',
      providers
    })).toBe('deepseek')
  })

  it('does not accept a credential source for an unavailable provider', () => {
    expect(activeModelConnectionProviderId({
      credentialSourceId: 'model-connection:missing',
      providers
    })).toBe('default')
  })

  it('projects only the active configured provider catalog without credentials', () => {
    expect(extensionAgentRunOptionsForOptions({
      host: '127.0.0.1',
      port: 0,
      dataDir: '/tmp/kun-model-options',
      runtimeToken: 'runtime-token',
      apiKey: 'must-not-leak',
      credentialSourceId: 'settings:provider:codex',
      baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
      model: 'gpt-5.6-sol',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      tokenEconomyMode: false,
      insecure: false,
      providers: {
        codex: {
          apiKey: 'must-not-leak',
          baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
          models: ['gpt-5.6-luna', 'gpt-5.6-sol'],
          selectedModel: 'gpt-5.6-sol',
          modelCapabilities: {
            'gpt-5.6-sol': {
              id: 'gpt-5.6-sol',
              inputModalities: ['text'],
              outputModalities: ['text'],
              supportsToolCalling: true,
              messageParts: ['text'],
              reasoning: {
                supportedEfforts: ['low', 'medium', 'high', 'max'],
                defaultEffort: 'high',
                requestProtocol: 'openai-responses'
              }
            }
          }
        },
        deepseek: {
          apiKey: 'other-secret',
          baseUrl: 'https://api.deepseek.com',
          models: ['deepseek-v4-pro']
        }
      }
    })).toEqual({
      defaultModel: 'gpt-5.6-sol',
      models: [
        expect.objectContaining({ id: 'gpt-5.6-luna', selected: false }),
        {
          id: 'gpt-5.6-sol',
          displayName: 'gpt-5.6-sol',
          selected: true,
          reasoningEfforts: ['low', 'medium', 'high', 'max'],
          defaultReasoningEffort: 'high'
        }
      ]
    })
  })

  it('projects an explicitly selected provider catalog without a credential source', () => {
    expect(extensionAgentRunOptionsForOptions({
      host: '127.0.0.1',
      port: 0,
      dataDir: '/tmp/kun-custom-model-options',
      runtimeToken: 'runtime-token',
      apiKey: '',
      activeProviderId: 'custom-http',
      baseUrl: 'https://api.example.test/v1',
      model: 'custom-model',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      tokenEconomyMode: false,
      insecure: false,
      providers: {
        'custom-http': {
          apiKey: '',
          baseUrl: 'https://api.example.test/v1',
          models: ['custom-model', 'other-model'],
          selectedModel: 'custom-model'
        },
        deepseek: {
          apiKey: 'must-not-leak',
          baseUrl: 'https://api.deepseek.com',
          models: ['deepseek-chat']
        }
      }
    })).toMatchObject({
      defaultModel: 'custom-model',
      models: [
        { id: 'custom-model', selected: true },
        { id: 'other-model', selected: false }
      ]
    })
  })

  it('does not seed leftover OpenCode Free connections', () => {
    expect(modelConnectionSeedsForOptions({
      host: '127.0.0.1',
      port: 0,
      dataDir: '/tmp/kun-model-seeds',
      runtimeToken: 'runtime-token',
      apiKey: '',
      activeProviderId: 'opencode-free',
      baseUrl: 'https://opencode.ai/zen/v1',
      model: 'big-pickle',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      tokenEconomyMode: false,
      insecure: false,
      providers: {
        'opencode-free': {
          apiKey: '',
          presetSource: 'opencode-free',
          baseUrl: 'https://opencode.ai/zen/v1',
          models: ['big-pickle', 'gpt-5-nano'],
          selectedModel: 'big-pickle'
        },
        deepseek: {
          apiKey: 'secret',
          baseUrl: 'https://api.deepseek.com',
          models: ['deepseek-chat'],
          selectedModel: 'deepseek-chat'
        }
      }
    }).map((seed) => seed.id)).toEqual(['deepseek'])
  })
})

describe('modelContextProfilesByProvider', () => {
  it('does not throw for a provider model profile without capacity info', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const profilesByProvider = modelContextProfilesByProvider({
        'custom-provider': {
          apiKey: '',
          baseUrl: 'https://api.example.com/v1',
          models: ['sparse-model'],
          modelProfiles: {
            'sparse-model': {
              pricing: { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.2 },
              inputModalities: ['text'],
              outputModalities: ['text'],
              supportsToolCalling: true,
              messageParts: ['text']
            }
          }
        }
      })

      expect(resolveModelContextProfile('sparse-model', profilesByProvider.get('custom-provider')))
        .toMatchObject({
          contextWindowTokens: 256_000,
          softThreshold: 192_000,
          hardThreshold: 217_600,
          pricing: { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.2 }
        })
    } finally {
      warn.mockRestore()
    }
  })
})
