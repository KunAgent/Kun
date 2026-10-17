import { describe, expect, it, vi } from 'vitest'
import { GoogleGmailClient } from './google-client.js'
import { GMAIL_SCOPES } from './ports.js'
import { json } from '../test-support/gmail-fixture.js'

describe('Google installed-app client identification', () => {
  for (const clientSecret of [undefined, 'fake-installed-app-identifier']) {
    it(`exchanges and refreshes using ${clientSecret ? 'an optional identifier' : 'PKCE without a client secret'}`, async () => {
      const request = vi.fn<typeof fetch>(async (url) => String(url).includes('/profile')
        ? json({ emailAddress: 'sender@example.com' })
        : json({ access_token: 'fake-access', refresh_token: 'fake-refresh', expires_in: 3_600, scope: GMAIL_SCOPES.join(' ') }))
      const client = new GoogleGmailClient(request, 'fake-desktop-client', clientSecret, () => 1_000)
      const tokens = await client.exchange('fake-code', 'fake-verifier', 'http://127.0.0.1:12345/oauth/gmail/callback')
      await client.refresh(tokens)
      const tokenRequests = request.mock.calls.filter(([url]) => String(url).endsWith('/token'))
      expect(tokenRequests).toHaveLength(2)
      for (const [url, init] of tokenRequests) {
        const body = init?.body as URLSearchParams
        expect(body.get('client_secret')).toBe(clientSecret ?? null)
        expect(String(url)).not.toContain('fake-installed-app-identifier')
        expect(init?.method).toBe('POST')
      }
      expect((tokenRequests[0][1]?.body as URLSearchParams).get('code_verifier')).toBe('fake-verifier')
    })
  }

  it('rejects incomplete or unexpected permissions without copying raw Google errors', async () => {
    const request = vi.fn<typeof fetch>(async () => json({
      access_token: 'fake-access', expires_in: 3_600,
      scope: GMAIL_SCOPES[0], error_description: 'PRIVATE_DIAGNOSTIC'
    }))
    const client = new GoogleGmailClient(request, 'fake-desktop-client', undefined, Date.now)
    await expect(client.exchange('code', 'verifier', 'http://127.0.0.1:12345/oauth/gmail/callback'))
      .rejects.toMatchObject({ code: 'scope_missing' })
    request.mockImplementation(async () => json({
      access_token: 'fake-access', expires_in: 3_600,
      scope: [...GMAIL_SCOPES, 'https://www.googleapis.com/auth/drive'].join(' ')
    }))
    await expect(client.exchange('code', 'verifier', 'http://127.0.0.1:12345/oauth/gmail/callback'))
      .rejects.toMatchObject({ code: 'scope_missing' })
  })
})

describe('credential-safe OAuth failure diagnostics', () => {
  it('identifies the required Desktop client configuration without retaining Google descriptions', async () => {
    const request = vi.fn<typeof fetch>(async () => json({ error: 'invalid_request', error_description: 'client_secret is missing.' }, 400))
    const client = new GoogleGmailClient(request, 'fake-client', undefined, Date.now)
    const failure = await client.exchange('code', 'verifier', 'http://127.0.0.1:12345/oauth/gmail/callback').catch((error: unknown) => error)
    expect(failure).toMatchObject({ authorizationErrorCode: 'token_client_secret_required' })
    expect(JSON.stringify(failure) + String(failure)).not.toContain('client_secret is missing.')
  })
  for (const [googleCode, category] of [
    ['invalid_client', 'token_invalid_client'], ['invalid_grant', 'token_invalid_grant'],
    ['invalid_request', 'token_invalid_request'], ['unauthorized_client', 'token_unauthorized_client'],
    ['invalid_scope', 'token_invalid_scope'], ['temporarily_unavailable', 'token_temporarily_unavailable'],
    ['PRIVATE_UNKNOWN_ERROR', 'authorization_failed']
  ] as const) {
    it(`maps ${category} without returning any token response data`, async () => {
      const request = vi.fn<typeof fetch>(async () => json({
        error: googleCode, error_description: 'PRIVATE_DESCRIPTION fake-refresh fake-code',
        access_token: 'PRIVATE_ACCESS_TOKEN', refresh_token: 'PRIVATE_REFRESH_TOKEN',
        error_uri: 'https://example.com/?client_secret=PRIVATE_SECRET'
      }, 400))
      const client = new GoogleGmailClient(request, 'fake-client', 'PRIVATE_CLIENT_SECRET', Date.now)
      const failure = await client.exchange('PRIVATE_AUTH_CODE', 'PRIVATE_VERIFIER', 'http://127.0.0.1:12345/oauth/gmail/callback')
        .catch((error: unknown) => error as Error)
      expect(failure).toMatchObject({ authorizationErrorCode: category,
        code: googleCode === 'invalid_grant' ? 'reconnect_required' : 'authorization_failed' })
      const safe = JSON.stringify(failure) + String(failure)
      expect(safe).not.toContain('PRIVATE_')
      expect(safe).not.toContain('fake-refresh')
      expect(safe).not.toContain('fake-code')
      expect(request).toHaveBeenCalledOnce()
    })
  }

  it('distinguishes token transport failure from malformed responses without exposing exceptions', async () => {
    const request = vi.fn<typeof fetch>(async () => { throw new Error('PRIVATE_SECRET from private URL') })
    const client = new GoogleGmailClient(request, 'fake-client', undefined, Date.now)
    const transport = await client.exchange('code', 'verifier', 'http://127.0.0.1:12345/oauth/gmail/callback').catch((error: unknown) => error)
    expect(transport).toMatchObject({ authorizationErrorCode: 'token_network_error' })
    expect(String(transport)).not.toContain('PRIVATE_SECRET')
    request.mockImplementation(async () => new Response('PRIVATE_NON_JSON', { status: 400 }))
    const malformed = await client.exchange('code', 'verifier', 'http://127.0.0.1:12345/oauth/gmail/callback').catch((error: unknown) => error)
    expect(malformed).toMatchObject({ authorizationErrorCode: 'token_invalid_response' })
    expect(String(malformed)).not.toContain('PRIVATE_NON_JSON')
    request.mockImplementation(async () => json({ scope: GMAIL_SCOPES.join(' ') }))
    await expect(client.exchange('code', 'verifier', 'http://127.0.0.1:12345/oauth/gmail/callback'))
      .rejects.toMatchObject({ authorizationErrorCode: 'token_invalid_response' })
  })

  it('identifies profile permission failure independently of a successful token exchange', async () => {
    const request = vi.fn<typeof fetch>(async (url) => String(url).includes('/token')
      ? json({ access_token: 'PRIVATE_ACCESS_TOKEN', expires_in: 3_600, scope: GMAIL_SCOPES.join(' ') })
      : json({ error: { message: 'PRIVATE_PROFILE_PAYLOAD' } }, 403))
    const client = new GoogleGmailClient(request, 'fake-client', undefined, Date.now)
    const failure = await client.exchange('code', 'verifier', 'http://127.0.0.1:12345/oauth/gmail/callback').catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'authorization_failed', authorizationErrorCode: 'profile_access_denied' })
    expect(JSON.stringify(failure) + String(failure)).not.toContain('PRIVATE_')
    expect(request).toHaveBeenCalledTimes(2)
  })
})

describe('Gmail list responses', () => {
  it('treats a 204 answer to a search with no matches as an empty result', async () => {
    const request = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }))
    const client = new GoogleGmailClient(request, 'fake-client', undefined, Date.now)
    await expect(client.list('subject:nothing', 5, 'fake-token')).resolves.toEqual({ messages: [], hasMore: false })
  })
})
