import { describe, expect, it, vi } from 'vitest'
import { buildRouter } from './index.js'
import type { ServerRuntime } from './server-runtime.js'
import type { GoogleWorkspaceService } from '../../google-workspace/service.js'
const base = '/v1/integrations/google-workspace'
function fixture(insecure = false) {
  const service = { status: vi.fn(async () => ({ safe: true })), authorizationUrl: vi.fn(() => ({ authorizationUrl: 'https://accounts.google.com/o/oauth2/auth?state=private', operationId: 'id' })),
    login: vi.fn(() => ({ running: true })), setup: vi.fn(async () => ({ setup: true })), test: vi.fn(() => ({ running: true })), logout: vi.fn(() => ({ running: true })), cancel: vi.fn(async () => ({ cancelled: true })) }
  const router = buildRouter({ runtimeToken: 'test-token', insecure, googleWorkspace: service as unknown as GoogleWorkspaceService } as ServerRuntime)
  const dispatch = async (action: string, options: { token?: boolean; ui?: boolean; body?: string; query?: string } = {}) => {
    const method = ['status', 'authorization-url'].includes(action) ? 'GET' : 'POST'
    const match = router.match(method, `${base}/${action}`)
    if (!match) throw new Error('missing route')
    const response = await match.handler(new Request(`http://localhost${base}/${action}${options.query ?? ''}`, { method,
      headers: { ...(options.token ? { authorization: 'Bearer test-token' } : {}), ...(options.ui ? { 'x-kun-google-workspace-ui': '1' } : {}) },
      ...(options.body ? { body: options.body } : {}) }), { params: match.params })
    return response instanceof Response ? { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() } : response
  }
  return { service, router, dispatch }
}
describe('Google Workspace runtime route registration', () => {
  it('requires real runtime auth and UI marker on every route even in insecure mode', async () => {
    const f = fixture(true)
    for (const operation of ['status', 'authorization-url', 'login', 'setup', 'test', 'logout', 'cancel']) {
      expect((await f.dispatch(operation, { ui: true })).status).toBe(401)
      expect((await f.dispatch(operation, { token: true })).status).toBe(403)
      expect((await f.dispatch(operation, { token: true, ui: true })).status).toBe(['login', 'test', 'logout'].includes(operation) ? 202 : 200)
    }
  })
  it('never accepts raw flags, scopes, binary paths, credentials or method bodies', async () => {
    const f = fixture()
    expect((await f.dispatch('login', { token: true, ui: true, body: JSON.stringify({ scopes: 'drive', env: { token: 'private' } }) })).status).toBe(400)
    expect((await f.dispatch('authorization-url', { token: true, ui: true, query: '?token=private' })).status).toBe(400)
    expect(f.service.login).not.toHaveBeenCalled()
    expect(f.router.match('POST', `${base}/call`)).toBeUndefined()
    expect(f.router.match('POST', `${base}/export`)).toBeUndefined()
  })
  it('isolates OAuth URL retrieval and uses no-store on all successful account-control responses', async () => {
    const f = fixture()
    const status = await f.dispatch('status', { token: true, ui: true })
    expect(status.body).not.toContain('authorizationUrl')
    const url = await f.dispatch('authorization-url', { token: true, ui: true })
    expect(url.headers['cache-control']).toBe('no-store')
    expect(JSON.parse(url.body)).toHaveProperty('operationId', 'id')
  })
})
