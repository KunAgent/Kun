import { describe, expect, it, vi } from 'vitest'
import { ProviderQuotaService } from './provider-quota-service.js'
import type { ProviderQuotaProbeProfile, ProviderQuotaFetch } from './provider-subscription-quota.js'

const claude = (id = 'claude-a', token = 'sk-ant-oat01-fake-a'): ProviderQuotaProbeProfile => ({
  id, name: id, accountId: `${id}-account`, presetId: 'claude-subscription', kind: 'agent-sdk', authType: 'subscription', apiKey: token
})
const codex = (id = 'codex-a', token = 'fake-codex-a'): ProviderQuotaProbeProfile => ({
  id, name: id, accountId: `${id}-account`, presetId: 'codex', kind: 'http', authType: 'oauth',
  baseUrl: 'https://chatgpt.com/backend-api/codex', apiKey: token
})
const native = vi.fn(async () => undefined)
const quotaResponse = (used = 30) => Response.json({ plan_type: 'plus',
  rate_limit: { primary_window: { used_percent: used, limit_window_seconds: 18_000, reset_at: 1_900_000_000 } },
  five_hour: { utilization: used, resets_at: '2030-03-17T17:46:40.000Z' } })

describe('composer scoped subscription quota', () => {
  it('uses an exact named provider/account instead of the first matching preset', async () => {
    const fetcher = vi.fn<ProviderQuotaFetch>(async () => quotaResponse())
    const service = new ProviderQuotaService({ loadSource: async () => ({ profiles: [codex('codex-a'), codex('codex-b', 'fake-b')] }), fetcher })
    const result = await service.subscription({ harnessId: 'kun', providerId: 'codex-b', accountId: 'codex-b-account' }, native)
    expect(result.entry).toMatchObject({ providerId: 'codex-b', status: 'available', metrics: [{ usedPercent: 30, windowSeconds: 18_000 }] })
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer fake-b')
    expect((await service.subscription({ harnessId: 'kun', providerId: 'codex-b', accountId: 'codex-a-account' }, native)).entry).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toContain('fake-b')
    expect(result.scopeKey).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('uses the inherited Claude SDK default credential only when default is that SDK route', async () => {
    let profiles = [claude('work'), codex()]
    const ambient = vi.fn(async () => claude('native:claude-code', 'sk-ant-oat01-system'))
    const service = new ProviderQuotaService({ loadSource: async () => ({ profiles, defaultProviderId: 'work' }), fetcher: async () => quotaResponse() })
    expect((await service.subscription({ harnessId: 'claude-code', credentialMode: 'native-login', providerId: 'default' }, ambient)).entry?.providerId).toBe('work')
    expect(ambient).not.toHaveBeenCalled()
    profiles = [codex('work')]
    expect((await service.subscription({ harnessId: 'claude-code', credentialMode: 'native-login', providerId: 'default' }, ambient)).entry?.providerId).toBe('native:claude-code')
    expect(ambient).toHaveBeenCalled()
  })

  it('never falls back to ambient when a named Claude profile has a missing protected credential', async () => {
    const ambient = vi.fn(async () => claude('native:claude-code'))
    const service = new ProviderQuotaService({ loadSource: async () => ({ profiles: [claude('first'), { ...claude('selected', ''), credentialSourceId: 'protected:selected' }] }), fetcher: async () => quotaResponse() })
    const result = await service.subscription({ harnessId: 'claude-code', credentialMode: 'native-login', providerId: 'selected' }, ambient)
    expect(result.entry).toMatchObject({ providerId: 'selected', status: 'missing_credentials', metrics: [] })
    expect(ambient).not.toHaveBeenCalled()
    expect((await service.subscription({ harnessId: 'codex', credentialMode: 'native-login', providerId: 'selected' }, ambient)).entry).toBeNull()
  })

  it('follows an unbound named Claude SDK route to the same native login used for its turn', async () => {
    const ambient = vi.fn(async () => claude('native:claude-code', 'sk-ant-oat01-system'))
    const fetcher = vi.fn<ProviderQuotaFetch>(async () => quotaResponse())
    const selected = { ...claude('claude-subscription', ''), configured: true }
    const service = new ProviderQuotaService({ loadSource: async () => ({ profiles: [selected] }), fetcher })
    const result = await service.subscription({ harnessId: 'claude-code', credentialMode: 'native-login', providerId: selected.id }, ambient)
    expect(result.entry).toMatchObject({ providerId: selected.id, status: 'available', metrics: [{ usedPercent: 30 }] })
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer sk-ant-oat01-system')
    expect(ambient).toHaveBeenCalledTimes(2)
    expect((await service.subscription({ harnessId: 'claude-code', credentialMode: 'native-login', providerId: selected.id, accountId: 'other' }, ambient)).entry).toBeNull()
  })

  it.each([
    { ...codex(), authType: 'api-key' as const, apiKey: 'sk-fake-api' },
    { ...codex(), baseUrl: 'https://relay.example.test/v1' },
    { ...codex(), presetId: 'openai', baseUrl: 'https://api.openai.com' },
    { ...claude(), kind: 'http' as const, apiKey: 'sk-ant-api-fake' },
    { ...claude(), baseUrl: 'https://bedrock.example.test' },
    { ...claude(), apiKey: 'sk-ant-api-fake' }
  ])('never presents API/custom endpoint balance as a subscription ($id/$baseUrl)', async (profile) => {
    const fetcher = vi.fn<ProviderQuotaFetch>(async () => quotaResponse())
    const service = new ProviderQuotaService({ loadSource: async () => ({ profiles: [profile] }), fetcher })
    expect((await service.subscription({ harnessId: 'kun', providerId: profile.id }, native)).entry).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not guess alias, unrelated engine, missing provider or extension account routes', async () => {
    const fetcher = vi.fn<ProviderQuotaFetch>(async () => quotaResponse())
    const service = new ProviderQuotaService({ loadSource: async () => ({ profiles: [codex()] }), fetcher })
    for (const query of [
      { harnessId: 'kun', gatewayBinding: true, providerId: 'codex-a' },
      { harnessId: 'other', providerId: 'codex-a' },
      { harnessId: 'kun', providerId: 'absent' },
      { harnessId: 'codex', credentialMode: 'native-login' as const, accountId: 'extension-account' }
    ]) expect((await service.subscription(query, native)).entry).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keys native cache by resolved credential identity and resolves again on every read', async () => {
    let token = 'fake-first'
    const ambient = vi.fn(async () => codex('native:codex', token))
    const fetcher = vi.fn<ProviderQuotaFetch>(async (_url, init) => quotaResponse(new Headers(init?.headers).get('Authorization')?.includes('second') ? 65 : 15))
    const service = new ProviderQuotaService({ loadSource: async () => ({ profiles: [] }), fetcher })
    const query = { harnessId: 'codex', credentialMode: 'native-login' as const }
    const first = await service.subscription(query, ambient)
    await service.subscription(query, ambient)
    expect(fetcher).toHaveBeenCalledTimes(1)
    token = 'fake-second'
    const second = await service.subscription(query, ambient)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(second.scopeKey).not.toBe(first.scopeKey)
    expect(second.entry?.metrics[0].usedPercent).toBe(65)
  })

  it('pins a stored Codex credential to its selected account without a refresh-token fallback', async () => {
    const token = JSON.stringify({ kind: 'codex-oauth', accessToken: 'fake-selected-access', refreshToken: 'fake-shared-refresh',
      accountId: 'selected-vendor-account', expiresAt: 1 })
    const fetcher = vi.fn<ProviderQuotaFetch>(async () => quotaResponse())
    const service = new ProviderQuotaService({ loadSource: async () => ({ profiles: [codex('codex-a', token)] }), fetcher })
    const result = await service.subscription({ harnessId: 'kun', providerId: 'codex-a' }, native)
    expect(result.entry?.status).toBe('available')
    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers)
    expect(headers.get('Authorization')).toBe('Bearer fake-selected-access')
    expect(headers.get('chatgpt-account-id')).toBe('selected-vendor-account')
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('auth.openai.com'))).toBe(false)
  })

  it('rechecks credentials after a slow response so the previous account cannot leak into the new selection', async () => {
    let token = 'fake-old'
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const fetcher = vi.fn<ProviderQuotaFetch>(async (_url, init) => new Headers(init?.headers).get('Authorization')?.includes('old') ? pending : quotaResponse(77))
    const service = new ProviderQuotaService({ loadSource: async () => ({ profiles: [] }), fetcher })
    const result = service.subscription({ harnessId: 'codex', credentialMode: 'native-login' }, async () => codex('native:codex', token))
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    token = 'fake-new'; release(quotaResponse(11))
    expect((await result).entry?.metrics[0].usedPercent).toBe(77)
  })

  it('preserves the vendor snapshot timestamp when a failed manual refresh retains cached data', async () => {
    let now = '2026-10-11T00:00:00.000Z'
    const fetcher = vi.fn<ProviderQuotaFetch>(async () => quotaResponse()).mockImplementationOnce(async () => quotaResponse())
    const service = new ProviderQuotaService({ loadSource: async () => ({ profiles: [codex()] }), fetcher, nowIso: () => now })
    const first = await service.subscription({ harnessId: 'kun', providerId: 'codex-a' }, native)
    now = '2026-10-11T00:10:00.000Z'
    fetcher.mockImplementation(async () => { throw new Error('network unavailable') })
    const stale = await service.subscription({ harnessId: 'kun', providerId: 'codex-a', forceRefresh: true }, native)
    expect(stale.entry?.updatedAt).toBe(first.entry?.updatedAt)
    expect(stale.refreshedAt).toBe(first.refreshedAt)
  })
})
