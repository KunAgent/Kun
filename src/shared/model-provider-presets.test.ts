import { describe, expect, it } from 'vitest'
import {
  providerCatalogEntries,
  PROVIDER_CATALOG,
  type ProviderCatalogPreset
} from '@kun/provider-catalog'
import {
  getModelProviderPreset,
  modelProviderPresetAccountProfile,
  modelProviderPresetProfile,
  modelProviderTokenPlanProfile,
  MODEL_PROVIDER_PRESETS,
  tokenPlanProviderId
} from './model-provider-presets'

describe('shared model provider preset catalog', () => {
  it('keeps GUI connection fields aligned with the framework-neutral catalog', () => {
    const catalog: readonly ProviderCatalogPreset[] = PROVIDER_CATALOG
    expect(MODEL_PROVIDER_PRESETS.map((preset) => preset.id))
      .toEqual(catalog.map((preset) => preset.id))

    for (const source of catalog) {
      const gui = MODEL_PROVIDER_PRESETS.find((preset) => preset.id === source.id)
      expect(gui).toMatchObject({
        name: source.name,
        baseUrl: source.baseUrl,
        endpointFormat: source.endpointFormat,
        models: [...source.models],
        docsUrl: source.docsUrl,
        apiKeyUrl: source.credentialUrl
      })
      expect(gui?.category ?? 'api').toBe(source.category)
      expect(gui?.kind ?? 'http').toBe(source.kind)
      if (source.tokenPlan) {
        expect(gui?.tokenPlan).toMatchObject({
          baseUrl: source.tokenPlan.baseUrl,
          endpointFormat: source.tokenPlan.endpointFormat,
          models: [...source.tokenPlan.models],
          apiKeyUrl: source.tokenPlan.credentialUrl
        })
      } else {
        expect(gui?.tokenPlan).toBeUndefined()
      }
    }
  })

  it('expands the same Token Plan profile identities used by GUI Settings', () => {
    const tokenPlans = providerCatalogEntries().filter((entry) => entry.mode === 'token-plan')
    expect(tokenPlans.map((entry) => entry.profileId)).toEqual(
      MODEL_PROVIDER_PRESETS
        .filter((preset) => preset.tokenPlan)
        .map((preset) => tokenPlanProviderId(preset.id))
    )
  })

  it('builds independent ZenMux API and Builder Plan profiles', () => {
    const preset = getModelProviderPreset('zenmux')
    expect(preset).not.toBeNull()

    const api = modelProviderPresetProfile(preset!, 'sk-ai-v1-api')
    const plan = modelProviderTokenPlanProfile(preset!, 'sk-ss-v1-plan')
    expect(api).toMatchObject({
      id: 'zenmux',
      name: 'ZenMux API',
      presetSource: { presetId: 'zenmux', mode: 'api' },
      apiKey: 'sk-ai-v1-api',
      baseUrl: 'https://zenmux.ai/api/v1',
      endpointFormat: 'chat_completions',
      useProxy: false,
      models: []
    })
    expect(plan).toMatchObject({
      id: 'zenmux-token-plan',
      name: 'ZenMux Builder Plan (Coding Plan)',
      presetSource: { presetId: 'zenmux', mode: 'token-plan' },
      apiKey: 'sk-ss-v1-plan',
      baseUrl: 'https://zenmux.ai/api/v1',
      endpointFormat: 'chat_completions',
      useProxy: false,
      models: []
    })
    expect(preset?.tokenPlan?.keyPrefix).toBe('sk-ss-v1-')

    expect(modelProviderPresetAccountProfile(preset!, 'token-plan', [plan!])).toMatchObject({
      id: 'zenmux-token-plan-2',
      name: 'ZenMux Builder Plan (Coding Plan) 2',
      presetSource: { presetId: 'zenmux', mode: 'token-plan' }
    })
  })
})
