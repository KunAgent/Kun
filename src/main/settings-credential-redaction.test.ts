import { describe, expect, it } from 'vitest'
import {
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import { preserveRedactedProviderCredentials } from './settings-credential-redaction'

function settingsWithSecrets(): AppSettingsV1 {
  const provider = defaultModelProviderSettings()
  const deepseek = provider.providers.find((item) => item.id === 'deepseek') ?? provider.providers[0]!
  return {
    version: 1,
    initialSetupCompleted: true,
    locale: 'en',
    theme: 'system',
    provider: {
      ...provider,
      apiKey: 'top-level-secret',
      providers: [
        { ...deepseek, apiKey: 'deepseek-secret' },
        {
          id: 'opencode-go',
          name: 'OpenCode Go',
          apiKey: 'opencode-secret',
          baseUrl: 'https://opencode.ai/zen/go/v1',
          endpointFormat: 'chat_completions',
          useProxy: false,
          models: ['grok-4.5'],
          modelProfiles: {}
        }
      ]
    },
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(),
        apiKey: 'kun-runtime-secret',
        providerId: 'opencode-go',
        model: 'grok-4.5'
      }
    }
  } as AppSettingsV1
}

describe('preserveRedactedProviderCredentials', () => {
  it('restores hydrated provider secrets when the renderer sends redacted empty apiKeys', () => {
    const prev = settingsWithSecrets()
    const preserved = preserveRedactedProviderCredentials(prev, {
      provider: {
        providers: prev.provider.providers.map((provider) => ({
          ...provider,
          apiKey: ''
        })),
        apiKey: ''
      },
      agents: {
        kun: {
          providerId: 'opencode-go',
          apiKey: '',
          baseUrl: ''
        }
      }
    })

    expect(preserved.provider?.apiKey).toBe('top-level-secret')
    expect(preserved.provider?.providers?.find((item) => item.id === 'deepseek')?.apiKey)
      .toBe('deepseek-secret')
    expect(preserved.provider?.providers?.find((item) => item.id === 'opencode-go')?.apiKey)
      .toBe('opencode-secret')
    expect(preserved.agents?.kun?.apiKey).toBe('kun-runtime-secret')
  })

  it('keeps newly provided non-empty secrets from the patch', () => {
    const prev = settingsWithSecrets()
    const preserved = preserveRedactedProviderCredentials(prev, {
      provider: {
        providers: prev.provider.providers.map((provider) =>
          provider.id === 'opencode-go'
            ? { ...provider, apiKey: 'replacement-secret' }
            : { ...provider, apiKey: '' }
        )
      }
    })

    expect(preserved.provider?.providers?.find((item) => item.id === 'opencode-go')?.apiKey)
      .toBe('replacement-secret')
    expect(preserved.provider?.providers?.find((item) => item.id === 'deepseek')?.apiKey)
      .toBe('deepseek-secret')
  })

  it('does not invent secrets for brand-new providers', () => {
    const prev = settingsWithSecrets()
    const preserved = preserveRedactedProviderCredentials(prev, {
      provider: {
        providers: [
          ...prev.provider.providers.map((provider) => ({ ...provider, apiKey: '' })),
          {
            id: 'custom-new',
            name: 'Custom',
            apiKey: '',
            baseUrl: 'https://example.test/v1',
            endpointFormat: 'chat_completions',
            useProxy: false,
            models: [],
            modelProfiles: {}
          }
        ]
      }
    })

    expect(preserved.provider?.providers?.find((item) => item.id === 'custom-new')?.apiKey)
      .toBe('')
  })
})
