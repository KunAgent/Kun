import type { ProviderQuotaListResponse } from '../contracts/provider-quota.js'
import { describe, expect, it, vi } from 'vitest'
import { ProviderQuotaService, classifyProviderQuotaProbe } from './provider-quota-service-core.js'
import type { ProviderQuotaProbeProfile, ProviderQuotaFetch } from './provider-subscription-quota-service.js'
import { scopedQuotaFetch } from './provider-quota-security.js'
import { createProviderQuotaRoutingLookup } from './provider-quota-routing-cache.js'
const profile = (): ProviderQuotaProbeProfile => ({ id: 'supplier', name: 'Supplier', kind: 'http', baseUrl: 'https://api.deepseek.com', apiKey: 'first-key', configured: true })
const balance = () => Response.json({ is_available: true, balance_infos: [{ currency: 'USD', total_balance: '10', granted_balance: '0', topped_up_balance: '10' }] })
describe('quota credential and account ownership', () => {
  it('does not send inference-only credentials or resolve unconfigured native login sources', async () => {
    const fetcher = vi.fn<ProviderQuotaFetch>(async () => balance()), resolveCodexCredential = vi.fn()
    const source = { ...profile(), authProfile: { mode: 'adapter' as const, prefix: 'Bearer ' as const,
      scope: { hosts: ['api.deepseek.com'], purposes: ['inference' as const] } } }
    const service = new ProviderQuotaService({ loadSource: async () => ({ profiles: [source,
      { ...profile(), id: 'codex', presetId: 'codex', baseUrl: 'https://chatgpt.com/backend-api/codex/responses', configured: false, apiKey: '' }] }),
      fetcher, subscriptionRuntime: { resolveCodexCredential } })
    const result = await service.list()
    expect(result.entries.map((entry) => entry.status)).toEqual(['unsupported', 'missing_credentials'])
    expect(fetcher).not.toHaveBeenCalled(); expect(resolveCodexCredential).not.toHaveBeenCalled()
  })
  it('does not classify edited subscription relay endpoints as first-party quota adapters', () => {
    for (const presetId of ['codex', 'grok-subscription']) expect(classifyProviderQuotaProbe({ ...profile(), presetId, baseUrl: 'https://relay.test/v1' })).toBeNull()
    expect(classifyProviderQuotaProbe({ ...profile(), presetId: 'codex', baseUrl: 'https://chatgpt.com.attacker.test/v1' })).toBeNull()
  })
  it('intersects explicit host/purpose grants with the fixed adapter host list', async () => {
    const fetcher = vi.fn<ProviderQuotaFetch>(async () => balance())
    const provider = { ...profile(), authProfile: { mode: 'adapter' as const, prefix: 'Bearer ' as const,
      scope: { hosts: ['api.deepseek.com', 'evil.test'], purposes: ['quota' as const] } } }
    const protectedFetch = scopedQuotaFetch(fetcher, provider, 'deepseek')
    await protectedFetch('https://api.deepseek.com/user/balance', { headers: { Authorization: 'Bearer key' } }, '')
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe('error')
    await expect(protectedFetch('https://evil.test/usage', { headers: { Authorization: 'Bearer key' } }, '')).rejects.toThrow('adapter credential scope')
    await expect(protectedFetch('https://api.deepseek.com/usage', { method: 'POST', body: 'refresh_token=secret' }, '')).rejects.toThrow('not approved')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('invalidates an account catalog cache when its key or authorization profile changes', async () => {
    let current = profile(), requests = 0
    const service = new ProviderQuotaService({ loadSource: async () => ({ profiles: [current] }), fetcher: async () => { requests++; return balance() } })
    await service.list(); await service.list(); expect(requests).toBe(1)
    current = { ...current, apiKey: 'replacement-key' }; await service.list(); expect(requests).toBe(2)
    current = { ...current, authProfile: { mode: 'adapter', prefix: 'Bearer ', scope: { hosts: ['api.deepseek.com'], purposes: ['inference'] } } }
    expect((await service.list()).entries[0].status).toBe('unsupported'); expect(requests).toBe(2)
  })
  it('does not use an old in-flight quota snapshot for a newly configured account', async () => {
    let generation = 1, complete: ((value: ProviderQuotaListResponse) => void) | undefined
    const list = vi.fn<Pick<ProviderQuotaService, 'list'>['list']>(() => new Promise<ProviderQuotaListResponse>((resolve) => { complete = resolve }))
    const lookup = createProviderQuotaRoutingLookup({ service: { list }, providerIds: () => ['supplier'], generation: () => generation })
    generation++; complete!({ refreshedAt: new Date().toISOString(), entries: [{ providerId: 'supplier', providerName: 'Supplier', status: 'available', metrics: [] }] })
    await lookup.refresh(); expect(lookup.get('supplier')).toBeUndefined()
    complete!({ refreshedAt: new Date().toISOString(), entries: [{ providerId: 'supplier', providerName: 'Supplier', status: 'available', metrics: [] }] }); await lookup.refresh()
    expect(lookup.get('supplier')?.status).toBe('available'); lookup.stop()
  })
})
