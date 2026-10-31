import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { auth } from '@modelcontextprotocol/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpCapabilityConfig, type McpServerConfig } from '../../contracts/capabilities.js'
import { createAesEncryptor, type SecretEncryptor } from '../../security/secret-store.js'
import { fileMutationLockRoot } from './file-mutation-queue.js'
import { hashText } from './mcp-naming.js'
import { createMcpOAuthProvider, FileMcpOAuthProvider } from './mcp-oauth-provider.js'
import { FileMcpOAuthStore, mcpOAuthCredentialResource } from './mcp-oauth-store.js'
import { buildMcpToolProviders, McpAuthorizationRequiredError } from './mcp-tool-provider.js'

/**
 * Coordination-domain tests for MCP OAuth credentials.
 *
 * These cover the parts of the refresh transaction that are *not* about the
 * wire protocol: which credential file a write belongs to (symlinks, missing
 * files), whether two operating-system processes agree on the lock, and
 * whether an SDK acknowledgement stays tied to the transaction that produced
 * it. They deliberately use real child processes and real symlinks rather than
 * an in-process approximation.
 */

const execFileAsync = promisify(execFile)
const WORKER_SOURCE = fileURLToPath(new URL('../../../tests/fixtures/mcp-oauth-lock-worker.ts', import.meta.url))

type FakeServer = {
  issuer: string
  serverUrl: URL
  tokenEndpoint: string
  requests: Array<URLSearchParams>
  firstRequest: Promise<void>
  holdNextRequest: () => () => void
  close: () => Promise<void>
}

async function startServer(options: { fixedAccessToken?: string } = {}): Promise<FakeServer> {
  const requests: Array<URLSearchParams> = []
  let issuer = ''
  let rotation = 0
  let refreshToken = 'r0'
  let markFirstRequest!: () => void
  const firstRequest = new Promise<void>((resolve) => { markFirstRequest = resolve })
  let hold: Promise<void> | undefined
  const server = createServer((request, response) => {
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
        requests.push(params)
        markFirstRequest()
        const gate = hold
        hold = undefined
        if (gate) await gate
        if (response.destroyed) return
        if (params.get('grant_type') !== 'refresh_token' || params.get('refresh_token') !== refreshToken) {
          response.writeHead(400, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ error: 'invalid_grant' }))
          return
        }
        rotation += 1
        refreshToken = `r${rotation}`
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          access_token: options.fixedAccessToken ?? `a${rotation}`,
          token_type: 'Bearer',
          refresh_token: refreshToken,
          expires_in: 3600,
          id_token: `id${rotation}`
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
    requests,
    firstRequest,
    holdNextRequest: () => {
      let release!: () => void
      hold = new Promise<void>((resolve) => { release = resolve })
      return release
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

async function seed(
  storePath: string, issuer: string, tokenEndpoint: string, encryptor?: SecretEncryptor
): Promise<void> {
  const store = new FileMcpOAuthStore(storePath, encryptor)
  await store.update(() => ({
    clientInformation: { client_id: 'kun-test', issuer },
    codeVerifier: 'pkce-verifier',
    discoveryState: {
      authorizationServerUrl: issuer,
      authorizationServerMetadata: {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: tokenEndpoint,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256']
      }
    } as never,
    tokens: { access_token: 'a0', token_type: 'Bearer', refresh_token: 'r0', issuer }
  }))
}

function providerAt(server: McpServerConfig, storePath: string): FileMcpOAuthProvider {
  return new FileMcpOAuthProvider('docs', server, storePath, () => undefined)
}

function holdFirstAcknowledgement(provider: FileMcpOAuthProvider): { reached: Promise<void>; release: () => void } {
  let markReached!: () => void
  let release!: () => void
  const reached = new Promise<void>((resolve) => { markReached = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  const save = provider.saveTokens.bind(provider)
  let held = false
  vi.spyOn(provider, 'saveTokens').mockImplementation(async (...args) => {
    if (!held) {
      held = true
      markReached()
      await gate
    }
    await save(...args)
  })
  return { reached, release }
}

describe('MCP OAuth credential coordination domain', () => {
  const cleanups: Array<() => Promise<void>> = []
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
  })

  async function root(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    return dir
  }

  it('keeps two SDK acknowledgements tied to their refresh, so a late one cannot restore revoked credentials', async () => {
    const as = await startServer()
    cleanups.push(() => as.close())
    const dir = await root('mcp-oauth-acks-')
    const storePath = join(dir, 'docs-oauth.json')
    await seed(storePath, as.issuer, as.tokenEndpoint)
    const server = serverConfig(as.issuer)
    const provider = providerAt(server, storePath)
    const revoker = providerAt(server, storePath)
    const ack = holdFirstAcknowledgement(provider)
    const runs = [
      auth(provider, { serverUrl: as.serverUrl, fetchFn: provider.oauthFetch }),
      auth(provider, { serverUrl: as.serverUrl, fetchFn: provider.oauthFetch })
    ]

    try {
      await ack.reached
      expect(await Promise.race(runs)).toBe('AUTHORIZED')
      expect(as.requests).toHaveLength(1)
      expect((await new FileMcpOAuthStore(storePath).read()).tokens?.access_token).toBe('a1')
      await revoker.clearCredentials()
    } finally {
      ack.release()
      await Promise.all(runs)
    }
    const persisted = await new FileMcpOAuthStore(storePath).read()
    expect(persisted.tokens).toBeUndefined()
    expect(persisted.clearEpoch).toBeGreaterThanOrEqual(1)
  })

  it('clears an encrypted grant through the plugin entry despite an in-flight SDK acknowledgement', async () => {
    const as = await startServer()
    cleanups.push(() => as.close())
    const dir = await root('mcp-oauth-encrypted-clear-')
    const server = serverConfig(as.issuer)
    const config = McpCapabilityConfig.parse({ enabled: true, servers: { docs: server }, search: { enabled: false } })
    const encryptor = createAesEncryptor(randomBytes(32))
    const storePath = join(dir, `docs-${hashText(server.url!).slice(0, 16)}.json`)
    await seed(storePath, as.issuer, as.tokenEndpoint, encryptor)
    const store = new FileMcpOAuthStore(storePath, encryptor)
    const provider = createMcpOAuthProvider('docs', server, { storageDir: dir, encryptor })!
    const built = await buildMcpToolProviders(config, {
      oauthStorageDir: dir,
      oauthEncryptor: encryptor,
      clientFactory: async () => { throw new McpAuthorizationRequiredError('docs') },
      backgroundReconnect: { enabled: false }
    })
    const ack = holdFirstAcknowledgement(provider)
    const refreshing = auth(provider, { serverUrl: as.serverUrl, fetchFn: provider.oauthFetch })
    try {
      await ack.reached
      expect((await store.read()).tokens?.refresh_token).toBe('r1')
      expect(JSON.parse(await readFile(storePath, 'utf8'))).toHaveProperty('__enc')
      expect(await built.clearOAuthCredentials('docs')).toEqual({ cleared: ['docs'] })
      const cleared = await store.read()
      expect(Object.keys(cleared).sort()).toEqual(['clearEpoch', 'mutationEpoch'])
      expect(cleared.clearEpoch).toBe(1)
      expect(built.oauth[0]).toMatchObject({ serverId: 'docs', status: 'empty', hasTokens: false })
    } finally {
      ack.release()
      await refreshing
      await built.close()
    }
    const persisted = await store.read()
    expect(Object.keys(persisted).sort()).toEqual(['clearEpoch', 'mutationEpoch'])
    expect(JSON.parse(await readFile(storePath, 'utf8'))).toHaveProperty('__enc')
  })

  it('clears encrypted credentials through the plugin while a refresh request is still on the wire', async () => {
    const as = await startServer()
    cleanups.push(() => as.close())
    const dir = await root('mcp-oauth-encrypted-refresh-')
    const server = serverConfig(as.issuer)
    const config = McpCapabilityConfig.parse({ enabled: true, servers: { docs: server }, search: { enabled: false } })
    const encryptor = createAesEncryptor(randomBytes(32))
    const storePath = join(dir, `docs-${hashText(server.url!).slice(0, 16)}.json`)
    await seed(storePath, as.issuer, as.tokenEndpoint, encryptor)
    const store = new FileMcpOAuthStore(storePath, encryptor)
    const provider = createMcpOAuthProvider('docs', server, { storageDir: dir, encryptor })!
    const built = await buildMcpToolProviders(config, {
      oauthStorageDir: dir,
      oauthEncryptor: encryptor,
      clientFactory: async () => { throw new McpAuthorizationRequiredError('docs') },
      backgroundReconnect: { enabled: false }
    })
    const release = as.holdNextRequest()
    const refreshing = auth(provider, { serverUrl: as.serverUrl, fetchFn: provider.oauthFetch })
      .then((result) => result, (error: unknown) => error)
    try {
      await as.firstRequest
      expect(await built.clearOAuthCredentials('docs')).toEqual({ cleared: ['docs'] })
      const cleared = await store.read()
      expect(Object.keys(cleared).sort()).toEqual(['clearEpoch', 'mutationEpoch'])
      release()
      expect(await refreshing).toBeInstanceOf(Error)
      const persisted = await store.read()
      expect(persisted.tokens).toBeUndefined()
      expect(persisted.clientInformation).toBeUndefined()
      expect(persisted.codeVerifier).not.toBe('pkce-verifier')
      expect(persisted.clearEpoch).toBeGreaterThanOrEqual(1)
    } finally {
      release()
      await refreshing
      await built.close()
    }
  })

  it.each([
    { name: 'rotated access token', fixedAccessToken: undefined },
    { name: 'reused access token', fixedAccessToken: 'same-access' }
  ])('does not let a late SDK acknowledgement overwrite a newer grant with $name', async ({ fixedAccessToken }) => {
    const as = await startServer({ fixedAccessToken })
    cleanups.push(() => as.close())
    const dir = await root('mcp-oauth-late-ack-')
    const storePath = join(dir, 'docs-oauth.json')
    await seed(storePath, as.issuer, as.tokenEndpoint)
    const server = serverConfig(as.issuer)
    const first = providerAt(server, storePath)
    const second = providerAt(server, storePath)
    const ack = holdFirstAcknowledgement(first)
    const firstRun = auth(first, { serverUrl: as.serverUrl, fetchFn: first.oauthFetch })
    try {
      await ack.reached
      expect((await new FileMcpOAuthStore(storePath).read()).tokens?.refresh_token).toBe('r1')
      expect(await auth(second, { serverUrl: as.serverUrl, fetchFn: second.oauthFetch })).toBe('AUTHORIZED')
      const newest = await new FileMcpOAuthStore(storePath).read()
      expect(newest.tokens).toMatchObject({
        access_token: fixedAccessToken ?? 'a2', refresh_token: 'r2', id_token: 'id2'
      })
      expect(newest.lastRefresh).toMatchObject({ spentRefreshToken: 'r1', accessToken: fixedAccessToken ?? 'a2' })
      ack.release()
      expect(await firstRun).toBe('AUTHORIZED')
      expect(await new FileMcpOAuthStore(storePath).read()).toEqual(newest)
    } finally {
      ack.release()
      await firstRun
    }
  })

  it('preserves a new authorization using the same access token as a pending old refresh', async () => {
    const as = await startServer()
    cleanups.push(() => as.close())
    const dir = await root('mcp-oauth-new-grant-')
    const storePath = join(dir, 'docs-oauth.json')
    await seed(storePath, as.issuer, as.tokenEndpoint)
    const server = serverConfig(as.issuer)
    const provider = providerAt(server, storePath)
    const revoker = providerAt(server, storePath)
    const ack = holdFirstAcknowledgement(provider)
    const firstRun = auth(provider, { serverUrl: as.serverUrl, fetchFn: provider.oauthFetch })
    try {
      await ack.reached
      await revoker.clearCredentials()
      await provider.saveTokens({
        access_token: 'a1', refresh_token: 'new-refresh', token_type: 'Bearer', issuer: as.issuer
      })
      const newest = await new FileMcpOAuthStore(storePath).read()
      expect(newest.tokens?.refresh_token).toBe('new-refresh')
      ack.release()
      expect(await firstRun).toBe('AUTHORIZED')
      expect(await new FileMcpOAuthStore(storePath).read()).toEqual(newest)
    } finally {
      ack.release()
      await firstRun
    }
  })

  it('saves a fresh authorization even when it reuses the last acknowledged token pair', async () => {
    const as = await startServer()
    cleanups.push(() => as.close())
    const dir = await root('mcp-oauth-reused-grant-')
    const storePath = join(dir, 'docs-oauth.json')
    await seed(storePath, as.issuer, as.tokenEndpoint)
    const provider = providerAt(serverConfig(as.issuer), storePath)
    expect(await auth(provider, { serverUrl: as.serverUrl, fetchFn: provider.oauthFetch })).toBe('AUTHORIZED')
    await provider.recordAuthorizationError('previous error')
    await provider.saveTokens({
      access_token: 'a1', refresh_token: 'r1', token_type: 'Bearer', issuer: as.issuer,
      expires_in: 1800, scope: 'new-scope'
    })
    const persisted = await new FileMcpOAuthStore(storePath).read()
    expect(persisted.tokens).toMatchObject({ access_token: 'a1', refresh_token: 'r1', expires_in: 1800, scope: 'new-scope' })
    expect(persisted.lastError).toBeUndefined()
  })

  it('retains an outstanding acknowledgement even after many newer refreshes on the same provider', { timeout: 15_000 }, async () => {
    const as = await startServer()
    cleanups.push(() => as.close())
    const dir = await root('mcp-oauth-many-acks-')
    const storePath = join(dir, 'docs-oauth.json')
    await seed(storePath, as.issuer, as.tokenEndpoint)
    const provider = providerAt(serverConfig(as.issuer), storePath)
    const ack = holdFirstAcknowledgement(provider)
    const firstRun = auth(provider, { serverUrl: as.serverUrl, fetchFn: provider.oauthFetch })
    try {
      await ack.reached
      for (let i = 0; i < 33; i += 1) {
        expect(await auth(provider, { serverUrl: as.serverUrl, fetchFn: provider.oauthFetch })).toBe('AUTHORIZED')
      }
      const newest = await new FileMcpOAuthStore(storePath).read()
      expect(newest.tokens?.refresh_token).toBe('r34')
      ack.release()
      expect(await firstRun).toBe('AUTHORIZED')
      expect(await new FileMcpOAuthStore(storePath).read()).toEqual(newest)
    } finally {
      ack.release()
      await firstRun
    }
  })

  it.runIf(process.platform !== 'win32')('treats a symlinked credential path as one coordination domain', async () => {
    const as = await startServer()
    cleanups.push(() => as.close())
    const dir = await root('mcp-oauth-symlink-')
    const realDir = join(dir, 'real')
    await mkdir(realDir)
    const linkDir = join(dir, 'link')
    await symlink(realDir, linkDir, 'dir')
    const realPath = join(realDir, 'docs-oauth.json')
    const linkPath = join(linkDir, 'docs-oauth.json')

    // Before the file exists: the identity comes from the real parent directory.
    const absentReal = new FileMcpOAuthStore(realPath)
    const absentLink = new FileMcpOAuthStore(linkPath)
    expect(absentLink.physicalPath).toBe(absentReal.physicalPath)
    expect(mcpOAuthCredentialResource(linkPath)).toBe(mcpOAuthCredentialResource(realPath))
    expect(fileMutationLockRoot(linkPath)).toBe(fileMutationLockRoot(realPath))

    // After it exists, and through a freshly constructed instance.
    await seed(realPath, as.issuer, as.tokenEndpoint)
    expect(new FileMcpOAuthStore(linkPath).physicalPath).toBe(absentReal.physicalPath)

    // A revocation through one path stops a refresh started through the other.
    const signal = absentLink.revocationSignal()
    absentReal.cancelInFlightRefresh()
    expect(signal.aborted).toBe(true)

    // One credential section: the second path cannot enter while the first holds it.
    let enterFirst!: () => void
    const firstEntered = new Promise<void>((resolve) => { enterFirst = resolve })
    let releaseFirst!: () => void
    const firstHold = new Promise<void>((resolve) => { releaseFirst = resolve })
    const first = absentReal.runExclusive(async () => {
      enterFirst()
      await firstHold
    })
    await firstEntered
    let secondEntered = false
    const second = absentLink.runExclusive(async () => { secondEntered = true })
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(secondEntered).toBe(false)
    releaseFirst()
    await first
    await second
    expect(secondEntered).toBe(true)

    // And one refresh transaction: two connections, two paths, one token request.
    const server = serverConfig(as.issuer)
    const viaReal = providerAt(server, realPath)
    const viaLink = providerAt(server, linkPath)
    const results = await Promise.all([
      auth(viaReal, { serverUrl: as.serverUrl, fetchFn: viaReal.oauthFetch }),
      auth(viaLink, { serverUrl: as.serverUrl, fetchFn: viaLink.oauthFetch })
    ])
    expect(results).toEqual(['AUTHORIZED', 'AUTHORIZED'])
    expect(as.requests).toHaveLength(1)
  })

  it.runIf(process.platform !== 'win32')('serializes credential writes across processes with different TMPDIR', async () => {
    const { buildSync } = await import('esbuild')
    const dir = await root('mcp-oauth-proc-')
    const tmpA = join(dir, 'tmp-a')
    const tmpB = join(dir, 'tmp-b')
    await mkdir(tmpA, { recursive: true })
    await mkdir(tmpB, { recursive: true })
    const credential = join(dir, 'data', 'docs-oauth.json')
    await mkdir(dirname(credential), { recursive: true })
    await writeFile(credential, '{}\n')
    const logPath = join(dir, 'order.log')
    const workerPath = join(dir, 'worker.mjs')
    buildSync({
      entryPoints: [WORKER_SOURCE],
      outfile: workerPath,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      logLevel: 'silent'
    })

    const run = (label: string, tmp: string) => execFileAsync(
      process.execPath,
      [workerPath, credential, logPath, label, '500'],
      { env: { ...process.env, TMPDIR: tmp } }
    )
    await Promise.all([run('a', tmpA), run('b', tmpB)])

    const lines = (await readFile(logPath, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(4)
    const [firstLabel] = lines[0].split(':')
    const [secondLabel] = lines[2].split(':')
    expect(new Set([firstLabel, secondLabel])).toEqual(new Set(['a', 'b']))
    // No interleaving: the lock is one domain, not one per TMPDIR.
    expect(lines[0]).toBe(`${firstLabel}:enter`)
    expect(lines[1]).toBe(`${firstLabel}:exit`)
    expect(lines[2]).toBe(`${secondLabel}:enter`)
    expect(lines[3]).toBe(`${secondLabel}:exit`)
  })
})
