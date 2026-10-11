import { describe, expect, it } from 'vitest'
import { defaultKunRuntimeSettings, defaultModelProviderSettings, type AppSettingsV1 } from '../../shared/app-settings'
import { providersConfigForRuntime } from './kun-runtime-model-config'

describe('provider-wide model defaults', () => {
  it('fills unset model facts from the * profile and keeps each model\'s own', () => {
    const provider = defaultModelProviderSettings()
    const settings = { provider, agents: { kun: defaultKunRuntimeSettings() } } as AppSettingsV1
    const base = { inputModalities: ['text'], outputModalities: ['text'], supportsToolCalling: true, messageParts: ['text'] }
    provider.providers = [{ ...provider.providers[0]!, id: 'relay', apiKey: 'k', baseUrl: 'https://relay.example/v1', models: ['a', 'b'],
      modelProfiles: {
        '*': { ...base, contextWindowTokens: 128_000, wireModelId: 'ns/*', pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 2 } },
        a: { ...base, contextWindowTokens: 32_000 }
      } } as never]
    const relay = (providersConfigForRuntime(settings) as Record<string, { modelCapabilities?: Record<string, Record<string, unknown>> }>).relay!
    expect(relay.modelCapabilities?.a).toMatchObject({ contextWindowTokens: 32_000, wireModelId: 'ns/*', pricing: { inputUsdPerMillion: 1 } })
    expect(relay.modelCapabilities?.b).toMatchObject({ id: 'b', contextWindowTokens: 128_000 })
    expect(relay.modelCapabilities).not.toHaveProperty('*')
  })
})
