import { describe, expect, it, vi } from 'vitest'
import { buildRouter } from './index.js'
import type { ServerRuntime } from './server-runtime.js'

async function dispatch(runtime: ServerRuntime, query: string, authorized = true) {
  const router = buildRouter(runtime)
  const request = new Request(`http://127.0.0.1/v1/harnesses/codex/subscription-quota${query}`,
    { headers: authorized ? { authorization: 'Bearer fake-runtime-token' } : {} })
  const match = router.match('GET', new URL(request.url).pathname)!
  const response = await match.handler(request, { params: match.params })
  return response instanceof Response ? { status: response.status, body: await response.text() } : response
}

describe('scoped composer quota route', () => {
  it('requires runtime authorization before reading native or provider accounts', async () => {
    const subscription = vi.fn()
    const response = await dispatch({ runtimeToken: 'fake-runtime-token', insecure: false,
      providerQuotaService: { list: vi.fn(), subscription } } as unknown as ServerRuntime, '', false)
    expect(response.status).toBe(401)
    expect(subscription).not.toHaveBeenCalled()
  })

  it('passes exact public selection fields without invoking any harness process', async () => {
    const subscription = vi.fn(async () => ({ entry: null, refreshedAt: '2026-10-11T00:00:00.000Z' }))
    const response = await dispatch({ runtimeToken: 'fake-runtime-token', insecure: false,
      providerQuotaService: { list: vi.fn(), subscription } } as unknown as ServerRuntime,
    '?credential_mode=provider&provider_id=second-account&account_id=account-2&workspace_root=%2Fworkspace&refresh=1')
    expect(response.status).toBe(200)
    expect(subscription).toHaveBeenCalledWith(expect.objectContaining({ harnessId: 'codex', credentialMode: 'provider',
      providerId: 'second-account', accountId: 'account-2', workspaceRoot: '/workspace', forceRefresh: true }), expect.any(Function))
    expect(response.body).not.toContain('fake-runtime-token')
  })

  it('rejects malformed credential modes before consulting credentials', async () => {
    const subscription = vi.fn()
    const response = await dispatch({ runtimeToken: 'fake-runtime-token', insecure: false,
      providerQuotaService: { list: vi.fn(), subscription } } as unknown as ServerRuntime, '?credential_mode=unsafe')
    expect(response.status).toBe(400)
    expect(subscription).not.toHaveBeenCalled()
  })
})
