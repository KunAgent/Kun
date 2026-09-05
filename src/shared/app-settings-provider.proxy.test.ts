import { describe, expect, it } from 'vitest'
import {
  PROVIDER_PROXY_ROUTING_VERSION,
  ProviderProxyConfigurationError,
  defaultModelProviderSettings,
  normalizeModelProviderSettings,
  resolveProviderProxyRoute,
  resolveProviderProxyUrl
} from './app-settings'
import { settings } from './app-settings-provider.test-support'

function customProvider(useProxy?: boolean) {
  return {
    id: 'custom',
    name: 'Custom',
    apiKey: 'secret',
    baseUrl: 'https://models.example.test/v1',
    endpointFormat: 'chat_completions' as const,
    ...(useProxy === undefined ? {} : { useProxy }),
    models: ['model-a'],
    modelProfiles: {}
  }
}

describe('provider-scoped proxy settings', () => {
  it.each([
    { enabled: true, expected: true },
    { enabled: false, expected: false }
  ])('migrates an unmarked global proxy state once', ({ enabled, expected }) => {
    const migrated = normalizeModelProviderSettings({
      proxy: { enabled, url: 'http://127.0.0.1:7890' },
      providers: [customProvider()]
    })

    expect(migrated.proxyRoutingVersion).toBe(PROVIDER_PROXY_ROUTING_VERSION)
    expect(migrated.providers.every((provider) => provider.useProxy === expected)).toBe(true)
    const normalizedAgain = normalizeModelProviderSettings(migrated)
    expect(normalizedAgain.proxyRoutingVersion).toBe(PROVIDER_PROXY_ROUTING_VERSION)
    expect(normalizedAgain.providers.map((provider) => [provider.id, provider.useProxy]))
      .toEqual(migrated.providers.map((provider) => [provider.id, provider.useProxy]))
  })

  it('preserves explicit choices and defaults new profiles to direct', () => {
    const legacyExplicit = normalizeModelProviderSettings({
      proxy: { enabled: true, url: 'http://127.0.0.1:7890' },
      providers: [customProvider(false)]
    })
    const modernMissing = normalizeModelProviderSettings({
      ...defaultModelProviderSettings(),
      proxyRoutingVersion: PROVIDER_PROXY_ROUTING_VERSION,
      providers: [customProvider()]
    })

    expect(legacyExplicit.providers.find((provider) => provider.id === 'custom')?.useProxy)
      .toBe(false)
    expect(modernMissing.providers.find((provider) => provider.id === 'custom')?.useProxy)
      .toBe(false)
  })

  it('never falls back to the global proxy for a direct Provider', () => {
    const state = settings()
    state.provider.proxy = { enabled: true, url: 'http://127.0.0.1:7890' }
    const provider = state.provider.providers.find((candidate) => candidate.id === 'custom')!
    provider.useProxy = false

    expect(resolveProviderProxyUrl(state, provider)).toBe('')
    provider.useProxy = true
    expect(resolveProviderProxyUrl(state, provider)).toBe('http://127.0.0.1:7890/')
  })

  it('retains a disabled selection and fails closed for an invalid enabled proxy', () => {
    const state = settings()
    const provider = state.provider.providers.find((candidate) => candidate.id === 'custom')!
    provider.useProxy = true
    state.provider.proxy = { enabled: false, url: 'ftp://proxy.invalid' }
    expect(resolveProviderProxyRoute(state, provider)).toEqual({
      mode: 'direct',
      reason: 'master-disabled'
    })

    state.provider.proxy.enabled = true
    expect(() => resolveProviderProxyUrl(state, provider))
      .toThrow(ProviderProxyConfigurationError)
  })

  it('keeps delegated SDK and CLI traffic direct', () => {
    const state = settings()
    state.provider.proxy = { enabled: true, url: 'http://127.0.0.1:7890' }
    for (const kind of ['agent-sdk', 'cursor-sdk', 'antigravity-cli'] as const) {
      expect(resolveProviderProxyRoute(state, { id: kind, kind, useProxy: true })).toEqual({
        mode: 'direct',
        reason: 'unsupported'
      })
    }
  })
})
