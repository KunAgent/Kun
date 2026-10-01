import { describe, expect, it, vi } from 'vitest'
import type { GoogleWorkspaceStatus } from '../shared/google-workspace'
import { createGoogleWorkspaceController, isGoogleWorkspaceAuthorizationUrl } from './google-workspace-controller'

const status = (state: 'running' | 'cancelled' | 'succeeded' = 'running'): GoogleWorkspaceStatus => ({
  experimental: true,
  binary: { available: true, version: '0.22.5' },
  auth: { state: 'disconnected', scopes: [] },
  operation: { id: 'login-1', kind: 'login', state },
  services: { gmail: { state: 'unknown' }, calendar: { state: 'unknown' }, drive: { state: 'unknown' } }
})
const response = (body: unknown) => ({ ok: true, status: 200, body: JSON.stringify(body) })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
const auth = { authorizationUrl: 'https://accounts.google.com/o/oauth2/auth?state=secret', operationId: 'login-1' }

describe('Google Workspace trusted host controller', () => {
  it.each([
    'https://accounts.google.com/o/oauth2/auth?state=x',
    'https://accounts.google.com/o/oauth2/v2/auth?state=x'
  ])('permits the Google OAuth endpoint %s', (url) => {
    expect(isGoogleWorkspaceAuthorizationUrl(url)).toBe(true)
  })
  it.each([
    'http://accounts.google.com/o/oauth2/auth',
    'https://accounts.google.com.evil.test/o/oauth2/auth',
    'https://accounts.google.com@evil.test/o/oauth2/auth',
    'https://user:pass@accounts.google.com/o/oauth2/auth',
    'https://accounts.google.com:444/o/oauth2/auth',
    'https://accounts.google.com/o/oauth2/auth/evil',
    'https://accounts.google.com/o/oauth2/auth#secret',
    'file:///tmp/oauth', 'javascript:alert(1)'
  ])('rejects an untrusted URL %s', (url) => {
    expect(isGoogleWorkspaceAuthorizationUrl(url)).toBe(false)
  })
  it('uses host headers, strips extra fields, and opens the current OAuth URL once', async () => {
    const request = vi.fn(async (path: string) => response(path.endsWith('/authorization-url') ? auth : {
      ...status(), authorizationUrl: auth.authorizationUrl, token: 'sensitive',
      auth: { ...status().auth, clientId: 'sensitive' }
    }))
    const openExternal = vi.fn(async () => undefined)
    const host = createGoogleWorkspaceController({ request, openExternal })
    expect(await host.status()).toEqual(status())
    expect(await host.openAuthorization()).toEqual({ opened: false })
    await host.start('login')
    await Promise.all([host.openAuthorization(), host.openAuthorization()])
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(auth.authorizationUrl)
    expect(request).toHaveBeenCalledWith('/v1/integrations/google-workspace/login', 'POST', undefined, { 'X-Kun-Google-Workspace-UI': '1' })
  })
  it('cancels after a pending start and never opens the late authorization URL', async () => {
    const start = deferred<ReturnType<typeof response>>()
    const request = vi.fn(async (path: string) => path.endsWith('/login') ? start.promise : response(status('cancelled')))
    const openExternal = vi.fn(async () => undefined)
    const host = createGoogleWorkspaceController({ request, openExternal })
    const login = host.start('login')
    await expect(host.start('login')).rejects.toThrow('already running')
    const cancellation = host.cancel()
    expect(request).toHaveBeenCalledTimes(1)
    start.resolve(response(status()))
    await login
    await cancellation
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/v1/integrations/google-workspace/login', '/v1/integrations/google-workspace/cancel'
    ])
    expect(await host.openAuthorization()).toEqual({ opened: false })
    expect(openExternal).not.toHaveBeenCalled()
  })
  it('does not open when cancel arrives during authorization fetch', async () => {
    const authorization = deferred<ReturnType<typeof response>>()
    const request = vi.fn(async (path: string) => path.endsWith('/authorization-url') ? authorization.promise : response(status()))
    const openExternal = vi.fn(async () => undefined)
    const host = createGoogleWorkspaceController({ request, openExternal })
    await host.start('login')
    const opening = host.openAuthorization()
    await host.cancel()
    authorization.resolve(response(auth))
    expect(await opening).toEqual({ opened: false })
    expect(openExternal).not.toHaveBeenCalled()
  })
  it.each([
    { id: 'another-login', state: 'running' },
    { id: 'login-1', state: 'cancelled' },
    { id: 'login-1', state: 'succeeded' }
  ])('rechecks the active operation before opening (%j)', async (operation) => {
    const request = vi.fn(async (path: string) => response(path.endsWith('/authorization-url') ? auth
      : path.endsWith('/status') ? { ...status(), operation: { ...status().operation, ...operation } } : status()))
    const openExternal = vi.fn(async () => undefined)
    const host = createGoogleWorkspaceController({ request, openExternal })
    await host.start('login')
    expect(await host.openAuthorization()).toEqual({ opened: false })
    expect(openExternal).not.toHaveBeenCalled()
  })
  it('keeps browser-open failures actionable until cancellation, without reopening repeatedly', async () => {
    const request = vi.fn(async (path: string) => response(path.endsWith('/authorization-url') ? auth : status()))
    const openExternal = vi.fn(async () => { throw new Error('private operating system output') })
    const host = createGoogleWorkspaceController({ request, openExternal })
    await host.start('login')
    await expect(host.openAuthorization()).rejects.toThrow('Cancel and try connecting again')
    await expect(host.openAuthorization()).rejects.toThrow('Cancel and try connecting again')
    expect(openExternal).toHaveBeenCalledTimes(1)
    await host.cancel()
    expect(await host.openAuthorization()).toEqual({ opened: false })
  })
  it('does not pass response output or malformed status details across IPC', async () => {
    const request = vi.fn(async () => ({ ok: false, status: 400, body: 'access_token=secret' }))
    const host = createGoogleWorkspaceController({ request, openExternal: vi.fn() })
    await expect(host.start('login')).rejects.toThrow('Google Workspace request failed (HTTP 400).')
    request.mockResolvedValueOnce(response({ access_token: 'secret' }))
    await expect(host.status()).rejects.toThrow('Kun returned invalid Google Workspace status.')
  })
})
