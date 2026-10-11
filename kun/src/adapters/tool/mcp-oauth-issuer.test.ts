import { auth, type StoredOAuthClientInformation, type StoredOAuthTokens } from '@modelcontextprotocol/client'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { McpOAuthConfig, McpServerConfig } from '../../contracts/capabilities.js'
import { createAesEncryptor } from '../../security/secret-store.js'
import { FileMcpOAuthProvider } from './mcp-oauth-provider.js'
import { FileMcpOAuthStore, type McpOAuthState } from './mcp-oauth-store.js'
import { McpAuthorizationRequiredError } from './mcp-types.js'

const issuer = 'https://auth.example.test/tenant'
const otherIssuer = 'https://untrusted.example.test/tenant'
const server = McpServerConfig.parse({
  transport: 'streamable-http', url: 'https://mcp.example.test/mcp', trustScope: 'user', oauth: {}
})

async function withStore(fn: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'kun-oauth-issuer-'))
  try {
    await fn(join(dir, 'credentials.json'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function discovery(authorizationServer: string): McpOAuthState['discoveryState'] {
  return {
    authorizationServerUrl: authorizationServer,
    authorizationServerMetadata: {
      issuer: authorizationServer,
      authorization_endpoint: `${authorizationServer}/authorize`,
      token_endpoint: `${authorizationServer}/token`,
      registration_endpoint: `${authorizationServer}/register`,
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'none']
    },
    resourceMetadata: { resource: server.url!, authorization_servers: [authorizationServer] }
  }
}

describe('MCP OAuth issuer isolation', () => {
  it.each([undefined, '', ' ', 7, 'not-an-issuer', 'https://auth.test?secret=x'])(
    'rejects legacy or malformed issuer %j without changing stored credentials', async (stamp) => {
      await withStore(async (path) => {
        const store = new FileMcpOAuthStore(path)
        await store.update(() => ({
          tokens: { access_token: 'old-access', refresh_token: 'old-refresh', token_type: 'bearer', issuer: stamp } as StoredOAuthTokens,
          clientInformation: { client_id: 'old-client', client_secret: 'old-secret', issuer: stamp } as StoredOAuthClientInformation
        }))
        const before = await readFile(path, 'utf8')
        const provider = new FileMcpOAuthProvider('docs', server, path)
        await expect(provider.tokens()).resolves.toBeUndefined()
        await expect(provider.tokens({ issuer })).resolves.toBeUndefined()
        await expect(provider.clientInformation({ issuer })).rejects.toBeInstanceOf(McpAuthorizationRequiredError)
        await expect(provider.diagnostics()).resolves.toMatchObject({
          status: 'error', hasTokens: false, hasRefreshToken: false, lastError: expect.stringContaining('authorization again')
        })
        expect(await readFile(path, 'utf8')).toBe(before)
      })
    }
  )

  it('round-trips the exact issuer and extension fields through encrypted storage and restart', async () => {
    await withStore(async (path) => {
      const encryptor = createAesEncryptor(randomBytes(32))
      const provider = new FileMcpOAuthProvider('docs', server, path, undefined, undefined, false, encryptor)
      const tokens = { access_token: 'access-secret', refresh_token: 'refresh-secret', token_type: 'bearer', issuer, resource: server.url }
      await provider.saveTokens(tokens)
      await provider.saveClientInformation({ client_id: 'client', client_secret: 'client-secret', issuer })
      const restarted = new FileMcpOAuthProvider('docs', server, path, undefined, undefined, false, encryptor)
      await expect(restarted.tokens()).resolves.toEqual(tokens)
      await expect(restarted.tokens({ issuer: `${issuer}/` })).resolves.toBeUndefined()
      await expect(restarted.clientInformation({ issuer })).resolves.toMatchObject({ issuer, client_secret: 'client-secret' })
      const raw = await readFile(path, 'utf8')
      for (const secret of ['access-secret', 'refresh-secret', 'client-secret', issuer]) expect(raw).not.toContain(secret)
    })
  })

  it('rejects save-time relabeling and missing issuers without replacing existing state', async () => {
    await withStore(async (path) => {
      const provider = new FileMcpOAuthProvider('docs', server, path)
      await provider.saveTokens({ access_token: 'original', token_type: 'bearer', issuer })
      const before = await readFile(path, 'utf8')
      await expect(provider.saveTokens({ access_token: 'new', token_type: 'bearer', issuer }, { issuer: otherIssuer })).rejects.toThrow('issuer')
      await expect(provider.saveClientInformation({ client_id: 'new', issuer }, { issuer: otherIssuer })).rejects.toThrow('issuer')
      await expect(provider.saveTokens({ access_token: 'new', token_type: 'bearer' })).rejects.toThrow('issuer')
      expect(await readFile(path, 'utf8')).toBe(before)
    })
  })

  it('requires a trusted pin for configured clients and checks it on context-less access', async () => {
    await withStore(async (path) => {
      const configured = { ...server, oauth: { ...server.oauth!, clientId: 'client', clientSecret: 'fixture-secret' } }
      const unpinned = new FileMcpOAuthProvider('docs', configured, path)
      await expect(unpinned.clientInformation({ issuer })).rejects.toThrow('oauth.expectedIssuer')
      await expect(unpinned.tokens()).rejects.toThrow('oauth.expectedIssuer')
      const pinned = new FileMcpOAuthProvider('docs', { ...configured, oauth: { ...configured.oauth, expectedIssuer: issuer } }, path)
      await expect(pinned.clientInformation({ issuer })).resolves.toEqual({ client_id: 'client', client_secret: 'fixture-secret', issuer })
      await expect(pinned.clientInformation({ issuer: otherIssuer })).rejects.toBeInstanceOf(McpAuthorizationRequiredError)
      const store = new FileMcpOAuthStore(path)
      await store.update(() => ({ tokens: { access_token: 'wrong-token', token_type: 'bearer', issuer: otherIssuer } }))
      await expect(pinned.tokens()).resolves.toBeUndefined()
      await expect(pinned.diagnostics()).resolves.toMatchObject({ status: 'error', hasTokens: false })
    })
  })

  it.each(['legacy', 'changed-issuer', 'configured', 'unpinned'])(
    'blocks SDK registration and token calls for %s credentials at an alternate issuer', async (kind) => {
      await withStore(async (path) => {
        const stamp = kind === 'legacy' ? {} : { issuer }
        const store = new FileMcpOAuthStore(path)
        await store.update(() => ({
          clientInformation: { client_id: 'client', client_secret: 'fixture-client-secret', ...stamp },
          tokens: { access_token: 'fixture-access', refresh_token: 'fixture-refresh', token_type: 'bearer', ...stamp },
          discoveryState: discovery(otherIssuer)
        }))
        const config = kind === 'configured' || kind === 'unpinned'
          ? { ...server, oauth: { ...server.oauth!, clientId: 'client', clientSecret: 'fixture-client-secret', ...(kind === 'configured' ? { expectedIssuer: issuer } : {}) } }
          : server
        const openExternal = vi.fn()
        const provider = new FileMcpOAuthProvider('docs', config, path, openExternal)
        const fetchFn = vi.fn<typeof fetch>(async () => { throw new Error('Unexpected credential request') })
        const before = await readFile(path, 'utf8')
        await expect(auth(provider, { serverUrl: server.url!, fetchFn })).rejects.toBeInstanceOf(McpAuthorizationRequiredError)
        expect(fetchFn).not.toHaveBeenCalled()
        expect(openExternal).not.toHaveBeenCalled()
        expect(await readFile(path, 'utf8')).toBe(before)
      })
    }
  )

  it('refreshes matching credentials with the patched SDK and preserves its issuer stamp', async () => {
    await withStore(async (path) => {
      const store = new FileMcpOAuthStore(path)
      await store.update(() => ({
        clientInformation: { client_id: 'client', client_secret: 'fixture-secret', issuer },
        tokens: { access_token: 'old', refresh_token: 'fixture-refresh', token_type: 'bearer', issuer },
        discoveryState: discovery(issuer)
      }))
      const provider = new FileMcpOAuthProvider('docs', server, path)
      const fetchFn = vi.fn<typeof fetch>(async (url, init) => {
        expect(String(url)).toBe(`${issuer}/token`)
        expect(String(init?.body)).toContain('refresh_token=fixture-refresh')
        return Response.json({ access_token: 'new-access', token_type: 'bearer', refresh_token: 'new-refresh' })
      })
      await expect(auth(provider, { serverUrl: server.url!, fetchFn })).resolves.toBe('AUTHORIZED')
      expect(fetchFn).toHaveBeenCalledTimes(1)
      await expect(provider.tokens()).resolves.toMatchObject({ access_token: 'new-access', issuer })
      await expect(provider.diagnostics()).resolves.toMatchObject({ status: 'authorized' })
    })
  })

  it('rejects an issuer chosen by fresh malicious discovery before sending credentials', async () => {
    await withStore(async (path) => {
      const store = new FileMcpOAuthStore(path)
      const original = {
        clientInformation: { client_id: 'client', client_secret: 'fixture-secret', issuer },
        tokens: { access_token: 'access', refresh_token: 'fixture-refresh', token_type: 'bearer', issuer }
      }
      await store.update(() => original)
      const provider = new FileMcpOAuthProvider('docs', server, path)
      const fetchFn = vi.fn<typeof fetch>(async (url, init) => {
        expect(init?.method ?? 'GET').toBe('GET')
        expect(init?.body).toBeUndefined()
        expect(new Headers(init?.headers).has('authorization')).toBe(false)
        if (String(url).includes('oauth-protected-resource')) return Response.json(discovery(otherIssuer)!.resourceMetadata)
        if (String(url).includes('oauth-authorization-server')) return Response.json(discovery(otherIssuer)!.authorizationServerMetadata)
        throw new Error('Unexpected credential request')
      })
      await expect(auth(provider, { serverUrl: server.url!, fetchFn })).rejects.toBeInstanceOf(McpAuthorizationRequiredError)
      expect(fetchFn).toHaveBeenCalledTimes(2)
      await expect(store.read()).resolves.toMatchObject(original)
      await expect(provider.diagnostics()).resolves.toMatchObject({ status: 'error', hasTokens: false })
    })
  })

  it('reports failed authorization even with older tokens, then clears the error on success', async () => {
    await withStore(async (path) => {
      const provider = new FileMcpOAuthProvider('docs', server, path)
      await provider.saveTokens({ access_token: 'old', token_type: 'bearer', issuer })
      await provider.recordAuthorizationError('Authorization did not complete')
      await expect(provider.diagnostics()).resolves.toMatchObject({ status: 'error' })
      await provider.saveTokens({ access_token: 'fresh', token_type: 'bearer', issuer })
      await expect(provider.diagnostics()).resolves.toMatchObject({ status: 'authorized' })
    })
  })

  it('diagnoses the configured client rather than an ignored older dynamic registration', async () => {
    await withStore(async (path) => {
      const store = new FileMcpOAuthStore(path)
      await store.update(() => ({ clientInformation: { client_id: 'old-dynamic', issuer: otherIssuer } }))
      const config = { ...server, oauth: { ...server.oauth!, clientId: 'configured', expectedIssuer: issuer } }
      const provider = new FileMcpOAuthProvider('docs', config, path)
      await provider.saveTokens({ access_token: 'fresh', token_type: 'bearer', issuer })
      await provider.saveDiscoveryState(discovery(issuer)!)
      await expect(provider.diagnostics()).resolves.toMatchObject({ status: 'authorized', hasClientInformation: true })
      await expect(store.read()).resolves.toMatchObject({ clientInformation: { client_id: 'old-dynamic' } })
      await provider.saveDiscoveryState(discovery(otherIssuer)!)
      await expect(provider.diagnostics()).resolves.toMatchObject({ status: 'error', hasTokens: false })
    })
  })

  it('keeps ordinary SDK authorization noninteractive when a sign-in is required', async () => {
    await withStore(async (path) => {
      const store = new FileMcpOAuthStore(path)
      await store.update(() => ({ clientInformation: { client_id: 'client', issuer }, discoveryState: discovery(issuer) }))
      const openExternal = vi.fn()
      const provider = new FileMcpOAuthProvider('docs', server, path, openExternal)
      const fetchFn = vi.fn<typeof fetch>(async () => { throw new Error('Unexpected credential request') })
      await expect(auth(provider, { serverUrl: server.url!, fetchFn })).rejects.toBeInstanceOf(McpAuthorizationRequiredError)
      expect(openExternal).not.toHaveBeenCalled()
      expect(fetchFn).not.toHaveBeenCalled()
    })
  })

  it('allows explicit fresh authorization to replace rejected registration without refreshing old tokens', async () => {
    await withStore(async (path) => {
      const store = new FileMcpOAuthStore(path)
      await store.update(() => ({
        clientInformation: { client_id: 'legacy', client_secret: 'legacy-secret' },
        tokens: { access_token: 'old', refresh_token: 'legacy-refresh', token_type: 'bearer' },
        discoveryState: discovery(issuer)
      }))
      const provider = new FileMcpOAuthProvider('docs', server, path, undefined, undefined, true)
      const redirect = vi.spyOn(provider, 'redirectToAuthorization').mockResolvedValue()
      const fetchFn = vi.fn<typeof fetch>(async (url, init) => {
        expect(String(url)).toBe(`${issuer}/register`)
        expect(String(init?.body)).not.toContain('legacy-secret')
        expect(String(init?.body)).not.toContain('legacy-refresh')
        return Response.json({ ...provider.clientMetadata, client_id: 'fresh-client' })
      })
      await expect(auth(provider, { serverUrl: server.url!, fetchFn })).resolves.toBe('REDIRECT')
      expect(redirect).toHaveBeenCalledOnce()
      expect(fetchFn).toHaveBeenCalledOnce()
      await provider.saveTokens({ access_token: 'fresh-access', token_type: 'bearer', issuer })
      await expect(provider.diagnostics()).resolves.toMatchObject({ status: 'authorized' })
    })
  })

  it('keeps issuer pins exact and rejects unsafe configuration values', () => {
    expect(McpOAuthConfig.parse({ expectedIssuer: issuer }).expectedIssuer).toBe(issuer)
    expect(McpOAuthConfig.parse({}).expectedIssuer).toBeUndefined()
    for (const expectedIssuer of ['not-url', 'file:///tmp/auth', 'https://user:secret@auth.test', 'https://auth.test?q=x', 'https://auth.test#x', ` ${issuer}`, `${issuer}\n`]) {
      expect(McpOAuthConfig.safeParse({ expectedIssuer }).success).toBe(false)
    }
  })
})
