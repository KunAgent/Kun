import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { auth } from '@modelcontextprotocol/client'
import { afterEach, describe, expect, it } from 'vitest'
import { McpCapabilityConfig, type McpServerConfig } from '../../contracts/capabilities.js'
import { McpOAuthLifetime } from './mcp-oauth-lifetime.js'
import { FileMcpOAuthProvider } from './mcp-oauth-provider.js'
import { FileMcpOAuthStore } from './mcp-oauth-store.js'
import { canonicalMcpOAuthGrant } from './mcp-oauth-refresh.js'

/**
 * These tests drive the real SDK authorization state machine (`auth()`) against
 * a real HTTP token endpoint. `auth()` is the exact code path a transport runs
 * after a 401, and it performs its refresh POST through `fetchFn` - the same
 * `fetch` Kun installs on the SDK transports - so one refresh transaction is
 * observable from request to persisted state.
 */

type FakeAuthorizationServerOptions = {
  /** Some authorization servers omit `expires_in`; the SDK must still work. */
  omitExpiresIn?: boolean
  /** RFC 6749 allows a refresh response without a new refresh token. */
  omitRefreshToken?: boolean
  /** Servers may keep the refresh token stable across refreshes. */
  rotateRefreshToken?: boolean
  /** Servers may reuse the same access token string. */
  fixedAccessToken?: string
}

type FakeAuthorizationServer = {
  issuer: string
  serverUrl: URL
  tokenEndpoint: string
  tokenRequests: URLSearchParams[]
  firstRequest: Promise<void>
  /** The refresh token the server will currently accept. */
  currentRefreshToken: () => string
  /** Block the next token request until the returned release function runs. */
  holdNextRequest: () => () => void
  close: () => Promise<void>
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

/** Poll until `predicate` holds, or fail with a clear message. */
async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition was not reached before the deadline')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function startAuthorizationServer(
  options: FakeAuthorizationServerOptions = {}
): Promise<FakeAuthorizationServer> {
  const tokenRequests: Array<URLSearchParams> = []
  const firstRequest = deferred()
  let holdGate: Promise<void> | null = null
  let refreshToken = 'r0'
  let rotation = 0
  let issuer = ''

  const server: Server = createServer((request, response) => {
    request.on('error', () => undefined)
    response.on('error', () => undefined)
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none']
        }))
        return
      }
      if (request.method === 'POST' && url.pathname === '/token') {
        const body = await new Promise<string>((resolve, reject) => {
          let raw = ''
          request.on('data', (chunk) => { raw += String(chunk) })
          request.on('end', () => resolve(raw))
          request.on('error', reject)
        })
        const params = new URLSearchParams(body)
        tokenRequests.push(params)
        firstRequest.resolve()
        const gate = holdGate
        holdGate = null
        if (gate) await gate
        if (response.destroyed) return
        if (params.get('grant_type') !== 'refresh_token' || params.get('refresh_token') !== refreshToken) {
          response.writeHead(400, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ error: 'invalid_grant' }))
          return
        }
        rotation += 1
        if (options.rotateRefreshToken !== false) refreshToken = `r${rotation}`
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          access_token: options.fixedAccessToken ?? `a${rotation}`,
          token_type: 'Bearer',
          ...(options.omitRefreshToken ? {} : { refresh_token: refreshToken }),
          ...(options.omitExpiresIn ? {} : { expires_in: 3600 })
        }))
        return
      }
      response.writeHead(404)
      response.end()
    })()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (typeof address !== 'object' || !address) throw new Error('fake authorization server did not bind')
  issuer = `http://127.0.0.1:${address.port}`
  return {
    issuer,
    serverUrl: new URL(`${issuer}/mcp`),
    tokenEndpoint: `${issuer}/token`,
    tokenRequests,
    firstRequest: firstRequest.promise,
    currentRefreshToken: () => refreshToken,
    holdNextRequest: () => {
      const gate = deferred()
      holdGate = gate.promise
      return gate.resolve
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections?.()
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

function serverConfig(issuer: string): McpServerConfig {
  return McpCapabilityConfig.parse({
    enabled: true,
    servers: {
      docs: {
        enabled: true,
        transport: 'streamable-http',
        url: 'https://mcp.example.com/mcp',
        trustScope: 'user',
        oauth: { enabled: true, expectedIssuer: issuer }
      }
    },
    search: { enabled: false }
  }).servers.docs
}

function providerFor(
  server: McpServerConfig,
  storePath: string,
  options: { lifetime?: McpOAuthLifetime; now?: () => number } = {}
): FileMcpOAuthProvider {
  return new FileMcpOAuthProvider(
    'docs',
    server,
    storePath,
    () => undefined,
    options.now,
    false,
    undefined,
    options.lifetime
  )
}

async function seedGrant(
  provider: FileMcpOAuthProvider,
  issuer: string,
  tokenEndpoint: string,
  options: { accessToken?: string; refreshToken?: string } = {}
): Promise<void> {
  await provider.saveClientInformation({ client_id: 'kun-test', issuer }, { issuer })
  await provider.saveCodeVerifier('pkce-verifier')
  await provider.saveDiscoveryState({
    authorizationServerUrl: issuer,
    authorizationServerMetadata: {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: tokenEndpoint,
      // The SDK reads these unconditionally on the authorization-code leg.
      // Leaving them out turns a genuine re-authorization into a TypeError.
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256']
    }
  } as never)
  await provider.saveTokens({
    access_token: options.accessToken ?? 'a0',
    token_type: 'Bearer',
    refresh_token: options.refreshToken ?? 'r0',
    issuer
  }, { issuer })
}

describe('MCP OAuth refresh single-flight', () => {
  const cleanups: Array<() => Promise<void>> = []
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
  })

  async function workspace(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    return join(dir, 'docs-oauth.json')
  }

  function refreshBody(refreshToken: string, extra: Record<string, string> = {}): string {
    return new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, ...extra }).toString()
  }

  it('sends one refresh for two connections that share one credential file', async () => {
    const as = await startAuthorizationServer()
    cleanups.push(() => as.close())
    const storePath = await workspace('mcp-oauth-shared-')
    const server = serverConfig(as.issuer)
    const first = providerFor(server, storePath)
    const second = providerFor(server, storePath)
    await seedGrant(first, as.issuer, as.tokenEndpoint)

    const [firstResult, secondResult] = await Promise.all([
      auth(first, { serverUrl: as.serverUrl, fetchFn: first.oauthFetch }),
      auth(second, { serverUrl: as.serverUrl, fetchFn: second.oauthFetch })
    ])

    expect([firstResult, secondResult]).toEqual(['AUTHORIZED', 'AUTHORIZED'])
    expect(as.tokenRequests).toHaveLength(1)
    const persisted = await new FileMcpOAuthStore(storePath).read()
    expect(persisted.tokens?.access_token).toBe('a1')
    expect(persisted.tokens?.refresh_token).toBe('r1')
    expect(persisted.tokens?.issuer).toBe(as.issuer)
    expect(persisted.refreshEpoch).toBe(2)
    expect(persisted.mutationEpoch).toBe(2)
    expect(persisted.lastRefresh?.spentRefreshToken).toBe('r0')
    expect(persisted.lastRefresh?.accessToken).toBe('a1')
    // issuer, PKCE verifier, and discovery state survive the refresh untouched.
    expect(persisted.codeVerifier).toBe('pkce-verifier')
    expect(persisted.discoveryState?.authorizationServerUrl).toBe(as.issuer)
  })

  it('holds the credential transaction from before the request until the result is persisted', async () => {
    const as = await startAuthorizationServer()
    cleanups.push(() => as.close())
    const storePath = await workspace('mcp-oauth-lock-')
    const server = serverConfig(as.issuer)
    const first = providerFor(server, storePath)
    const second = providerFor(server, storePath)
    await seedGrant(first, as.issuer, as.tokenEndpoint)

    const release = as.holdNextRequest()
    const firstRun = auth(first, { serverUrl: as.serverUrl, fetchFn: first.oauthFetch })
    await as.firstRequest
    const secondRun = auth(second, { serverUrl: as.serverUrl, fetchFn: second.oauthFetch })
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(as.tokenRequests).toHaveLength(1)

    release()
    expect(await firstRun).toBe('AUTHORIZED')
    expect(await secondRun).toBe('AUTHORIZED')
    expect(as.tokenRequests).toHaveLength(1)
    const persisted = await new FileMcpOAuthStore(storePath).read()
    expect(persisted.tokens?.refresh_token).toBe('r1')
  })

  it('refreshes on a 401 grant that has no expires_in and reuses the rotated token', async () => {
    const as = await startAuthorizationServer({ omitExpiresIn: true })
    cleanups.push(() => as.close())
    const storePath = await workspace('mcp-oauth-noexpiry-')
    const server = serverConfig(as.issuer)
    const provider = providerFor(server, storePath)
    await seedGrant(provider, as.issuer, as.tokenEndpoint)

    expect(await auth(provider, { serverUrl: as.serverUrl, fetchFn: provider.oauthFetch })).toBe('AUTHORIZED')
    expect(as.tokenRequests).toHaveLength(1)
    const diagnostics = await provider.diagnostics()
    expect(diagnostics.status).toBe('authorized')
    expect(diagnostics.expiresAt).toBeUndefined()
    expect(diagnostics.hasRefreshToken).toBe(true)

    expect(await auth(provider, { serverUrl: as.serverUrl, fetchFn: provider.oauthFetch })).toBe('AUTHORIZED')
    expect(as.tokenRequests).toHaveLength(2)
    expect(as.tokenRequests[1].get('refresh_token')).toBe('r1')
  })

  it('keeps the spent refresh token when the token endpoint omits one, and restarts usable', async () => {
    const as = await startAuthorizationServer({ omitRefreshToken: true, rotateRefreshToken: false })
    cleanups.push(() => as.close())
    const storePath = await workspace('mcp-oauth-omit-refresh-')
    const server = serverConfig(as.issuer)
    const provider = providerFor(server, storePath)
    await seedGrant(provider, as.issuer, as.tokenEndpoint)

    expect(await auth(provider, { serverUrl: as.serverUrl, fetchFn: provider.oauthFetch })).toBe('AUTHORIZED')
    const afterRefresh = await new FileMcpOAuthStore(storePath).read()
    expect(afterRefresh.tokens?.access_token).toBe('a1')
    // RFC 6749: a refresh response may omit `refresh_token`; the SDK keeps the
    // spent one, and the persisted grant has to keep it too.
    expect(afterRefresh.tokens?.refresh_token).toBe('r0')

    // Restart: fresh instances read only what was persisted, then refresh again.
    const restarted = providerFor(server, storePath)
    expect(await auth(restarted, { serverUrl: as.serverUrl, fetchFn: restarted.oauthFetch })).toBe('AUTHORIZED')
    expect(as.tokenRequests).toHaveLength(2)
    expect(as.tokenRequests[1].get('refresh_token')).toBe('r0')
    const afterRestart = await new FileMcpOAuthStore(storePath).read()
    expect(afterRestart.tokens?.access_token).toBe('a2')
    expect(afterRestart.tokens?.refresh_token).toBe('r0')
  })

  it('clears credentials without waiting for an in-flight refresh, and its late result cannot resurrect them', async () => {
    const as = await startAuthorizationServer()
    cleanups.push(() => as.close())
    const storePath = await workspace('mcp-oauth-clear-')
    const server = serverConfig(as.issuer)
    const provider = providerFor(server, storePath)
    const revoker = providerFor(server, storePath)
    const writer = providerFor(server, storePath)
    await seedGrant(provider, as.issuer, as.tokenEndpoint)

    const release = as.holdNextRequest()
    const refreshing = auth(provider, { serverUrl: as.serverUrl, fetchFn: provider.oauthFetch })
      .then(() => 'authorized' as const, (error: unknown) => error)
    await as.firstRequest

    let revoked = false
    const revoking = revoker.clearCredentials().then(() => { revoked = true })
    // Barrier: the authorization server is still holding its response, so the
    // refresh owns the credential section. Revocation has to abort that request
    // rather than queue behind it until the request timeout.
    await waitUntil(() => revoked)
    await revoking
    expect((await new FileMcpOAuthStore(storePath).read()).tokens).toBeUndefined()

    // The section is free again: an unrelated credential write proceeds while
    // the aborted refresh is still unwinding.
    await writer.saveCodeVerifier('pkce-after-revoke')
    expect((await new FileMcpOAuthStore(storePath).read()).codeVerifier).toBe('pkce-after-revoke')

    release()
    expect(await refreshing).toBeInstanceOf(Error)
    const persisted = await new FileMcpOAuthStore(storePath).read()
    expect(persisted.tokens).toBeUndefined()
    // The clear bumped the epoch, and the SDK's invalid_grant handling may bump
    // it again by invalidating tokens a second time; what matters is that the
    // refresh result was never written.
    expect(persisted.clearEpoch).toBeGreaterThanOrEqual(1)
  })

  it('re-authorizes a new connection after a revocation cancelled an in-flight refresh', async () => {
    const as = await startAuthorizationServer()
    cleanups.push(() => as.close())
    const storePath = await workspace('mcp-oauth-reauth-')
    const server = serverConfig(as.issuer)
    const provider = providerFor(server, storePath)
    const revoker = providerFor(server, storePath)
    await seedGrant(provider, as.issuer, as.tokenEndpoint)

    const release = as.holdNextRequest()
    const refreshing = auth(provider, { serverUrl: as.serverUrl, fetchFn: provider.oauthFetch })
      .then(() => 'authorized' as const, (error: unknown) => error)
    await as.firstRequest
    await revoker.clearCredentials()
    release()
    expect(await refreshing).toBeInstanceOf(Error)
    expect((await new FileMcpOAuthStore(storePath).read()).tokens).toBeUndefined()

    // A fresh authorization writes a brand-new grant; the credential file must
    // be usable again, not poisoned by the abandoned transaction.
    const rebuilt = providerFor(server, storePath)
    const seeded = as.currentRefreshToken()
    await seedGrant(rebuilt, as.issuer, as.tokenEndpoint, { refreshToken: seeded })
    expect(await auth(rebuilt, { serverUrl: as.serverUrl, fetchFn: rebuilt.oauthFetch })).toBe('AUTHORIZED')
    const persisted = await new FileMcpOAuthStore(storePath).read()
    expect(persisted.lastRefresh?.spentRefreshToken).toBe(seeded)
    expect(persisted.tokens?.refresh_token).not.toBe(seeded)
    expect(persisted.tokens?.issuer).toBe(as.issuer)
  })

  it('waits for the in-flight refresh before close resolves, then frees the section', async () => {
    const as = await startAuthorizationServer()
    cleanups.push(() => as.close())
    const storePath = await workspace('mcp-oauth-close-order-')
    const server = serverConfig(as.issuer)
    const lifetime = new McpOAuthLifetime()
    const provider = providerFor(server, storePath, { lifetime })
    const writer = providerFor(server, storePath)
    await seedGrant(provider, as.issuer, as.tokenEndpoint)

    const release = as.holdNextRequest()
    const refreshing = auth(provider, { serverUrl: as.serverUrl, fetchFn: provider.oauthFetch })
    await as.firstRequest
    let closed = false
    const closing = lifetime.close().then(() => { closed = true })
    // Barrier: the response has not arrived, so close() must still be waiting
    // for the tracked transaction.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(closed).toBe(false)

    release()
    expect(await refreshing).toBe('AUTHORIZED')
    await closing
    expect(closed).toBe(true)
    const persisted = await new FileMcpOAuthStore(storePath).read()
    expect(persisted.tokens?.refresh_token).toBe('r1')

    // The section was released: another connection can write immediately.
    await writer.saveCodeVerifier('pkce-after-close')
    expect((await new FileMcpOAuthStore(storePath).read()).codeVerifier).toBe('pkce-after-close')
  })

  it('never spends a refresh token that was revoked before the transaction started', async () => {
    const as = await startAuthorizationServer()
    cleanups.push(() => as.close())
    const storePath = await workspace('mcp-oauth-revoked-')
    const server = serverConfig(as.issuer)
    const provider = providerFor(server, storePath)
    const revoker = providerFor(server, storePath)
    await seedGrant(provider, as.issuer, as.tokenEndpoint)

    // The SDK holds a refresh token it read before the user revoked access.
    await expect(provider.tokens()).resolves.toMatchObject({ refresh_token: 'r0' })
    await revoker.clearCredentials()

    const response = await provider.oauthFetch(as.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: refreshBody('r0')
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_grant' })
    expect(as.tokenRequests).toHaveLength(0)
    const persisted = await new FileMcpOAuthStore(storePath).read()
    expect(persisted.tokens).toBeUndefined()
  })

  it('collapses a cross-process duplicate even when the server keeps its refresh token', async () => {
    const as = await startAuthorizationServer({ rotateRefreshToken: false })
    cleanups.push(() => as.close())
    const storePath = await workspace('mcp-oauth-norotate-')
    const server = serverConfig(as.issuer)
    const first = providerFor(server, storePath)
    const peer = providerFor(server, storePath)
    await seedGrant(first, as.issuer, as.tokenEndpoint)

    // A peer process read the same grant before the first refresh landed. Its
    // decision must come from persisted state only, with no in-process registry
    // and no access-token heuristic: the refresh token never changes here.
    await expect(peer.tokens()).resolves.toMatchObject({ refresh_token: 'r0' })
    expect(await auth(first, { serverUrl: as.serverUrl, fetchFn: first.oauthFetch })).toBe('AUTHORIZED')
    expect(as.tokenRequests).toHaveLength(1)

    const response = await peer.oauthFetch(as.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: refreshBody('r0')
    })

    expect(response.status).toBe(200)
    expect((await response.json()).access_token).toBe('a1')
    expect(as.tokenRequests).toHaveLength(1)
    const persisted = await new FileMcpOAuthStore(storePath).read()
    expect(persisted.tokens?.access_token).toBe('a1')
    expect(persisted.tokens?.refresh_token).toBe('r0')
  })

  it('does not answer a refresh for a different resource indicator with another grant', async () => {
    const as = await startAuthorizationServer({ rotateRefreshToken: false })
    cleanups.push(() => as.close())
    const storePath = await workspace('mcp-oauth-resource-')
    const server = serverConfig(as.issuer)
    const provider = providerFor(server, storePath)
    await seedGrant(provider, as.issuer, as.tokenEndpoint)
    expect(await auth(provider, { serverUrl: as.serverUrl, fetchFn: provider.oauthFetch })).toBe('AUTHORIZED')
    expect(as.tokenRequests).toHaveLength(1)

    const resource = 'https://other.example/mcp'
    const response = await provider.oauthFetch(as.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: refreshBody('r0', { resource })
    })

    expect(response.status).toBe(200)
    expect(as.tokenRequests).toHaveLength(2)
    const persisted = await new FileMcpOAuthStore(storePath).read()
    expect(persisted.tokens?.access_token).toBe('a2')
    expect(persisted.lastRefresh?.grantKey).toBe(canonicalMcpOAuthGrant({
      serverId: 'docs',
      storePath: new FileMcpOAuthStore(storePath).physicalPath,
      issuer: as.issuer,
      clientId: 'kun-test',
      tokenEndpoint: as.tokenEndpoint,
      scope: undefined,
      resource
    }))
  })

  it('restarts the token lifetime even when the server reuses the access token string', async () => {
    let nowMs = 1_700_000_000_000
    const now = (): number => nowMs
    const as = await startAuthorizationServer({ fixedAccessToken: 'a0' })
    cleanups.push(() => as.close())
    const storePath = await workspace('mcp-oauth-sametoken-')
    const server = serverConfig(as.issuer)
    const provider = providerFor(server, storePath, { now })
    await seedGrant(provider, as.issuer, as.tokenEndpoint)
    const before = await new FileMcpOAuthStore(storePath).read()
    expect(before.tokensObtainedAt).toBe(1_700_000_000_000)

    nowMs += 5_000
    expect(await auth(provider, { serverUrl: as.serverUrl, fetchFn: provider.oauthFetch })).toBe('AUTHORIZED')

    const after = await new FileMcpOAuthStore(storePath).read()
    expect(after.tokens?.access_token).toBe('a0')
    expect(after.tokens?.refresh_token).toBe('r1')
    expect(after.tokensObtainedAt).toBe(1_700_000_005_000)
    expect(after.refreshEpoch).toBe((before.refreshEpoch ?? 0) + 1)
  })

  it('serializes an ordinary credential write against the refresh transaction', async () => {
    const as = await startAuthorizationServer()
    cleanups.push(() => as.close())
    const storePath = await workspace('mcp-oauth-concurrent-write-')
    const server = serverConfig(as.issuer)
    const provider = providerFor(server, storePath)
    const writer = providerFor(server, storePath)
    await seedGrant(provider, as.issuer, as.tokenEndpoint)

    const release = as.holdNextRequest()
    const refreshing = auth(provider, { serverUrl: as.serverUrl, fetchFn: provider.oauthFetch })
    await as.firstRequest
    // A second connection writes while the refresh is between request and
    // persist. It must queue behind the transaction instead of losing to a
    // read-modify-write race.
    const verifierWrite = writer.saveCodeVerifier('pkce-v2')
    await new Promise((resolve) => setTimeout(resolve, 40))
    release()

    expect(await refreshing).toBe('AUTHORIZED')
    await verifierWrite
    const persisted = await new FileMcpOAuthStore(storePath).read()
    expect(persisted.tokens?.refresh_token).toBe('r1')
    expect(persisted.codeVerifier).toBe('pkce-v2')
  })

  it('keeps the rotated grant usable when the connection closes mid-refresh', async () => {
    const as = await startAuthorizationServer()
    cleanups.push(() => as.close())
    const storePath = await workspace('mcp-oauth-close-')
    const server = serverConfig(as.issuer)
    const lifetime = new McpOAuthLifetime()
    const provider = providerFor(server, storePath, { lifetime })
    await seedGrant(provider, as.issuer, as.tokenEndpoint)

    const release = as.holdNextRequest()
    const refreshing = auth(provider, { serverUrl: as.serverUrl, fetchFn: provider.oauthFetch })
    await as.firstRequest
    const closing = lifetime.close()
    release()

    // Closing must not cancel a request that already left the process: the
    // authorization server may have rotated the grant, so the result is the
    // only copy of the new refresh token. The transaction is tracked, so
    // close() waits for it to be persisted.
    await expect(refreshing).resolves.toBe('AUTHORIZED')
    await closing
    const persisted = await new FileMcpOAuthStore(storePath).read()
    expect(persisted.tokens?.refresh_token).toBe('r1')
    expect(as.tokenRequests).toHaveLength(1)

    const rebuilt = providerFor(server, storePath)
    expect(await auth(rebuilt, { serverUrl: as.serverUrl, fetchFn: rebuilt.oauthFetch })).toBe('AUTHORIZED')
    expect(as.tokenRequests).toHaveLength(2)
    expect(as.tokenRequests[1].get('refresh_token')).toBe('r1')
    const final = await new FileMcpOAuthStore(storePath).read()
    expect(final.tokens?.refresh_token).toBe('r2')
  })

  it('rejects a late write whose refresh token another writer already spent', async () => {
    const storePath = await workspace('mcp-oauth-stale-')
    const store = new FileMcpOAuthStore(storePath)
    const issuer = 'https://auth.example.com'

    expect(await store.applyRefreshedTokens({
      tokens: { access_token: 'winner', token_type: 'Bearer', refresh_token: 'rX' },
      spentRefreshToken: 'r0',
      observedClearEpoch: 0,
      observedMutationEpoch: 0,
      obtainedAt: 1,
      issuer,
      grantKey: 'grant'
    })).toBe('saved')

    expect(await store.applyRefreshedTokens({
      tokens: { access_token: 'stale', token_type: 'Bearer', refresh_token: 'rLate' },
      spentRefreshToken: 'r0',
      observedClearEpoch: 0,
      observedMutationEpoch: 0,
      obtainedAt: 2,
      issuer,
      grantKey: 'grant'
    })).toBe('superseded')
    const persisted = await store.read()
    expect(persisted.tokens?.access_token).toBe('winner')
    expect(persisted.tokens?.refresh_token).toBe('rX')
    expect(persisted.refreshEpoch).toBe(1)

    await store.clear()
    expect(await store.applyRefreshedTokens({
      tokens: { access_token: 'resurrected', token_type: 'Bearer', refresh_token: 'rY' },
      spentRefreshToken: 'rX',
      observedClearEpoch: 0,
      observedMutationEpoch: 1,
      obtainedAt: 3,
      issuer,
      grantKey: 'grant'
    })).toBe('cleared')
    expect((await store.read()).tokens).toBeUndefined()
  })

})
