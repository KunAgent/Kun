import { describe, expect, it, vi } from 'vitest'
import { ProviderQuotaService } from './provider-quota-service.js'
import type { ProviderQuotaProbeProfile } from './provider-subscription-quota.js'

function profile(
  overrides: Partial<ProviderQuotaProbeProfile> = {}
): ProviderQuotaProbeProfile {
  return {
    id: 'deepseek',
    name: 'DeepSeek',
    presetId: 'deepseek',
    kind: 'http',
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'quota-secret',
    ...overrides
  }
}

describe('provider quota local cost loading', () => {
  it('keeps local Codex value when the upstream quota probe cannot authenticate', async () => {
    const localCost = {
      kind: 'reference_api_estimate' as const,
      currency: 'USD' as const,
      today: { requests: 2, totalTokens: 1_500, amount: 0.025, coverage: 'complete' as const },
      last30Days: { requests: 5, totalTokens: 8_000, amount: 0.12, coverage: 'partial' as const },
      updatedAt: '2026-08-20T12:00:00.000Z'
    }
    const loadLocalCosts = vi.fn(async () => ({ codex: localCost }))
    const service = new ProviderQuotaService({
      loadSource: async () => ({
        profiles: [profile({
          id: 'codex',
          name: 'Codex',
          presetId: 'codex',
          baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
          apiKey: ''
        })],
        proxyUrl: ''
      }),
      loadLocalCosts,
      subscriptionRuntime: {
        resolveCodexCredential: async () => undefined
      }
    })

    await expect(service.list()).resolves.toMatchObject({
      entries: [{ providerId: 'codex', status: 'missing_credentials', localCost }]
    })
    expect(loadLocalCosts).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'codex', presetId: 'codex' })
    ])
  })

  it('does not let a local history failure hide an available upstream quota', async () => {
    const service = new ProviderQuotaService({
      loadSource: async () => ({ profiles: [profile()], proxyUrl: '' }),
      loadLocalCosts: async () => { throw new Error('usage index unavailable') },
      fetcher: vi.fn(async () => Response.json({
        is_available: true,
        balance_infos: [{
          currency: 'CNY',
          total_balance: '12',
          granted_balance: '0',
          topped_up_balance: '12'
        }]
      }))
    })

    const result = await service.list()
    expect(result.entries[0]).toMatchObject({
      providerId: 'deepseek',
      status: 'available'
    })
    expect(result.entries[0]?.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'balance', remaining: 12 })
    ]))
  })

  it('does not read inherited object properties as provider local costs', async () => {
    const service = new ProviderQuotaService({
      loadSource: async () => ({
        profiles: [profile({
          id: 'constructor',
          name: 'Constructor provider',
          presetId: undefined,
          baseUrl: 'https://models.example.com/v1'
        })],
        proxyUrl: ''
      }),
      loadLocalCosts: async () => ({})
    })

    await expect(service.list()).resolves.toMatchObject({
      entries: [{
        providerId: 'constructor',
        status: 'unsupported',
        metrics: []
      }]
    })
  })
})
