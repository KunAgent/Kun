import { describe, expect, it, vi } from 'vitest'
import { createAccountTransport } from './transport'
import { KUN_ACCOUNT_SUPABASE } from './config'

function fixture() {
  const fetcher = vi.fn(async (input: URL | RequestInfo, _options?: RequestInit): Promise<Response> => {
    const url = String(input)
    if (url.endsWith('/auth/config')) return Response.json({ supabase_url: KUN_ACCOUNT_SUPABASE, publishable_key: 'sb_publishable_test', oauth_enabled: true, providers: { email: true, google: false } })
    if (url.endsWith('/oauth/token')) return Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, token_type: 'bearer' })
    if (url.endsWith('/oauth/userinfo')) return Response.json({ sub: 'user-id', email: 'test@example.test', name: 'Name' })
    if (url.endsWith('/api/me')) return Response.json({ id: 'user-id', display_name: 'Display', avatar_url: 'javascript:alert(1)' })
    if (url.includes('/logout?scope=local')) return new Response(null, { status: 204 })
    throw new Error('unexpected request')
  })
  return { fetcher, transport: createAccountTransport(fetcher, 'desktop-client', () => 1000) }
}
describe('Kun desktop OAuth transport', () => {
  it('uses application token exchange and verifies UserInfo against the RLS profile', async () => {
    const f = fixture()
    const tokens = await f.transport.exchange({ grant_type: 'authorization_code', code: 'c', code_verifier: 'v' })
    expect(tokens.expiresAt).toBe(3601000)
    const call = f.fetcher.mock.calls.find(([url]) => String(url).endsWith('/oauth/token'))!
    const fields = new URLSearchParams(String(call[1]?.body))
    expect(fields.get('client_id')).toBe('desktop-client')
    expect(fields.has('client_secret')).toBe(false)
    expect(call[1]?.redirect).toBe('error')
    expect(await f.transport.user('access')).toEqual({ id: 'user-id', email: 'test@example.test', name: 'Display', avatarUrl: null })
    await f.transport.logout('access')
    expect(String(f.fetcher.mock.calls.at(-1)?.[0])).toContain('/logout?scope=local')
  })
  it('does not send credentials to an untrusted discovery origin', async () => {
    const f = fixture()
    f.fetcher.mockResolvedValueOnce(Response.json({ supabase_url: 'https://attacker.example', publishable_key: 'sb_publishable_x', oauth_enabled: true, providers: { email: true } }))
    await expect(f.transport.exchange({ grant_type: 'refresh_token', refresh_token: 'private' })).rejects.toMatchObject({ code: 'configuration' })
    expect(f.fetcher).toHaveBeenCalledOnce()
  })
  it('rejects identity mismatches and never exposes upstream error details', async () => {
    const f = fixture()
    const original = f.fetcher.getMockImplementation()!
    f.fetcher.mockImplementation((url, options) => String(url).endsWith('/api/me') ? Promise.resolve(Response.json({ id: 'someone-else' })) : original(url, options))
    await expect(f.transport.user('access')).rejects.toMatchObject({ code: 'expired' })
    f.fetcher.mockResolvedValueOnce(Response.json({ error: 'invalid_grant', error_description: 'private upstream detail' }, { status: 400 }))
    await expect(f.transport.exchange({ grant_type: 'refresh_token', refresh_token: 'private' })).rejects.toMatchObject({ message: 'expired' })
  })
})
