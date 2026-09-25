import { describe, expect, it, vi } from 'vitest'
import { ProviderQuotaService, QUOTA_CACHE_TTL_MS } from './provider-quota-service.js'
import type { ProviderQuotaProbeProfile } from './provider-subscription-quota.js'

const profile = (
  overrides: Partial<ProviderQuotaProbeProfile> = {}
): ProviderQuotaProbeProfile => ({
  id: 'deepseek',
  name: 'DeepSeek',
  presetId: 'deepseek',
  kind: 'http',
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'quota-secret',
  ...overrides
})

const deepseekBalance = (balance: string) =>
  Response.json({
    is_available: true,
    balance_infos: [{
      currency: 'CNY',
      total_balance: balance,
      granted_balance: '0',
      topped_up_balance: balance
    }]
  })

describe('ProviderQuotaService cache', () => {
  it('reuses a cached entry inside the TTL instead of re-probing', async () => {
    let clock = 1_000_000
    const fetcher = vi.fn(async () => deepseekBalance('40'))
    const service = new ProviderQuotaService({
      loadSource: async () => ({ profiles: [profile()] }),
      fetcher: fetcher as never,
      now: () => clock
    })
    const first = await service.list()
    clock += QUOTA_CACHE_TTL_MS - 1
    const second = await service.list()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(second.entries[0]).toEqual(first.entries[0])
  })

  it('re-probes after the TTL expires and forceRefresh skips the cache', async () => {
    let clock = 1_000_000
    const fetcher = vi.fn(async () => deepseekBalance('40'))
    const service = new ProviderQuotaService({
      loadSource: async () => ({ profiles: [profile()] }),
      fetcher: fetcher as never,
      now: () => clock
    })
    await service.list()
    clock += QUOTA_CACHE_TTL_MS + 1
    await service.list()
    expect(fetcher).toHaveBeenCalledTimes(2)
    await service.list({ forceRefresh: true })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('probes only the providerIds requested by the route refresh', async () => {
    const fetcher = vi.fn(async () => deepseekBalance('40'))
    const service = new ProviderQuotaService({
      loadSource: async () => ({
        profiles: [
          profile(),
          profile({
            id: 'openrouter',
            name: 'OpenRouter',
            presetId: 'openrouter',
            baseUrl: 'https://openrouter.ai/api/v1'
          })
        ]
      }),
      fetcher: fetcher as never
    })
    const result = await service.list({ providerIds: ['deepseek'] })
    expect(result.entries.map((entry) => entry.providerId)).toEqual(['deepseek'])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('skips local cost aggregation for routing refreshes', async () => {
    const loadLocalCosts = vi.fn(async () => ({}))
    const service = new ProviderQuotaService({
      loadSource: async () => ({ profiles: [profile()] }),
      fetcher: vi.fn(async () => deepseekBalance('40')) as never,
      loadLocalCosts
    })
    await service.list({ providerIds: ['deepseek'], includeLocalCosts: false })
    expect(loadLocalCosts).not.toHaveBeenCalled()
    await service.list({ forceRefresh: true })
    expect(loadLocalCosts).toHaveBeenCalledTimes(1)
  })

  it('keeps the previous snapshot when a refresh fails', async () => {
    let clock = 1_000_000
    let fail = false
    const fetcher = vi.fn(async () =>
      fail ? new Response('down', { status: 503 }) : deepseekBalance('40')
    )
    const service = new ProviderQuotaService({
      loadSource: async () => ({ profiles: [profile()] }),
      fetcher: fetcher as never,
      now: () => clock
    })
    const first = await service.list()
    expect(first.entries[0]?.status).toBe('available')
    clock += QUOTA_CACHE_TTL_MS + 1
    fail = true
    const second = await service.list()
    expect(second.entries[0]).toEqual(first.entries[0])
  })

  it('shares one in-flight probe across concurrent list calls', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetcher = vi.fn(async () => {
      await gate
      return deepseekBalance('40')
    })
    const service = new ProviderQuotaService({
      loadSource: async () => ({ profiles: [profile()] }),
      fetcher: fetcher as never
    })
    const [a, b] = await Promise.all([service.list(), (release(), service.list())])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(a.entries[0]).toEqual(b.entries[0])
  })
})
