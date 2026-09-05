import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '../shared/app-settings'
import { normalizeAppSettings } from '../shared/app-settings'
import type { ModelsDevCatalogResult } from '../shared/kun-gui-api'
import { prefetchCatalogPricing } from './catalog-prefetch'

vi.mock('./models-dev-catalog', () => ({
  fetchModelsDevCatalog: vi.fn()
}))

const { fetchModelsDevCatalog } = await import('./models-dev-catalog')
const fetchMock = vi.mocked(fetchModelsDevCatalog)

function settingsWithKimi(): AppSettingsV1 {
  return normalizeAppSettings({
    provider: {
      providers: [{
        id: 'kimi-code',
        name: 'Kimi Code',
        apiKey: 'test-key',
        baseUrl: 'https://api.kimi.com/coding/v1',
        endpointFormat: 'chat_completions',
        useProxy: false,
        models: ['k3', 'kimi-for-coding'],
        modelProfiles: {
          k3: {
            contextWindowTokens: 1_000_000,
            inputModalities: ['text', 'image'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text', 'image_url']
          },
          'kimi-for-coding': {
            contextWindowTokens: 262_144,
            inputModalities: ['text'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text']
          }
        }
      }]
    }
  } as unknown as AppSettingsV1)
}

function catalogOk(pricing?: { input: number; output: number }): ModelsDevCatalogResult {
  return {
    status: 'ok',
    providerKey: 'moonshotai-cn',
    providerName: 'Moonshot AI CN',
    matchMode: 'catalog',
    stale: false,
    models: [
      {
        id: 'kimi-k3',
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
        ...(pricing ? { pricing: {
          inputUsdPerMillion: pricing.input,
          outputUsdPerMillion: pricing.output,
          cacheReadUsdPerMillion: 0.3
        } } : {})
      }
    ]
  }
}

function storeWith(initial: AppSettingsV1) {
  let current = initial
  return {
    load: vi.fn(async () => current),
    update: vi.fn(async (mutation: (s: AppSettingsV1) => AppSettingsV1) => {
      current = mutation(current)
      return current
    }),
    get current() { return current }
  }
}

describe('prefetchCatalogPricing', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('hydrates catalog pricing into preset provider model profiles', async () => {
    fetchMock.mockResolvedValue(catalogOk({ input: 1, output: 4 }))
    const store = storeWith(settingsWithKimi())

    await prefetchCatalogPricing(store)

    const kimi = store.current.provider.providers.find((p) => p.id === 'kimi-code')
    expect(kimi?.modelProfiles.k3?.pricing).toEqual({
      inputUsdPerMillion: 1,
      outputUsdPerMillion: 4,
      cacheReadUsdPerMillion: 0.3
    })
    // Preset static pricing (offline fallback) already covers kimi-for-coding.
    expect(kimi?.modelProfiles['kimi-for-coding']?.pricing).toEqual({
      inputUsdPerMillion: 0.95,
      outputUsdPerMillion: 4,
      cacheReadUsdPerMillion: 0.19
    })
  })

  it('keeps static preset pricing when the catalog has no pricing for the provider', async () => {
    fetchMock.mockResolvedValue(catalogOk())
    const store = storeWith(settingsWithKimi())

    await prefetchCatalogPricing(store)

    const kimi = store.current.provider.providers.find((p) => p.id === 'kimi-code')
    expect(kimi?.modelProfiles.k3?.pricing).toEqual({
      inputUsdPerMillion: 3,
      outputUsdPerMillion: 15,
      cacheReadUsdPerMillion: 0.3
    })
  })

  it('swallows fetch failures without throwing', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    const store = storeWith(settingsWithKimi())

    // The prefetch must never reject; a dead network leaves profiles untouched.
    await expect(prefetchCatalogPricing(store)).resolves.toBeUndefined()
  })
})
