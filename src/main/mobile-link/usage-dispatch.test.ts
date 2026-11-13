import { expect, it, vi } from 'vitest'
import { RequestBudget, type Frame } from '@kun/remote-protocol'
import { dispatchMobileInvoke } from './invoke-dispatch'
import { usageResponse } from './usage-fixture'

function fixture() {
  let current = true
  const sent: Frame[] = [], request = vi.fn(async (path: string) => ({ ok: true, status: 200,
    body: JSON.stringify(path === '/v1/remote/invoke' ? { capabilities: [], capabilityDescriptors: [] } : usageResponse(path)) }))
  const deps = { link: { lease: async () => ({ request }) }, owner: 'owner', filePeers: new Set(),
    requestBudget: new RequestBudget(), totalRequestBudget: new RequestBudget(), subscriptions: {},
    authorizationRemaining: () => 60000, terminalAuthorizationRemaining: () => 60000,
    send: (frame: Frame) => sent.push(frame) } as unknown as Parameters<typeof dispatchMobileInvoke>[4]
  const invoke = (method: string, params: object, purpose?: 'desktop') => dispatchMobileInvoke({ kind: 'invoke', id: 'read',
    payload: { method, params, requestId: 'read', expiresAt: Date.now() + 60000 } }, 'phone',
  { id: 'grant', syncKey: 'grant', scopes: ['personal'], ...(purpose ? { purpose } : {}) }, () => current, deps)
  return { sent, request, invoke, revoke: () => { current = false } }
}
it('advertises read-only usage and dispatches through the existing authorized lease', async () => {
  const f = fixture()
  await f.invoke('catalog.get', {})
  expect(f.sent[0].payload.capabilityDescriptors).toContainEqual(expect.objectContaining({ operation: 'usage.summary.get', allowedActions: ['read'] }))
  f.sent.length = 0; f.request.mockClear()
  await f.invoke('usage.summary.get', { days: 7, modelScope: 'all' })
  expect(f.sent[0].payload.totals.totalTokens).toBe(12000)
  expect(f.request.mock.calls.every(([path]) => path.startsWith('/v1/usage?'))).toBe(true)
})
it('desktop-only authorizations cannot query personal usage and expired authority cannot publish a late answer', async () => {
  const restricted = fixture()
  await restricted.invoke('usage.summary.get', { days: 7, modelScope: 'all' }, 'desktop')
  expect(restricted.request).not.toHaveBeenCalled()
  expect(restricted.sent[0].payload.error.code).toBe('REMOTE_SCOPE_REQUIRED')
  const f = fixture()
  f.request.mockImplementation(async path => { f.revoke(); return { ok: true, status: 200, body: JSON.stringify(usageResponse(path)) } })
  await f.invoke('usage.summary.get', { days: 7, modelScope: 'all' })
  expect(f.sent).toHaveLength(0)
})
