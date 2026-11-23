import { describe, expect, it, vi } from 'vitest'
import { readMobileQuotas, readMobileUsage, usageRange } from './usage-read'
import { usageResponse } from './usage-fixture'
import type { ProtectedRuntimeRequestLease } from '../ipc/app-ipc-handler-options'

function lease(body: (path: string) => unknown) {
  const request = vi.fn(async (path: string) => ({ ok: true, status: 200, body: JSON.stringify(body(path)) }))
  return { request, runtimeToken: 'private-runtime-token' } as ProtectedRuntimeRequestLease & { request: typeof request }
}
describe('mobile usage projections', () => {
  it('reads the same local runtime endpoints and retains cost, reference value and cache semantics', async () => {
    const source = lease(usageResponse)
    const value = await readMobileUsage(source, { days: 7, modelScope: 'primary' }, new Date('2026-11-12T08:00:00Z'))
    expect(source.request.mock.calls).toHaveLength(2)
    expect(source.request.mock.calls.every(([path]) => path.startsWith('/v1/usage?'))).toBe(true)
    expect(value.totals).toMatchObject({ totalTokens: 12000, costUsd: .03, referenceUsd: .25, referenceCoverage: 'partial', cacheHitRate: .9, unpricedRequests: 1 })
    expect(value.modelScope).toBe('primary')
    expect(value.models[0].model).toBe('fixture-model')
    expect(JSON.stringify(value)).not.toContain('private-runtime-token')
  })
  it('uses calendar dates across timezone and daylight-saving boundaries', () => {
    expect(usageRange(7, new Date('2026-03-09T02:00:00Z'), 'America/New_York')).toEqual({ from: '2026-03-02', to: '2026-03-08', timezone: 'America/New_York' })
    expect(usageRange(1, new Date('2026-11-11T23:00:00Z'), 'Asia/Shanghai').to).toBe('2026-11-12')
  })
  it('fails on missing or mismatched accounting instead of publishing fabricated zeros', async () => {
    await expect(readMobileUsage(lease(() => ({})), { days: 7, modelScope: 'all' })).rejects.toThrow('INVALID_USAGE_RESPONSE')
    await expect(readMobileUsage(lease(path => ({ ...usageResponse(path), timezone: 'Wrong/Zone' })), { days: 7, modelScope: 'all' })).rejects.toThrow('INVALID_USAGE_RESPONSE')
    const source = lease(usageResponse)
    await expect(readMobileUsage(source, { days: 366, modelScope: 'all' })).rejects.toThrow('INVALID_PARAMS')
    expect(source.request).not.toHaveBeenCalled()
  })
  it('strips raw quota errors and dashboard links while retaining genuine zero and unknown states', async () => {
    const source = lease(() => ({ refreshedAt: '2026-11-12T00:00:00Z', entries: [
      { providerId: 'api', providerName: 'API', status: 'available', metrics: [{ id: 'balance', label: 'Balance', unit: 'USD', remaining: 0 }],
        message: 'private-token', dashboardUrl: 'https://example.test?token=private-token', source: 'private-source', summary: 'private-summary' },
      { providerId: 'unknown', providerName: 'Unknown', status: 'unsupported', metrics: [] }
    ] }))
    const value = await readMobileQuotas(source)
    expect(value.entries[0].metrics[0].remaining).toBe(0)
    expect(value.entries[1]).toMatchObject({ status: 'unsupported', metrics: [] })
    expect(JSON.stringify(value)).not.toContain('private-')
    expect(source.request).toHaveBeenCalledWith('/v1/provider-quotas', 'GET')
  })
})
