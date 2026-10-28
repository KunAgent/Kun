import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auth } from '@modelcontextprotocol/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpCapabilityConfig, type McpServerConfig } from '../../contracts/capabilities.js'
import { configureManagerAtomicJsonClient } from '../../extensions/atomic-json.js'
import { ManagerSharedDataStore } from '../../manager/shared-data-store.js'
import { buildServiceManagerRouter, ServiceManagerState } from '../../manager/service-manager.js'
import { dispatchRequest } from '../../server/http-server.js'
import { FileMcpOAuthProvider } from './mcp-oauth-provider.js'
import { FileMcpOAuthStore } from './mcp-oauth-store.js'

/**
 * Integration regression against a real Service Manager HTTP surface.
 *
 * `buildServiceManagerRouter` + `ServiceManagerState` + `ManagerSharedDataStore`
 * are the production Manager components; the test only mounts them on a real
 * socket and controls one variable: when the server-side atomic-JSON commit is
 * allowed to run. Everything else (lease acquisition, fencing token, revision
 * CAS, encryption-free credential JSON) is the real path.
 */

const MANAGER_TOKEN = 'manager-secret'
const MANAGER_FLAVOR = 'development'

/** Bundled into a repo-local temp dir so bare imports resolve from node_modules. */
const SINGLEFLIGHT_WORKER = fileURLToPath(
  new URL('../../../tests/fixtures/mcp-oauth-manager-singleflight-worker.ts', import.meta.url)
)
const REPO_NODE_MODULES = fileURLToPath(new URL('../../../../node_modules', import.meta.url))

async function waitForPaths(paths: string[], timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!paths.every((path) => existsSync(path))) {
    if (Date.now() > deadline) throw new Error('workers did not reach the barrier')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function safeJson(payload: Buffer): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(payload.toString('utf8')) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

type ManagerHarness = {
  baseUrl: string
  dataDir: string
  /** Park the next server-side atomic-JSON commit until `releaseCommit()`. */
  holdCommits: () => void
  commitParked: Promise<void>
  releaseCommit: () => void
  /** Atomic-JSON writes the Manager accepted, in commit order. */
  writes: Array<{ tokens?: { access_token?: string } }>
  /** Non-2xx answers the Manager produced (for example a stale fence). */
  rejections: Array<{ status: number; code?: string }>
  close: () => Promise<void>
}

async function startManager(): Promise<ManagerHarness> {
  const dataDir = await mkdtemp(join(tmpdir(), 'mcp-oauth-manager-'))
  const store = await ManagerSharedDataStore.create(dataDir)
  const parked = deferred()
  let hold = false
  const waiters: Array<() => void> = []
  const writes: ManagerHarness['writes'] = []
  const rejections: ManagerHarness['rejections'] = []

  const sharedData = new Proxy(store, {
    get(target, property, receiver) {
      if (property === 'writeAtomicJson') {
        return async (input: Parameters<ManagerSharedDataStore['writeAtomicJson']>[0]) => {
          if (hold) {
            parked.resolve()
            await new Promise<void>((resolve) => { waiters.push(resolve) })
          }
          return await target.writeAtomicJson(input)
        }
      }
      const value = Reflect.get(target, property, receiver) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    }
  })

  const router = buildServiceManagerRouter({
    managerToken: MANAGER_TOKEN,
    instanceId: 'manager-a',
    startedAt: new Date().toISOString(),
    state: new ServiceManagerState(),
    flushState: async () => undefined,
    sharedData: sharedData as unknown as ManagerSharedDataStore
  })

  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      void (async () => {
        try {
          const body = Buffer.concat(chunks)
          const forwarded = new Request(`http://127.0.0.1${request.url ?? '/'}`, {
            method: request.method ?? 'GET',
            headers: request.headers as Record<string, string>,
            ...(body.length ? { body } : {})
          })
          const handled = await dispatchRequest(router, forwarded)
          const payload = Buffer.from(await handled.arrayBuffer())
          if (forwarded.url.endsWith('/v1/data/atomic-json/write')) {
            if (handled.status >= 400) {
              const parsed = safeJson(payload)
              rejections.push({ status: handled.status, ...(typeof parsed?.code === 'string' ? { code: parsed.code } : {}) })
            } else {
              try {
                const value: unknown = (JSON.parse(body.toString('utf8')) as { value?: unknown }).value
                writes.push(value && typeof value === 'object' && !Array.isArray(value)
                  ? value as ManagerHarness['writes'][number]
                  : {})
              } catch {
                writes.push({})
              }
            }
          }
          if (response.destroyed) return
          response.writeHead(handled.status, {
            'content-type': handled.headers.get('content-type') ?? 'application/json'
          })
          response.end(payload)
        } catch (error) {
          // The runtime aborted a request (revocation) after the Manager had
          // already parsed it. That failure belongs to the server side of the
          // test: record it instead of leaking an unhandled rejection.
          rejections.push({ status: 0, ...(error instanceof Error ? { code: error.message.slice(0, 64) } : {}) })
          if (!response.destroyed) response.destroy()
        }
      })()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (typeof address !== 'object' || !address) throw new Error('manager harness did not bind')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    dataDir,
    holdCommits: () => { hold = true },
    commitParked: parked.promise,
    writes,
    rejections,
    releaseCommit: () => {
      hold = false
      for (const release of waiters.splice(0)) release()
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections?.()
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

type FakeAuthorizationServer = {
  issuer: string
  serverUrl: URL
  tokenEndpoint: string
  requests: Array<URLSearchParams>
  /** Resolves when a token request arrives while a response hold is armed. */
  tokenParked: Promise<void>
  holdNextTokenResponse: () => void
  releaseTokenResponse: () => void
  close: () => Promise<void>
}

async function startAuthorizationServer(): Promise<FakeAuthorizationServer> {
  const requests: Array<URLSearchParams> = []
  const parked = deferred()
  let hold = false
  let releaseResponse: (() => void) | null = null
  let issuer = ''
  let rotation = 0
  let refreshToken = 'r0'
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
        if (hold) {
          hold = false
          parked.resolve()
          await new Promise<void>((resolve) => { releaseResponse = resolve })
        }
        if (params.get('grant_type') !== 'refresh_token' || params.get('refresh_token') !== refreshToken) {
          response.writeHead(400, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ error: 'invalid_grant' }))
          return
        }
        rotation += 1
        refreshToken = `r${rotation}`
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          access_token: `a${rotation}`,
          token_type: 'Bearer',
          refresh_token: refreshToken,
          expires_in: 3600
        }))
        return
      }
      response.writeHead(404)
      response.end()
    })()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (typeof address !== 'object' || !address) throw new Error('authorization server did not bind')
  issuer = `http://127.0.0.1:${address.port}`
  return {
    issuer,
    serverUrl: new URL(`${issuer}/mcp`),
    tokenEndpoint: `${issuer}/token`,
    requests,
    tokenParked: parked.promise,
    holdNextTokenResponse: () => { hold = true },
    releaseTokenResponse: () => {
      releaseResponse?.()
      releaseResponse = null
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

function providerAt(server: McpServerConfig, storePath: string): FileMcpOAuthProvider {
  return new FileMcpOAuthProvider('docs', server, storePath, () => undefined)
}

async function seed(storePath: string, issuer: string, tokenEndpoint: string, accessToken = 'a0'): Promise<void> {
  const store = new FileMcpOAuthStore(storePath)
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
    tokens: { access_token: accessToken, token_type: 'Bearer', refresh_token: 'r0', issuer }
  }))
}

describe('MCP OAuth refresh against a real Service Manager', { timeout: 60_000 }, () => {
  const cleanups: Array<() => Promise<void>> = []

  afterEach(async () => {
    configureManagerAtomicJsonClient(null)
    vi.unstubAllEnvs()
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
  })

  async function harness(): Promise<{
    manager: ManagerHarness
    as: FakeAuthorizationServer
    storePath: string
  }> {
    const manager = await startManager()
    cleanups.push(() => manager.close())
    const as = await startAuthorizationServer()
    cleanups.push(() => as.close())

    vi.stubEnv('KUN_MANAGER_BASE_URL', manager.baseUrl)
    vi.stubEnv('KUN_MANAGER_TOKEN', MANAGER_TOKEN)
    vi.stubEnv('KUN_RUNTIME_INSTANCE_ID', 'runtime-under-test')
    vi.stubEnv('KUN_RUNTIME_FLAVOR', MANAGER_FLAVOR)
    configureManagerAtomicJsonClient({
      baseUrl: manager.baseUrl,
      token: MANAGER_TOKEN,
      dataDir: manager.dataDir
    })

    const storePath = join(manager.dataDir, 'oauth', 'docs-oauth.json')
    await seed(storePath, as.issuer, as.tokenEndpoint)
    return { manager, as, storePath }
  }

  it('persists a refresh through the Manager atomic-JSON write path', async () => {
    const { as, storePath } = await harness()
    const provider = providerAt(serverConfig(as.issuer), storePath)

    expect(await auth(provider, { serverUrl: as.serverUrl, fetchFn: provider.oauthFetch })).toBe('AUTHORIZED')
    expect(as.requests).toHaveLength(1)

    // Read back through the same Manager data plane the runtime uses.
    const persisted = await new FileMcpOAuthStore(storePath).read()
    expect(persisted.tokens?.refresh_token).toBe('r1')
    expect(persisted.tokens?.access_token).toBe('a1')
    expect(persisted.tokens?.issuer).toBe(as.issuer)
    expect(persisted.lastRefresh?.spentRefreshToken).toBe('r0')
  })

  it('cannot resurrect credentials when the Manager commits a refresh after a revocation', async () => {
    const { manager, as, storePath } = await harness()
    const provider = providerAt(serverConfig(as.issuer), storePath)
    const revoker = providerAt(serverConfig(as.issuer), storePath)

    manager.holdCommits()
    const refreshing = auth(provider, { serverUrl: as.serverUrl, fetchFn: provider.oauthFetch })
      .then(() => 'authorized' as const, (error: unknown) => error)
    // The Manager has parsed the write and is holding the commit.
    await manager.commitParked

    // Revocation begins while that commit is still parked. It cancels the
    // runtime-side request, but the Manager will still finish the write, so the
    // delayed commit is genuinely in play rather than a fixture no-op.
    const revoking = revoker.clearCredentials()
    manager.releaseCommit()
    // Both sides must finish: the refresh settles (its late commit is already
    // in flight) and the revocation completes afterwards.
    const [, revokeSettled] = await Promise.allSettled([refreshing, revoking])
    expect(revokeSettled.status).toBe('fulfilled')

    const persisted = await new FileMcpOAuthStore(storePath).read()
    expect(persisted.tokens).toBeUndefined()
    expect(persisted.clearEpoch).toBeGreaterThanOrEqual(1)

    // The delayed commit really reached the Manager (exactly once), and the
    // last accepted write is the revocation that superseded it.
    const accessTokens = manager.writes.map((value) => value.tokens?.access_token)
    expect(accessTokens[0]).toBe('a0')
    expect(accessTokens.filter((token) => token === 'a1')).toHaveLength(1)
    expect(accessTokens.at(-1)).toBeUndefined()
    // A rejected late commit may only surface as a Manager fence/transport
    // outcome captured by the harness - never as an unhandled rejection.
    expect(manager.rejections.every((entry) => entry.status === 0 || entry.status === 409)).toBe(true)
  })

  it('collapses a same-grant refresh across two runtime processes through the Manager lease', async () => {
    const { manager, as, storePath } = await harness()
    const cacheRoot = join(REPO_NODE_MODULES, '.cache')
    await mkdir(cacheRoot, { recursive: true })
    const bundleDir = await mkdtemp(join(cacheRoot, 'mcp-oauth-singleflight-'))
    try {
      const { build } = await import('esbuild')
      const workerPath = join(bundleDir, 'worker.mjs')
      await build({
        entryPoints: [SINGLEFLIGHT_WORKER],
        outfile: workerPath,
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node20',
        packages: 'external',
        logLevel: 'silent'
      })

      const env = {
        ...process.env,
        KUN_MANAGER_BASE_URL: manager.baseUrl,
        KUN_MANAGER_TOKEN: MANAGER_TOKEN,
        KUN_MANAGER_DATA_DIR: manager.dataDir,
        KUN_RUNTIME_FLAVOR: MANAGER_FLAVOR
      }
      const goPath = join(bundleDir, 'go')
      const refreshGo = join(bundleDir, 'refresh.go')
      const refreshA = join(bundleDir, 'refresh-a.ready')
      const refreshB = join(bundleDir, 'refresh-b.ready')
      const before = await new FileMcpOAuthStore(storePath).read()
      type WorkerResult = { outcome: string; accessToken?: string; refreshToken?: string }
      const run = (instanceId: string, readyPath: string, refreshReady: string): Promise<WorkerResult> =>
        new Promise((resolve, reject) => {
          const child = spawn(process.execPath, [
            workerPath, storePath, as.issuer, as.tokenEndpoint, as.serverUrl.toString(), readyPath, goPath,
            refreshReady, refreshGo
          ], {
            env: { ...env, KUN_RUNTIME_INSTANCE_ID: instanceId },
            stdio: ['ignore', 'pipe', 'pipe']
          })
          let out = ''
          let err = ''
          child.stdout?.on('data', (chunk: Buffer) => { out += String(chunk) })
          child.stderr?.on('data', (chunk: Buffer) => { err += String(chunk) })
          child.on('error', reject)
          child.on('exit', (code) => {
            if (code !== 0) {
              reject(new Error(`runtime ${instanceId} exited with ${code}: ${err}`))
              return
            }
            try {
              resolve(JSON.parse(out) as WorkerResult)
            } catch (error) {
              reject(new Error(`runtime ${instanceId} produced ${JSON.stringify(out)}: ${String(error)} ${err}`))
            }
          })
        })

      // Wait for both SDK calls to prepare a refresh using the seeded grant.
      as.holdNextTokenResponse()
      const readyA = join(bundleDir, 'runtime-a.ready')
      const readyB = join(bundleDir, 'runtime-b.ready')
      const runtimeA = run('runtime-a', readyA, refreshA)
      const runtimeB = run('runtime-b', readyB, refreshB)
      await waitForPaths([readyA, readyB])
      await writeFile(goPath, 'go')
      await waitForPaths([refreshA, refreshB])
      await writeFile(refreshGo, 'go')
      await as.tokenParked
      as.releaseTokenResponse()

      const [a, b] = await Promise.all([runtimeA, runtimeB])
      expect(as.requests).toHaveLength(1)
      expect([a.outcome, b.outcome]).toEqual(['AUTHORIZED', 'AUTHORIZED'])
      expect(a.accessToken).toBe(b.accessToken)
      const persisted = await new FileMcpOAuthStore(storePath).read()
      expect(persisted.tokens?.access_token).toBe(a.accessToken)
      expect(persisted.tokens?.refresh_token).toBe(a.refreshToken)
      // The seed uses update() and does not increment these epochs.
      expect(persisted.refreshEpoch).toBe((before.refreshEpoch ?? 0) + 1)
      expect(persisted.mutationEpoch).toBe((before.mutationEpoch ?? 0) + 1)
    } finally {
      await rm(bundleDir, { recursive: true, force: true })
    }
  })

  it('does not let a stale invalidation drop a newer grant', async () => {
    const { as, storePath } = await harness()
    const stale = providerAt(serverConfig(as.issuer), storePath)
    // The old connection read the first grant, then a fresh authorization
    // replaced it (a new access token in the same file).
    expect(await stale.tokens()).toMatchObject({ access_token: 'a0' })
    await seed(storePath, as.issuer, as.tokenEndpoint, 'a-new')

    await stale.invalidateCredentials('tokens')

    const persisted = await new FileMcpOAuthStore(storePath).read()
    expect(persisted.tokens?.access_token).toBe('a-new')
  })
})
