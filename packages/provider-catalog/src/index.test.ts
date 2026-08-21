import { describe, expect, it } from 'vitest'
import {
  getProviderCatalogPreset,
  providerCatalogEntries,
  resolveProviderCatalogSource,
  PROVIDER_CATALOG
} from './index.js'

describe('provider catalog', () => {
  it('publishes every GUI base preset and Token Plan as stable entries', () => {
    const entries = providerCatalogEntries()
    expect(PROVIDER_CATALOG).toHaveLength(24)
    expect(entries).toHaveLength(29)
    expect(entries.filter((entry) => entry.category === 'subscription')).toHaveLength(18)
    expect(entries.filter((entry) => entry.category === 'api')).toHaveLength(11)
    expect(entries.map((entry) => entry.profileId)).toEqual(expect.arrayContaining([
      'gemini-subscription',
      'gemini-cli-subscription',
      'cursor-subscription',
      'ollama',
      'volcengine',
      'volcengine-agent-plan',
      'zenmux',
      'zenmux-token-plan',
      'xiaomi-token-plan',
      'minimax-token-plan',
      'aliyun-token-plan',
      'tencentcloud-token-plan'
    ]))
  })

  it('publishes separate ZenMux pay-as-you-go and Builder Plan entries', () => {
    expect(getProviderCatalogPreset('zenmux')).toMatchObject({
      name: 'ZenMux API',
      category: 'api',
      authFlow: 'api-key',
      authType: 'api-key',
      baseUrl: 'https://zenmux.ai/api/v1',
      endpointFormat: 'chat_completions',
      models: [],
      credentialUrl: 'https://zenmux.ai/platform/pay-as-you-go',
      tokenPlan: {
        displayName: 'ZenMux Builder Plan (Coding Plan)',
        baseUrl: 'https://zenmux.ai/api/v1',
        endpointFormat: 'chat_completions',
        models: [],
        credentialUrl: 'https://zenmux.ai/platform/subscription'
      }
    })
    expect(providerCatalogEntries()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        profileId: 'zenmux',
        mode: 'api',
        label: 'ZenMux API',
        category: 'api'
      }),
      expect.objectContaining({
        profileId: 'zenmux-token-plan',
        mode: 'token-plan',
        label: 'ZenMux Builder Plan (Coding Plan)',
        name: 'ZenMux Builder Plan (Coding Plan)',
        category: 'subscription'
      })
    ]))
  })

  it('resolves numbered subscription and token-plan accounts without matching base URLs', () => {
    expect(resolveProviderCatalogSource({ id: 'opencode-go-2' })).toMatchObject({
      presetSource: 'opencode-go',
      presetMode: 'api',
      preset: { category: 'subscription', authType: 'subscription' }
    })
    expect(resolveProviderCatalogSource({ id: 'minimax-token-plan-2' })).toMatchObject({
      presetSource: 'minimax',
      presetMode: 'token-plan'
    })
    expect(resolveProviderCatalogSource({ id: 'custom-opencode-go-2' })).toBeNull()
  })

  it('keeps OAuth connection routing in the shared source of truth', () => {
    expect(getProviderCatalogPreset('grok-subscription')).toMatchObject({
      baseUrl: 'https://cli-chat-proxy.grok.com/v1',
      endpointFormat: 'responses',
      authFlow: 'grok-oauth',
      models: [
        'grok-4.5',
        'grok-4-1-fast-reasoning',
        'grok-4-1-fast-non-reasoning',
        'grok-code-fast-1'
      ]
    })
    expect(getProviderCatalogPreset('codex')?.models).toHaveLength(7)
    expect(getProviderCatalogPreset('claude-subscription')?.models).toContain('claude-opus-4-8')
  })
})
