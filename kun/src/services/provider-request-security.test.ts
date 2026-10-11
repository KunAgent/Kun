import { createCodexProviderCatalogFetcher, CODEX_PROVIDER_VERSION_URL } from '../adapters/model/codex-provider-catalog.js'
import { refreshStoredGrokOAuthCredentials, GROK_OAUTH_ISSUER } from './grok-oauth-credential-refresher.js'
import { makeModelRequest } from '../server/routes/model-gateway-core.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompatModelClient } from '../adapters/model/compat-model-client.js'
import { ProviderAuthProfileSchema, ProviderHeaderProfileSchema } from '../contracts/provider-configuration.js'
import { assertProviderSecretScope, protectInferenceHeaders, providerAuthenticationHeaders, scopedProviderHeaders, scopedProviderOAuthFetch } from './provider-request-security.js'
import { probeModels } from './model-connection-probe.js'

const auth = ProviderAuthProfileSchema.parse({ mode: 'header', headerName: 'X-Service-Key', prefix: '',
  scope: { hosts: ['inference.test', 'catalog.test:8443'], purposes: ['inference', 'discovery'] } })
const headers = ProviderHeaderProfileSchema.parse({ scope: { hosts: ['inference.test'], purposes: ['inference'] } })
afterEach(() => vi.unstubAllGlobals())
describe('provider secret host and purpose ownership', () => {
  it('validates exact hosts and denies all public metadata destinations', () => {
    expect(() => assertProviderSecretScope(auth.scope, 'https://catalog.test:8443/models', 'discovery', [])).not.toThrow()
    for (const url of ['https://catalog.test/models', 'https://inference.test.evil/models', 'https://user:secret@inference.test/models']) {
      expect(() => assertProviderSecretScope(auth.scope, url, 'inference', [])).toThrow('not approved')
    }
    for (const url of ['https://models.dev/api.json', 'https://registry.npmjs.org/@openai/codex/latest', 'https://inference.test']) {
      expect(() => assertProviderSecretScope(auth.scope, url, 'public-metadata', [])).toThrow('not approved')
    }
    expect(ProviderAuthProfileSchema.safeParse({ ...auth, scope: { hosts: ['*.test'], purposes: ['inference'] } }).success).toBe(false)
    expect(ProviderAuthProfileSchema.safeParse({ ...auth, scope: { hosts: ['inference.test'], purposes: ['public-metadata'] } }).success).toBe(false)
  })
  it('owns the authentication header independently of protocol or user header casing', () => {
    expect(providerAuthenticationHeaders({ apiKey: 'test-secret', protocol: 'messages', authProfile: auth,
      requestUrl: 'https://inference.test/messages', purpose: 'inference', fallbackUrls: [] })).toEqual({ 'X-Service-Key': 'test-secret' })
    expect(protectInferenceHeaders({ headers: { Authorization: 'wrong', 'x-api-key': 'wrong', 'x-service-key': 'wrong', 'Content-Type': 'application/json' },
      apiKey: 'test-secret', protocol: 'messages', authProfile: auth, requestUrl: 'https://inference.test/messages', fallbackUrls: [] }))
      .toEqual({ 'Content-Type': 'application/json', 'X-Service-Key': 'test-secret' })
    expect(() => scopedProviderHeaders({ headers: { aUtHoRiZaTiOn: 'wrong' }, authProfile: auth,
      requestUrl: 'https://inference.test', purpose: 'inference', fallbackUrls: ['https://inference.test'] })).toThrow('auth profile')
  })
  it('never forwards extra headers to discovery or OAuth/quota without its own permission', () => {
    for (const purpose of ['discovery', 'oauth', 'quota'] as const) expect(() => scopedProviderHeaders({ headers: { 'X-Private': 'secret' },
      headerProfile: headers, requestUrl: 'https://inference.test', purpose, fallbackUrls: [] })).toThrow('not approved')
    expect(() => scopedProviderHeaders({ headers: { 'X-Private': 'secret' }, headerProfile: headers,
      requestUrl: 'https://catalog.test:8443', purpose: 'inference', fallbackUrls: [] })).toThrow('not approved')
  })
  it('uses the same profile in discovery and blocks a denied destination before network access', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [{ id: 'configured-model' }] })); vi.stubGlobal('fetch', fetcher)
    const input = { kind: 'http' as const, baseUrl: 'https://inference.test/v1', apiKey: 'test-secret', fallbackModels: [], proxyUrl: '', authProfile: auth }
    await expect(probeModels({ ...input, discovery: { mode: 'custom', modelsUrl: 'https://catalog.test:8443/models',
      itemsPointer: '/data', idPointer: '/id', credentialHosts: ['catalog.test:8443'], maxPages: 1 } })).resolves.toEqual(['configured-model'])
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-Service-Key': 'test-secret' })
    await expect(probeModels({ ...input, discovery: { mode: 'custom', modelsUrl: 'https://other.test/models',
      itemsPointer: '/data', idPointer: '/id', credentialHosts: ['other.test'], maxPages: 1 } })).rejects.toThrow('not approved')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('keeps the supplier key and account headers out of public version requests', async () => {
    const fetcher = vi.fn(async (url: string, init: RequestInit) => url === CODEX_PROVIDER_VERSION_URL
      ? Response.json({ name: '@openai/codex', version: '0.160.0' })
      : Response.json({ models: [] }))
    await createCodexProviderCatalogFetcher()({ fetcher, proxyUrl: '', timeoutMs: 1000,
      headers: { authorization: 'Bearer private-key', 'chatgpt-account-id': 'private-account' } })
    expect(fetcher.mock.calls[0][1].headers).toEqual({ Accept: 'application/json' })
    expect(fetcher.mock.calls[1][1].headers).toMatchObject({ authorization: 'Bearer private-key' })
  })
  it('keeps OAuth refresh tokens inside the fixed adapter issuer scope', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(init?.redirect).toBe('error')
      if (String(url).includes('well-known')) return Response.json({ token_endpoint: 'https://evil.test/token' })
      expect(new URL(String(url)).origin).toBe(GROK_OAUTH_ISSUER)
      return Response.json({ access_token: 'rotated', expires_in: 3600 })
    })
    const credential = { kind: 'grok-oauth' as const, accessToken: 'old', refreshToken: 'private-refresh', expiresAt: 1 }
    await refreshStoredGrokOAuthCredentials(credential, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
    fetcher.mockClear()
    await expect(refreshStoredGrokOAuthCredentials({ ...credential, issuer: 'https://evil.test' }, fetcher)).rejects.toThrow('credential scope')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('checks OAuth purpose before sending refresh bodies, including Request objects', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ access_token: 'rotated' }))
    const protectedFetch = scopedProviderOAuthFetch(fetcher, { ...auth, scope: { hosts: ['auth.openai.com'], purposes: ['inference'] } })
    await expect(protectedFetch('https://auth.openai.com/oauth/token', { method: 'POST', body: 'refresh_token=private' })).rejects.toThrow('not approved')
    await expect(protectedFetch(new Request('https://auth.openai.com/oauth/token', { method: 'POST', body: 'refresh_token=private' }))).rejects.toThrow('not approved')
    expect(fetcher).not.toHaveBeenCalled()
    const approved = scopedProviderOAuthFetch(fetcher, { ...auth, scope: { hosts: ['auth.openai.com'], purposes: ['oauth'] } })
    await approved('https://auth.openai.com/oauth/token', { method: 'POST', body: 'refresh_token=private' })
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe('error')
    await expect(approved('https://evil.test/token', { method: 'POST', body: 'refresh_token=private' })).rejects.toThrow('not approved')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('scopes generated discovery headers as adapter material rather than user authentication overrides', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [{ id: 'model-a' }] })); vi.stubGlobal('fetch', fetcher)
    await probeModels({ kind: 'http', baseUrl: 'https://inference.test', endpointFormat: 'messages', apiKey: 'fresh-key',
      headers: { 'x-api-key': 'old-generated-key', 'X-Account': 'account' }, customHeaders: { 'X-Tenant': 'tenant' },
      authProfile: auth, proxyUrl: '', fallbackModels: [] })
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-Service-Key': 'fresh-key', 'X-Account': 'account', 'X-Tenant': 'tenant' })
  })
  it('denies inference before sending when the effective model chooses an unapproved endpoint host', async () => {
    const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }))
    const client = new CompatModelClient({ baseUrl: 'https://inference.test/v1', endpoints: { messages: 'https://other.test/v1' },
      endpointFormat: 'messages', apiKey: 'test-secret', model: 'configured-model', authProfile: auth, fetchImpl: fetcher, nonStreaming: true })
    const request = makeModelRequest({ model: 'configured-model', messages: [{ role: 'user', content: 'hello' }] }, new AbortController().signal)
    const chunks = []; for await (const chunk of client.stream(request)) chunks.push(chunk)
    expect(chunks.some((chunk) => chunk.kind === 'error' && chunk.code === 'provider_secret_scope_denied')).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
