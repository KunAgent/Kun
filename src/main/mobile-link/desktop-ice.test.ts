import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DesktopIceClient, DESKTOP_ICE_TIMEOUT_MS } from './desktop-ice'

function fixture() {
  let live = true
  const authority = { accountId: 'owner', deviceId: 'phone', authorizationId: 'grant', scopes: ['desktop.view'], current: () => live, emit: vi.fn() }
  const body = () => ({ schemaVersion: 1, expiresAt: Date.now() + 600000, iceServers: [{ urls: ['turns:relay.example:443'], username: 'opaque', credential: 'sensitive-test-credential' }] })
  const fetch = vi.fn(async () => new Response(JSON.stringify(body()), { status: 200 }))
  const diagnostic = vi.fn()
  const deps = { origin: 'https://example.com', account: { getState: async () => ({ status: 'authenticated', user: { id: 'owner' } } as any), accessToken: async () => 'sensitive-test-token' },
    identity: async () => ({ id: 'desktop', credential: 'sensitive-device-credential' }), fetch, diagnostic }
  return { client: new DesktopIceClient(deps), authority, deps, body, revoke: () => { live = false } }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('desktop ICE setup', () => {
  it('accepts a six-second authenticated response rather than aborting at the old five-second deadline', async () => {
    const f = fixture()
    f.deps.fetch.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(new Response(JSON.stringify(f.body()))), 6000)))
    const request = f.client.request(f.authority)
    await vi.advanceTimersByTimeAsync(6001)
    expect(await request).toHaveLength(1)
    const [url, options] = f.deps.fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://example.com/api/remote/v1/desktop/ice')
    expect(options.redirect).toBe('error')
    expect(JSON.parse(String(options.body))).toEqual({ peerDeviceId: 'phone' })
    expect(new Headers(options.headers).get('X-Kun-Device')).toBe('desktop')
    expect(JSON.stringify(f.deps.diagnostic.mock.calls)).not.toContain('sensitive')
  })
  it('bounds a fetch that ignores abort and reports a useful timeout without credentials', async () => {
    const f = fixture(); f.deps.fetch.mockImplementation(() => new Promise(() => {}))
    const failed = expect(f.client.request(f.authority)).rejects.toThrow('DESKTOP_ICE_UNAVAILABLE')
    await vi.advanceTimersByTimeAsync(DESKTOP_ICE_TIMEOUT_MS)
    await failed
    expect(f.deps.diagnostic).toHaveBeenCalledWith(expect.objectContaining({ event: 'ice_failed', reason: 'timeout', stage: 'request' }))
  })
  it('rejects a response after the phone grant or account authority changes', async () => {
    const f = fixture(); f.deps.fetch.mockImplementation(async () => { f.revoke(); return new Response(JSON.stringify(f.body())) })
    await expect(f.client.request(f.authority)).rejects.toThrow('DESKTOP_AUTHORITY_CHANGED')
  })
  it('also bounds account preparation and prevents a late lookup from starting a request', async () => {
    const f = fixture(); let finish!: (state: any) => void
    f.deps.account.getState = () => new Promise(resolve => { finish = resolve })
    const failed = expect(f.client.request(f.authority)).rejects.toThrow('DESKTOP_ICE_UNAVAILABLE')
    await vi.advanceTimersByTimeAsync(DESKTOP_ICE_TIMEOUT_MS); await failed
    finish({ status: 'authenticated', user: { id: 'owner' } }); await vi.advanceTimersByTimeAsync(0)
    expect(f.deps.fetch).not.toHaveBeenCalled()
  })
  it('normalizes HTTP refusals and malformed responses while logging only status and fixed metadata', async () => {
    const f = fixture()
    f.deps.fetch.mockResolvedValue(new Response(JSON.stringify({ error: 'private-message' }), { status: 403 }))
    await expect(f.client.request(f.authority)).rejects.toThrow('DESKTOP_ICE_UNAVAILABLE')
    expect(f.deps.diagnostic).toHaveBeenCalledWith(expect.objectContaining({ reason: 'http', status: 403 }))
    f.deps.fetch.mockResolvedValue(new Response('not json'))
    await expect(f.client.request(f.authority)).rejects.toThrow('DESKTOP_ICE_UNAVAILABLE')
    expect(f.deps.diagnostic).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'invalid_response' }))
    expect(JSON.stringify(f.deps.diagnostic.mock.calls)).not.toContain('private-message')
  })
  it('rejects expired or unsafe server responses', async () => {
    const f = fixture()
    for (const body of [{ ...f.body(), expiresAt: Date.now() }, { ...f.body(), iceServers: [{ urls: 'file:///private' }] }]) {
      f.deps.fetch.mockResolvedValue(new Response(JSON.stringify(body)))
      await expect(f.client.request(f.authority)).rejects.toThrow('DESKTOP_ICE_UNAVAILABLE')
    }
  })
})
