import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { auth } from '@modelcontextprotocol/client'
import { afterEach, describe, expect, it } from 'vitest'
import { McpCapabilityConfig, type McpServerConfig } from '../../contracts/capabilities.js'
import { fileMutationLockRoot } from './file-mutation-queue.js'
import { FileMcpOAuthProvider } from './mcp-oauth-provider.js'
import { FileMcpOAuthStore, mcpOAuthCredentialResource } from './mcp-oauth-store.js'

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
  close: () => Promise<void>
}

async function startServer(): Promise<FakeServer> {
  const requests: Array<URLSearchParams> = []
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
  if (typeof address !== 'object' || !address) throw new Error('fake authorization server did not bind')
  issuer = `http://127.0.0.1:${address.port}`
  return {
    issuer,
    serverUrl: new URL(`${issuer}/mcp`),
    tokenEndpoint: `${issuer}/token`,
    requests,
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

async function seed(storePath: string, issuer: string, tokenEndpoint: string): Promise<void> {
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
    tokens: { access_token: 'a0', token_type: 'Bearer', refresh_token: 'r0', issuer }
  }))
}

function providerAt(server: McpServerConfig, storePath: string): FileMcpOAuthProvider {
  return new FileMcpOAuthProvider('docs', server, storePath, () => undefined)
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

    // Two SDK authorization runs on the same provider share one refresh result.
    const results = await Promise.all([
      auth(provider, { serverUrl: as.serverUrl, fetchFn: provider.oauthFetch }),
      auth(provider, { serverUrl: as.serverUrl, fetchFn: provider.oauthFetch })
    ])
    expect(results).toEqual(['AUTHORIZED', 'AUTHORIZED'])
    expect(as.requests).toHaveLength(1)
    expect((await new FileMcpOAuthStore(storePath).read()).tokens?.access_token).toBe('a1')

    // The second acknowledgement is still in flight when the user revokes. It
    // must not recreate the credentials the refresh just produced.
    await revoker.clearCredentials()
    await provider.saveTokens(
      { access_token: 'a1', token_type: 'Bearer', refresh_token: 'r1', issuer: as.issuer },
      { issuer: as.issuer }
    )
    const persisted = await new FileMcpOAuthStore(storePath).read()
    expect(persisted.tokens).toBeUndefined()
    expect(persisted.clearEpoch).toBeGreaterThanOrEqual(1)
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
