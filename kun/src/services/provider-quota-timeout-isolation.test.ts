import { describe, expect, it, vi } from 'vitest'
import { ProviderQuotaService } from './provider-quota-service.js'
import type { ProviderQuotaProbeProfile } from './provider-subscription-quota.js'

function profile(overrides: Partial<ProviderQuotaProbeProfile> = {}): ProviderQuotaProbeProfile {
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

describe('ProviderQuotaService timeout isolation', () => {
  it('keeps successful quota entries when another provider times out', async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url === 'https://api.deepseek.com/user/balance') {
        return Response.json({
          is_available: true,
          balance_infos: [{
            currency: 'CNY',
            total_balance: '12.50',
            granted_balance: '0',
            topped_up_balance: '12.50'
          }]
        })
      }
      throw new Error('The operation was aborted due to timeout')
    })
    const service = new ProviderQuotaService({
      loadSource: async () => ({
        profiles: [
          profile(),
          profile({
            id: 'moonshot',
            name: 'Moonshot',
            presetId: 'moonshot',
            baseUrl: 'https://api.moonshot.cn'
          })
        ],
        proxyUrl: ''
      }),
      fetcher,
      nowIso: () => '2026-08-21T10:00:00.000Z'
    })

    await expect(service.list()).resolves.toMatchObject({
      entries: [
        { providerId: 'deepseek', status: 'available' },
        {
          providerId: 'moonshot',
          status: 'error',
          message: 'The quota request timed out.'
        }
      ]
    })
  })
})
