import { describe, expect, it, vi } from 'vitest'
import { ModelsDevCatalogService } from './models-dev-catalog'

const OPENCODE_ZEN_BASE = 'https://opencode.ai/zen/v1'
const modalities = { input: ['text'], output: ['text'] }

function opencodeCatalog(models: Record<string, unknown>): string {
  return JSON.stringify({
    opencode: {
      id: 'opencode',
      name: 'OpenCode Zen',
      api: OPENCODE_ZEN_BASE,
      models
    }
  })
}

describe('ModelsDevCatalogService pricing', () => {
  it('marks zero-cost models free with zero pricing and keeps paid pricing', async () => {
    const body = opencodeCatalog({
      'free-model': { id: 'free-model', cost: { input: 0, output: 0 }, modalities },
      'paid-model': { id: 'paid-model', cost: { input: 0, output: 1 }, modalities }
    })
    const service = new ModelsDevCatalogService(vi.fn(async () => new Response(body, { status: 200 })))
    await expect(service.fetch({
      providerId: 'opencode-free',
      baseUrl: OPENCODE_ZEN_BASE
    })).resolves.toMatchObject({
      status: 'ok',
      providerKey: 'opencode',
      models: [
        { id: 'free-model', free: true, pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 0 } },
        { id: 'paid-model', pricing: { inputUsdPerMillion: 0, outputUsdPerMillion: 1 } }
      ]
    })
  })

  it('parses cache prices when the catalog reports them', async () => {
    const body = opencodeCatalog({
      'cached-model': {
        id: 'cached-model',
        cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 1.5 },
        modalities
      }
    })
    const service = new ModelsDevCatalogService(vi.fn(async () => new Response(body, { status: 200 })))
    await expect(service.fetch({
      providerId: 'opencode-free',
      baseUrl: OPENCODE_ZEN_BASE
    })).resolves.toMatchObject({
      status: 'ok',
      models: [{
        id: 'cached-model',
        pricing: {
          inputUsdPerMillion: 1,
          outputUsdPerMillion: 2,
          cacheReadUsdPerMillion: 0.1,
          cacheWriteUsdPerMillion: 1.5
        }
      }]
    })
  })

  it('drops pricing when catalog cost values are missing or invalid', async () => {
    const model = (id: string, cost: Record<string, unknown>) => ({ id, cost, modalities })
    const body = opencodeCatalog({
      'no-output-price': model('no-output-price', { input: 1 }),
      'negative-price': model('negative-price', { input: -1, output: 2 }),
      'string-price': model('string-price', { input: '1', output: 2 }),
      'cache-only-price': model('cache-only-price', { cache_read: 0.1, cache_write: 1.5 })
    })
    const service = new ModelsDevCatalogService(vi.fn(async () => new Response(body, { status: 200 })))
    const result = await service.fetch({
      providerId: 'opencode-free',
      baseUrl: OPENCODE_ZEN_BASE
    })
    expect(result).toMatchObject({ status: 'ok', providerKey: 'opencode' })
    if (result.status === 'ok') {
      expect(result.models.every((m) => m.pricing === undefined)).toBe(true)
    }
  })
})
