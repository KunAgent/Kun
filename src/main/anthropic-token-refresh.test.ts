import { describe, expect, it } from 'vitest'
import { createAnthropicTokenRefresher } from './anthropic-token-refresh'
import { encodeAnthropicCredentials, type AnthropicOAuthCredentials } from './anthropic-auth'
import { getModelProviderSettings } from '../shared/app-settings-provider'
import type { AppSettingsPatch, AppSettingsV1, ModelProviderProfileV1 } from '../shared/app-settings-types'

const NOW = 1_700_000_000_000

function creds(expiresAt: number, accessToken = 'sk-ant-oat01-old'): AnthropicOAuthCredentials {
  return { kind: 'anthropic-oauth', accessToken, refreshToken: 'rt-old', expiresAt }
}

function provider(id: string, apiKey: string): ModelProviderProfileV1 {
  return {
    id,
    name: id,
    apiKey,
    baseUrl: 'https://api.anthropic.com',
    endpointFormat: 'messages',
    models: [],
    modelProfiles: {}
  }
}

function settingsWith(providers: ModelProviderProfileV1[]): AppSettingsV1 {
  return { provider: { apiKey: '', baseUrl: '', providers } } as unknown as AppSettingsV1
}

function patchProviders(patch: AppSettingsPatch): ModelProviderProfileV1[] {
  return (patch.provider as { providers: ModelProviderProfileV1[] }).providers
}

describe('createAnthropicTokenRefresher', () => {
  it('refreshes only credentials near expiry and re-persists rotated tokens', async () => {
    const dueApiKey = encodeAnthropicCredentials(creds(NOW + 5 * 60 * 1000)) // 5min left → due
    const freshApiKey = encodeAnthropicCredentials(creds(NOW + 50 * 60 * 1000)) // 50min left → not due
    const providers = [
      provider('claude-subscription', dueApiKey),
      provider('claude-secondary', freshApiKey),
      provider('deepseek', 'sk-plain-key')
    ]
    const applied: AppSettingsPatch[] = []
    const refresher = createAnthropicTokenRefresher({
      load: async () => settingsWith(providers),
      applyPatch: async (patch) => {
        applied.push(patch)
        return undefined
      },
      refresh: async () => creds(NOW + 60 * 60 * 1000, 'sk-ant-oat01-new'),
      now: () => NOW
    })

    expect(await refresher.refreshNow()).toBe(true)
    expect(applied).toHaveLength(1)
    const next = patchProviders(applied[0])
    const byId = (id: string): ModelProviderProfileV1 | undefined => next.find((p) => p.id === id)
    // Only the due provider's token rotated.
    expect(byId('claude-subscription')?.apiKey).toContain('sk-ant-oat01-new')
    // Every other provider is byte-identical to its normalized baseline (compare
    // normalized-to-normalized so this is robust to settings normalization).
    const baseline = getModelProviderSettings(settingsWith(providers)).providers
    for (const profile of baseline) {
      if (profile.id === 'claude-subscription') continue
      expect(byId(profile.id)?.apiKey).toBe(profile.apiKey)
    }
  })

  it('does nothing when no credential is near expiry', async () => {
    const providers = [provider('claude-subscription', encodeAnthropicCredentials(creds(NOW + 50 * 60 * 1000)))]
    const applied: AppSettingsPatch[] = []
    const refresher = createAnthropicTokenRefresher({
      load: async () => settingsWith(providers),
      applyPatch: async (patch) => {
        applied.push(patch)
        return undefined
      },
      refresh: async () => {
        throw new Error('should not refresh')
      },
      now: () => NOW
    })

    expect(await refresher.refreshNow()).toBe(false)
    expect(applied).toHaveLength(0)
  })

  it('leaves credentials unchanged when refresh fails', async () => {
    const providers = [provider('claude-subscription', encodeAnthropicCredentials(creds(NOW + 60 * 1000)))]
    const applied: AppSettingsPatch[] = []
    const refresher = createAnthropicTokenRefresher({
      load: async () => settingsWith(providers),
      applyPatch: async (patch) => {
        applied.push(patch)
        return undefined
      },
      refresh: async () => null,
      now: () => NOW
    })

    expect(await refresher.refreshNow()).toBe(false)
    expect(applied).toHaveLength(0)
  })
})
