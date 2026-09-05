import { describe, expect, it } from 'vitest'

import { mkdir, mkdtemp } from 'node:fs/promises'

import { createServer, get as httpGet } from 'node:http'

import type { AddressInfo } from 'node:net'

import { tmpdir } from 'node:os'

import { join } from 'node:path'

import { CapabilityRegistry } from '../../src/adapters/tool/capability-registry.js'

import { LocalToolHost } from '../../src/adapters/tool/local-tool-host.js'

import {
  FileMcpOAuthProvider,
  buildMcpStdioEnvironment,
  buildMcpToolProviders,
  clearMcpOAuthCredentials,
  createMcpOAuthProvider,
  formatMcpConnectionError,
  isMcpServerTrusted,
  isMcpServerVisible,
  listMcpOAuthDiagnostics,
  McpAuthorizationRequiredError,
  resolveMcpServerCwd,
  type McpClientLike
} from '../../src/adapters/tool/mcp-tool-provider.js'

import { REDACTED_SECRET } from '../../src/config/secret-redaction.js'

import { KunCapabilitiesConfig, type McpServerConfig } from '../../src/contracts/capabilities.js'

import type { ToolHostContext } from '../../src/ports/tool-host.js'

function buildContext(workspace: string): ToolHostContext {
  return {
    threadId: 'thr_1',
    turnId: 'turn_1',
    workspace,
    threadMode: 'agent',
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

function fakeClient(): McpClientLike {
  return {
    async listTools() {
      return {
        tools: [
          {
            name: 'Search Issues',
            description: 'Search issue tracker',
            inputSchema: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query']
            },
            annotations: { readOnlyHint: true }
          }
        ]
      }
    },
    async callTool(input) {
      return {
        content: [{ type: 'text', text: `called ${input.name}` }],
        structuredContent: input.arguments
      }
    },
    async close() {
      // no-op
    }
  }
}

async function getFreePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
  return address.port
}

async function httpStatus(url: URL): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpGet(url, (response) => {
      response.resume()
      response.on('end', () => resolve(response.statusCode ?? 0))
    })
    request.once('error', reject)
    request.setTimeout(3_000, () => request.destroy(new Error('HTTP request timed out')))
  })
}

describe('mcp oauth diagnostics state machine', () => {

function oauthServer(): McpServerConfig {
    return KunCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          vercel: {
            transport: 'streamable-http',
            url: 'https://mcp.vercel.com',
            trustScope: 'user',
            oauth: { scopes: ['projects.read'] }
          }
        }
      }
    }).mcp.servers.vercel as McpServerConfig
  }

it('reports empty then partial as credential material accrues', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-mcp-oauth-'))
    const provider = new FileMcpOAuthProvider('vercel', oauthServer(), join(root, 'vercel.json'), async () => undefined)

    expect((await provider.diagnostics()).status).toBe('empty')

    await provider.saveCodeVerifier('verifier-1')
    expect((await provider.diagnostics()).status).toBe('partial')
  })

it('treats a saved token with future expiry as authorized and exposes expiresAt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-mcp-oauth-'))
    let clock = 1_700_000_000_000
    const provider = new FileMcpOAuthProvider(
      'vercel',
      oauthServer(),
      join(root, 'vercel.json'),
      async () => undefined,
      () => clock
    )

    await provider.saveTokens({ access_token: 'access-1', token_type: 'Bearer', expires_in: 3600 })
    const diagnostics = await provider.diagnostics()

    expect(diagnostics.status).toBe('authorized')
    expect(diagnostics.expiresAt).toBe(new Date(clock + 3600 * 1000).toISOString())
  })

it('flips to expired once the access token outlives its lifetime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-mcp-oauth-'))
    let clock = 1_700_000_000_000
    const provider = new FileMcpOAuthProvider(
      'vercel',
      oauthServer(),
      join(root, 'vercel.json'),
      async () => undefined,
      () => clock
    )

    await provider.saveTokens({ access_token: 'access-1', token_type: 'Bearer', expires_in: 10, refresh_token: 'refresh-1' })
    clock += 20_000
    const diagnostics = await provider.diagnostics()

    expect(diagnostics.status).toBe('expired')
    expect(diagnostics.hasRefreshToken).toBe(true)
  })

it('surfaces the provider-granted scopes parsed from the token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-mcp-oauth-'))
    const provider = new FileMcpOAuthProvider('vercel', oauthServer(), join(root, 'vercel.json'), async () => undefined)

    await provider.saveTokens({
      access_token: 'access-1',
      token_type: 'Bearer',
      scope: 'projects.read  deployments.read projects.read deployments.write'
    })
    const diagnostics = await provider.diagnostics()

    expect(diagnostics.grantedScopes).toEqual(['projects.read', 'deployments.read', 'deployments.write'])
  })

it('omits grantedScopes when the provider returns no scope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-mcp-oauth-'))
    const provider = new FileMcpOAuthProvider('vercel', oauthServer(), join(root, 'vercel.json'), async () => undefined)

    await provider.saveTokens({ access_token: 'access-1', token_type: 'Bearer' })
    const diagnostics = await provider.diagnostics()

    expect(diagnostics.grantedScopes).toBeUndefined()
  })

it('surfaces a recorded authorization failure as error and clears it on the next token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-mcp-oauth-'))
    const provider = new FileMcpOAuthProvider('vercel', oauthServer(), join(root, 'vercel.json'), async () => undefined)

    await provider.recordAuthorizationError('MCP OAuth authorization failed: access_denied')
    const failed = await provider.diagnostics()
    expect(failed.status).toBe('error')
    expect(failed.lastError).toContain('access_denied')
    expect(failed.lastErrorAt).toBeDefined()

    await provider.saveTokens({ access_token: 'access-1', token_type: 'Bearer' })
    const recovered = await provider.diagnostics()
    expect(recovered.status).toBe('authorized')
    expect(recovered.lastError).toBeUndefined()
  })

it('exposes an authorize entry point that no-ops for unknown servers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-mcp-oauth-'))
    const config = KunCapabilitiesConfig.parse({
      mcp: { enabled: true, servers: { vercel: oauthServer() } }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      oauthStorageDir: root,
      clientFactory: async () => fakeClient()
    })
    await built.close()

    await expect(built.authorizeOAuth('does-not-exist')).resolves.toEqual({
      serverId: 'does-not-exist',
      status: 'disabled',
      authorized: false
    })
  })

it('does not block startup when a remote server needs authorization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-mcp-oauth-'))
    const config = KunCapabilitiesConfig.parse({
      mcp: { enabled: true, servers: { vercel: oauthServer() } }
    })
    let opened = 0
    // A non-interactive startup surfaces a typed "needs authorization" error
    // instead of opening a browser; the build still resolves so the runtime is
    // never blocked on a user completing an OAuth handshake.
    const built = await buildMcpToolProviders(config.mcp, {
      oauthStorageDir: root,
      openExternal: () => {
        opened += 1
      },
      clientFactory: async () => {
        throw new McpAuthorizationRequiredError('vercel')
      }
    })
    await built.close()

    expect(opened).toBe(0)
    const diagnostic = built.diagnostics.find((entry) => entry.id === 'vercel')
    expect(diagnostic?.status).toBe('authorization_required')
    expect(diagnostic?.lastError).toContain('Authorize')
  })

it('refuses to open a browser from a non-interactive provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-mcp-oauth-'))
    const opened: string[] = []
    const server = oauthServer()
    const provider = new FileMcpOAuthProvider('vercel', server, join(root, 'vercel.json'), async (url) => {
      opened.push(url.toString())
    })
    // Default (non-interactive): must throw before opening a browser/callback.
    await expect(provider.redirectToAuthorization(new URL('https://auth.example.test/authorize')))
      .rejects.toThrow(/requires OAuth authorization/)
    expect(opened).toEqual([])
  })

it('connects and registers a server immediately after a successful authorization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-mcp-oauth-'))
    const config = KunCapabilitiesConfig.parse({
      mcp: { enabled: true, servers: { vercel: oauthServer() } }
    })
    let authorizeCalls = 0
    let connectCalls = 0
    const built = await buildMcpToolProviders(config.mcp, {
      oauthStorageDir: root,
      // Startup: the server needs authorization, so the first connect fails and
      // it must not connect/register yet.
      clientFactory: async (serverId) => {
        connectCalls += 1
        if (connectCalls === 1) throw new McpAuthorizationRequiredError(serverId)
        return fakeClient()
      },
      authorize: async (serverId) => {
        authorizeCalls += 1
        return { serverId, status: 'authorized', authorized: true }
      }
    })
    const registry = new CapabilityRegistry(built.providers)
    await built.startBackgroundReconnect({ register: (provider) => registry.registerProvider(provider), unregister: () => undefined })

    const result = await built.authorizeOAuth('vercel')
    await built.close()

    expect(result).toMatchObject({ serverId: 'vercel', authorized: true })
    expect(authorizeCalls).toBe(1)
    // The freshly authorized server is connected and added to the existing MCP
    // gateway catalog.
    expect(built.diagnostics.find((entry) => entry.id === 'vercel')?.status).toBe('connected')
    const host = new LocalToolHost({ registry })
    const call = await host.execute({
      callId: 'call_1',
      toolName: 'mcp_call',
      arguments: { toolId: 'mcp_vercel_search_issues', arguments: {} }
    }, buildContext('/tmp/project'))
    expect(call.item.kind === 'tool_result' ? call.item.output : {}).toMatchObject({
      serverId: 'vercel',
      toolName: 'Search Issues'
    })
  })

it('shares one authorization run per server for concurrent clicks (single-flight)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-mcp-oauth-'))
    const config = KunCapabilitiesConfig.parse({
      mcp: { enabled: true, servers: { vercel: oauthServer() } }
    })
    let authorizeCalls = 0
    const built = await buildMcpToolProviders(config.mcp, {
      oauthStorageDir: root,
      clientFactory: async () => fakeClient(),
      authorize: async (serverId) => {
        authorizeCalls += 1
        await new Promise((resolve) => setTimeout(resolve, 20))
        return { serverId, status: 'authorized', authorized: true }
      }
    })
    await built.startBackgroundReconnect({ register: () => undefined, unregister: () => undefined })

    const [a, b] = await Promise.all([built.authorizeOAuth('vercel'), built.authorizeOAuth('vercel')])
    await built.close()

    expect(authorizeCalls).toBe(1)
    expect(a).toEqual(b)
  })

})
