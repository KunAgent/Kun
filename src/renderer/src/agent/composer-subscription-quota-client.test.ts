import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestComposerSubscriptionQuota } from './composer-subscription-quota-client'
import { runtimeRequestPayloadSchema } from '../../../main/ipc/app-ipc-schemas/runtime'

const request = vi.hoisted(() => vi.fn())
vi.mock('./runtime-client', () => ({ rendererRuntimeClient: { runtimeRequest: request } }))
const response = { entry: { providerId: 'profile-a', providerName: 'Codex', status: 'available',
  metrics: [{ id: 'primary', label: 'Primary window', unit: 'percent', usedPercent: 65, windowSeconds: 18_000 }] },
  refreshedAt: '2026-10-11T00:00:00Z', scopeKey: 'public-scope' }

describe('composer subscription boundary', () => {
  beforeEach(() => { request.mockReset() })

  it.each(['codex', 'claude-code'])('passes the real desktop IPC boundary for %s quota reads', async (harnessId) => {
    request.mockImplementation(async (path, method, body, options) => {
      runtimeRequestPayloadSchema.parse({ path, method, body, ...options })
      return { ok: true, body: JSON.stringify(response) }
    })
    for (const credentialMode of ['native-login', 'provider']) {
      const result = await requestComposerSubscriptionQuota({ harnessId, credentialMode,
        providerId: credentialMode === 'native-login' ? 'default' : 'work & home',
        ...(credentialMode === 'provider' ? { accountId: 'actual-account' } : {}),
        workspaceRoot: '/repo/a?account_id=other', forceRefresh: true })
      expect(result.entry?.status).toBe('available')
      expect(result.entry?.metrics[0].usedPercent).toBe(65)
    }
  })

  it('preserves exact account and workspace values as data in a background-only read', async () => {
    request.mockResolvedValue({ ok: true, body: JSON.stringify(response) })
    const result = await requestComposerSubscriptionQuota({ harnessId: 'codex', credentialMode: 'provider',
      providerId: 'work & home', accountId: 'actual-account', workspaceRoot: '/repo/a?account_id=other', forceRefresh: true })
    const [path, method, body, options] = request.mock.calls[0]
    const url = new URL(path, 'http://localhost')
    expect(url.pathname).toBe('/v1/harnesses/codex/subscription-quota')
    expect(url.searchParams.getAll('account_id')).toEqual(['actual-account'])
    expect(url.searchParams.get('provider_id')).toBe('work & home')
    expect(url.searchParams.get('workspace_root')).toBe('/repo/a?account_id=other')
    expect(url.searchParams.get('refresh')).toBe('1')
    expect([method, body, options]).toEqual(['GET', undefined, { priority: 'background' }])
    expect(result.entry?.metrics[0].usedPercent).toBe(65)
    expect(result.scopeKey).toBe('public-scope')
  })

  it('accepts unavailable accounts without inventing an allowance', async () => {
    request.mockResolvedValue({ ok: true, body: JSON.stringify({ entry: null, refreshedAt: response.refreshedAt }) })
    expect((await requestComposerSubscriptionQuota({ harnessId: 'claude-code', credentialMode: 'native-login', providerId: 'default' })).entry).toBeNull()
    const url = new URL(request.mock.calls[0][0], 'http://localhost')
    expect(url.searchParams.has('account_id')).toBe(false)
    expect(url.searchParams.has('refresh')).toBe(false)
  })

  it('rejects host errors and malformed quota responses instead of showing misleading numbers', async () => {
    for (const value of [
      { ok: false, body: JSON.stringify(response) },
      { ok: true, body: 'not-json' },
      { ok: true, body: JSON.stringify({ ...response, entry: { status: 'available', metrics: [] } }) }
    ]) {
      request.mockResolvedValue(value)
      await expect(requestComposerSubscriptionQuota({ harnessId: 'codex' })).rejects.toThrow()
    }
  })
})
