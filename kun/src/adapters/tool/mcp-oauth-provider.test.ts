import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { McpServerConfig } from '../../contracts/capabilities.js'
import { defaultMcpOAuthRedirectPort, FileMcpOAuthProvider } from './mcp-oauth-provider.js'
import { FileMcpOAuthStore } from './mcp-oauth-store.js'

const remoteServer: McpServerConfig = {
  enabled: true,
  transport: 'streamable-http',
  url: 'https://mcp.example.test/mcp',
  headers: {},
  args: [],
  env: {},
  workspaceRoots: [],
  trustedWorkspaceRoots: [],
  timeoutMs: 30_000,
  trustScope: 'user',
  oauth: {
    enabled: true,
    scopes: [],
    callbackTimeoutMs: 5_000
  }
}

async function withStore<T>(fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'kun-oauth-provider-'))
  try {
    return await fn(join(dir, 'credentials.json'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('defaultMcpOAuthRedirectPort', () => {
  it('maps a server identity to a stable private-range port', () => {
    const first = defaultMcpOAuthRedirectPort('docs', 'https://mcp.example.test')
    const repeated = defaultMcpOAuthRedirectPort('docs', 'https://mcp.example.test')
    const different = defaultMcpOAuthRedirectPort('issues', 'https://mcp.example.test')

    expect(repeated).toBe(first)
    expect(first).toBeGreaterThanOrEqual(49_152)
    expect(first).toBeLessThan(61_152)
    expect(different).not.toBe(first)
  })

  it('withholds legacy unstamped tokens until a fresh authorization stamps the issuer', async () => {
    await withStore(async (path) => {
      const store = new FileMcpOAuthStore(path)
      await store.update((state) => ({
        ...state,
        tokens: { access_token: 'legacy', token_type: 'bearer' }
      }))
      const provider = new FileMcpOAuthProvider('docs', remoteServer, path)
      await expect(provider.tokens({ issuer: 'https://auth.example.test' })).resolves.toBeUndefined()
      await expect(provider.tokens()).resolves.toBeUndefined()
      await expect(store.read()).resolves.toMatchObject({ tokens: { access_token: 'legacy' } })

      await provider.saveTokens(
        { access_token: 'renewed', token_type: 'bearer' },
        { issuer: 'https://auth.example.test' }
      )
      await expect(store.read()).resolves.toMatchObject({
        tokens: { access_token: 'renewed', issuer: 'https://auth.example.test' }
      })
    })
  })

  it('does not return credentials stamped for a different issuer', async () => {
    await withStore(async (path) => {
      const provider = new FileMcpOAuthProvider('docs', remoteServer, path)
      await provider.saveTokens(
        { access_token: 'issuer-a', token_type: 'bearer' },
        { issuer: 'https://issuer-a.example.test' }
      )

      await expect(provider.tokens({ issuer: 'https://issuer-b.example.test' })).resolves.toBeUndefined()
      await expect(provider.tokens()).resolves.toMatchObject({ access_token: 'issuer-a' })
    })
  })

  it('preserves issuer callback parameters for SDK validation', async () => {
    await withStore(async (path) => {
      const redirectPort = await freePort()
      const provider = new FileMcpOAuthProvider(
        'docs',
        {
          ...remoteServer,
          oauth: { ...remoteServer.oauth!, redirectPort }
        },
        path,
        async () => undefined,
        undefined,
        true
      )
      const state = provider.state()
      await provider.redirectToAuthorization(new URL('https://auth.example.test/authorize'))
      const issuer = 'https://auth.example.test'
      const callback = new URL(provider.redirectUrl)
      callback.searchParams.set('code', 'authorization-code')
      callback.searchParams.set('state', state)
      callback.searchParams.set('iss', issuer)
      const response = await fetch(callback)

      expect(response.status).toBe(200)
      const params = await provider.waitForAuthorizationCallback()
      expect(params.get('code')).toBe('authorization-code')
      expect(params.get('iss')).toBe(issuer)
    })
  })
})

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}
