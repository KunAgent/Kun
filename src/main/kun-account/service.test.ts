import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { KunAccountService, type AccountDependencies } from './service'
import type { AccountTokens } from './transport'
import { AccountError } from './errors'

const tokens = { accessToken: 'secret-access', refreshToken: 'secret-refresh', expiresAt: 4_000_000 }
const user = { id: 'user-one', email: 'person@example.test', name: 'Person', avatarUrl: null }
const services: KunAccountService[] = []
afterEach(() => { services.splice(0).forEach((service) => service.dispose()) })

function fixture(saved: AccountTokens | null = null) {
  let stored = saved
  let receive!: (value: string) => void
  const callback = new Promise<string>((resolve) => { receive = resolve })
  const deps: AccountDependencies = {
    clientId: 'public-desktop-client', now: () => 1_000_000,
    storage: { assertAvailable: vi.fn(async () => {}), read: vi.fn(async () => stored),
      write: vi.fn(async (next: AccountTokens) => { stored = next }), clear: vi.fn(async () => { stored = null }) },
    transport: { exchange: vi.fn(async () => tokens), user: vi.fn(async () => user), logout: vi.fn(async () => {}) },
    listen: vi.fn(async () => ({ code: callback, close: vi.fn(), port: 43187 })),
    openBrowser: vi.fn(async () => {}), changed: vi.fn(), focus: vi.fn()
  }
  const service = new KunAccountService(deps)
  services.push(service)
  return { service, deps, receive, stored: () => stored }
}
const tick = async () => { await new Promise((resolve) => setImmediate(resolve)) }

describe('Kun account desktop service', () => {
  it('opens an independent PKCE login, persists tokens and exposes only redacted identity', async () => {
    const f = fixture()
    await f.service.login()
    const url = new URL(vi.mocked(f.deps.openBrowser).mock.calls[0][0])
    expect(url.origin).toBe('https://api-kun-server.com')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:43187/auth/callback')
    expect(url.searchParams.get('scope')).toBe('openid email profile')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.has('client_secret')).toBe(false)
    expect(f.service.snapshot().status).toBe('authorizing')
    await f.service.login()
    expect(f.deps.openBrowser).toHaveBeenCalledOnce()
    f.receive('one-use-code'); await tick()
    const fields = vi.mocked(f.deps.transport.exchange).mock.calls[0][0]
    expect(createHash('sha256').update(fields.code_verifier).digest('base64url')).toBe(url.searchParams.get('code_challenge'))
    expect(f.stored()).toEqual(tokens)
    expect(f.service.snapshot()).toEqual({ status: 'authenticated', user, error: null })
    expect(JSON.stringify(vi.mocked(f.deps.changed).mock.calls)).not.toMatch(/secret-access|secret-refresh|one-use-code|code_verifier/)
    expect(f.deps.focus).toHaveBeenCalledOnce()
  })

  it('reopens the same pending sign-in page without starting another request', async () => {
    const f = fixture()
    await f.service.reopenLogin()
    expect(f.deps.openBrowser).not.toHaveBeenCalled()
    await f.service.login()
    const first = vi.mocked(f.deps.openBrowser).mock.calls[0][0]
    vi.mocked(f.deps.openBrowser).mockRejectedValueOnce(new Error('no browser'))
    await expect(f.service.reopenLogin()).resolves.toMatchObject({ status: 'authorizing' })
    await f.service.reopenLogin()
    expect(vi.mocked(f.deps.openBrowser).mock.calls.map(([url]) => url)).toEqual([first, first, first])
    expect(f.deps.listen).toHaveBeenCalledOnce()
    await f.service.cancelLogin()
    await f.service.reopenLogin()
    expect(f.deps.openBrowser).toHaveBeenCalledTimes(3)
  })

  it('cancellation prevents a late callback from exchanging a code', async () => {
    const f = fixture()
    await f.service.login(); await f.service.cancelLogin()
    f.receive('late'); await tick()
    expect(f.deps.transport.exchange).not.toHaveBeenCalled()
    expect(f.service.snapshot().status).toBe('anonymous')
  })

  it('does not open the browser when secure storage or callback binding fails', async () => {
    for (const target of ['storage', 'listener'] as const) {
      const f = fixture()
      if (target === 'storage') vi.mocked(f.deps.storage.assertAvailable).mockRejectedValue(new AccountError('secure_storage'))
      else vi.mocked(f.deps.listen).mockRejectedValue(new AccountError('port_busy'))
      await f.service.login()
      expect(f.deps.openBrowser).not.toHaveBeenCalled()
      expect(f.service.snapshot().error).toBe(target === 'storage' ? 'secure_storage' : 'port_busy')
    }
  })

  it('restores encrypted session and rotates once for concurrent refreshes', async () => {
    const f = fixture(tokens)
    await f.service.getState()
    expect(f.service.snapshot().user).toEqual(user)
    await Promise.all([f.service.refresh(), f.service.refresh()])
    expect(f.deps.transport.exchange).toHaveBeenCalledTimes(1)
    expect(f.deps.transport.exchange).toHaveBeenCalledWith({ grant_type: 'refresh_token', refresh_token: 'secret-refresh' }, 'secret-refresh')
  })

  it('preserves a recoverable session on outages and clears rejected refresh tokens', async () => {
    const f = fixture(tokens)
    await f.service.getState()
    vi.mocked(f.deps.transport.exchange).mockRejectedValueOnce(new AccountError('network'))
    await f.service.refresh()
    expect(f.stored()).toEqual(tokens)
    expect(f.service.snapshot().user).toEqual(user)
    vi.mocked(f.deps.transport.exchange).mockRejectedValueOnce(new AccountError('expired'))
    await f.service.refresh()
    expect(f.stored()).toBeNull()
    expect(f.service.snapshot()).toEqual({ status: 'anonymous', user: null, error: 'expired' })
  })

  it('logout revokes only this app session and does not resurrect after late browser exchange', async () => {
    const f = fixture(tokens)
    await f.service.getState(); await f.service.logout()
    expect(f.deps.transport.logout).toHaveBeenCalledWith('secret-access')
    expect(f.stored()).toBeNull()
    expect(f.service.snapshot().user).toBeNull()
  })

  it('serializes disk cleanup when a login save is cancelled during encryption', async () => {
    const f = fixture()
    let release!: () => void
    vi.mocked(f.deps.storage.write).mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve }))
    await f.service.login(); f.receive('code'); await tick()
    const cancel = f.service.cancelLogin()
    release(); await cancel; await tick()
    expect(f.deps.storage.clear).toHaveBeenCalled()
    expect(f.service.snapshot().user).toBeNull()
  })

  it('keeps a rotated token in main memory if encrypted persistence must be retried', async () => {
    const f = fixture(tokens)
    await f.service.getState()
    vi.mocked(f.deps.transport.exchange).mockResolvedValue({ ...tokens, refreshToken: 'rotated-refresh' })
    vi.mocked(f.deps.storage.write).mockRejectedValueOnce(new AccountError('secure_storage'))
    await f.service.refresh()
    expect(f.service.snapshot().error).toBe('secure_storage')
    await f.service.refresh()
    expect(f.deps.transport.exchange).toHaveBeenLastCalledWith({ grant_type: 'refresh_token', refresh_token: 'rotated-refresh' }, 'rotated-refresh')
    expect(f.service.snapshot().status).toBe('authenticated')
  })
})
