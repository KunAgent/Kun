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
