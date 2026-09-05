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

describe('MCP tool provider', () => {

it('treats server-provided read-only hints as neither approval nor sandbox authority', async () => {
    let calls = 0
    const config = KunCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          github: { transport: 'stdio', command: 'node', trustScope: 'user' }
        }
      }
    })
    const client: McpClientLike = {
      async listTools() {
        return {
          tools: [{ name: 'mutate', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }]
        }
      },
      async callTool() {
        calls += 1
        return { ok: true }
      },
      async close() {}
    }
    const built = await buildMcpToolProviders(config.mcp, { clientFactory: async () => client })
    const direct = built.providers.find((provider) => provider.id === 'mcp:github')
    const tool = direct?.tools.find((candidate) => candidate.name === 'mcp_github_mutate')
    expect(tool).toMatchObject({ policy: 'on-request', toolKind: 'command_execution' })
    const host = new LocalToolHost({ registry: new CapabilityRegistry(built.providers) })
    const context = { ...buildContext('/tmp/project'), sandboxMode: 'read-only' as const }

    expect((await host.listTools(context)).map((candidate) => candidate.name)).not.toContain('mcp_github_mutate')
    const result = await host.execute({
      callId: 'mcp_readonly',
      toolName: 'mcp_github_mutate',
      arguments: {}
    }, context)
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      isError: true,
      output: { code: 'sandbox_command_blocked' }
    })
    expect(calls).toBe(0)
  })

it('keeps blocked MCP servers out of the shared resource facade', async () => {
    let resourceCalls = 0
    const config = KunCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          github: { transport: 'stdio', command: 'node', trustScope: 'user' }
        }
      }
    })
    const client: McpClientLike = {
      async listTools() { return { tools: [] } },
      async callTool() { return { ok: true } },
      async listResources() {
        resourceCalls += 1
        return { resources: [{ uri: 'file:///secret' }] }
      },
      async close() {}
    }
    const built = await buildMcpToolProviders(config.mcp, { clientFactory: async () => client })
    const facade = built.providers.find((provider) => provider.id === 'mcp:facade')
    const tool = facade?.tools.find((candidate) => candidate.name === 'mcp_list_resources')
    const context = {
      ...buildContext('/tmp/project'),
      blockedProviderIds: ['mcp:github']
    }

    expect(tool).toMatchObject({ toolKind: 'command_execution' })
    expect(tool?.shouldAdvertise?.(context)).toBe(false)
    await expect(tool?.execute({}, context)).resolves.toMatchObject({
      output: { error: expect.stringContaining('No connected MCP server') },
      isError: true
    })
    expect(resourceCalls).toBe(0)
  })

it('requires approval before invoking facade resource and prompt RPCs', async () => {
    let resourceCalls = 0
    let promptCalls = 0
    const config = KunCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          github: { transport: 'stdio', command: 'node', trustScope: 'user' }
        }
      }
    })
    const client: McpClientLike = {
      async listTools() { return { tools: [] } },
      async callTool() { return { ok: true } },
      async readResource() {
        resourceCalls += 1
        return { contents: [] }
      },
      async getPrompt() {
        promptCalls += 1
        return { messages: [] }
      },
      async close() {}
    }
    const built = await buildMcpToolProviders(config.mcp, { clientFactory: async () => client })
    const facade = built.providers.find((provider) => provider.id === 'mcp:facade')
    expect(facade?.tools).toHaveLength(5)
    expect(facade?.tools.every((tool) => tool.policy === 'on-request')).toBe(true)

    const host = new LocalToolHost({ registry: new CapabilityRegistry(built.providers) })
    const context = {
      ...buildContext('/tmp/project'),
      approvalPolicy: 'on-request' as const,
      awaitApproval: async () => 'deny' as const
    }
    const resource = await host.execute({
      callId: 'facade_resource',
      toolName: 'mcp_read_resource',
      arguments: { uri: 'file:///secret' }
    }, context)
    const prompt = await host.execute({
      callId: 'facade_prompt',
      toolName: 'mcp_get_prompt',
      arguments: { name: 'summarize', arguments: { secret: 'no' } }
    }, context)

    expect(resource.item).toMatchObject({
      kind: 'tool_result',
      isError: true,
      output: { code: 'approval_denied' }
    })
    expect(prompt.item).toMatchObject({
      kind: 'tool_result',
      isError: true,
      output: { code: 'approval_denied' }
    })
    expect(resourceCalls).toBe(0)
    expect(promptCalls).toBe(0)
  })

it('reconnects without replaying a mid-flight MCP tool call', async () => {
    let factories = 0
    let closes = 0
    const config = KunCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          github: {
            transport: 'stdio',
            command: 'node',
            trustScope: 'workspace',
            trustedWorkspaceRoots: ['/tmp/project']
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => {
        factories += 1
        const instance = factories
        return {
          async listTools() {
            return {
              tools: [
                {
                  name: 'read',
                  inputSchema: { type: 'object' },
                  annotations: { readOnlyHint: true }
                }
              ]
            }
          },
          async callTool() {
            if (instance === 1) throw new Error('stale connection')
            return { ok: true, instance }
          },
          async close() {
            closes += 1
          }
        }
      }
    })
    const host = new LocalToolHost({ registry: new CapabilityRegistry(built.providers) })
    const result = await host.execute({
      callId: 'call_1',
      toolName: 'mcp_call',
      arguments: { toolId: 'mcp_github_read', arguments: {} }
    }, buildContext('/tmp/project'))

    expect(factories).toBe(2)
    expect(closes).toBe(1)
    expect(result.item.kind === 'tool_result' ? result.item.output : {}).toMatchObject({
      code: 'tool_execution_failed',
      error: expect.stringContaining('result is unknown')
    })
  })

it('surfaces deterministic MCP protocol errors as tool results without reconnecting', async () => {
    let factories = 0
    const config = KunCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          github: {
            transport: 'stdio',
            command: 'node',
            trustScope: 'workspace',
            trustedWorkspaceRoots: ['/tmp/project']
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => {
        factories += 1
        return {
          async listTools() {
            return {
              tools: [
                {
                  name: 'search',
                  inputSchema: { type: 'object' },
                  annotations: { readOnlyHint: true }
                }
              ]
            }
          },
          async callTool() {
            throw new Error('MCP error -32603: Validation Error: Validation Failed')
          },
          async close() {}
        }
      }
    })
    const host = new LocalToolHost({ registry: new CapabilityRegistry(built.providers) })
    const result = await host.execute({
      callId: 'call_1',
      toolName: 'mcp_call',
      arguments: { toolId: 'mcp_github_search', arguments: {} }
    }, buildContext('/tmp/project'))

    expect(factories).toBe(1)
    expect(result.item.kind).toBe('tool_result')
    if (result.item.kind !== 'tool_result') throw new Error('expected tool_result')
    expect(result.item.isError).toBe(true)
    expect(result.item.output).toMatchObject({
      code: 'tool_execution_failed',
      error: expect.stringContaining('-32603')
    })
  })

it('recovers a server that lost the startup connect race via background reconnect (issue #342)', async () => {
    let factories = 0
    const config = KunCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          github: {
            transport: 'stdio',
            command: 'node',
            trustScope: 'workspace',
            trustedWorkspaceRoots: ['/tmp/project']
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      delay: async () => undefined,
      backgroundReconnect: { baseDelayMs: 0, maxDelayMs: 0 },
      clientFactory: async () => {
        factories += 1
        if (factories === 1) {
          // Mimics the fast startup race timing out on a slow npx cold start.
          throw new Error('MCP server "github" did not connect within 10000ms during startup')
        }
        return {
          async listTools() {
            return {
              tools: [{ name: 'read', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }]
            }
          },
          async callTool() {
            return { ok: true }
          },
          async close() {
            // no-op
          }
        }
      }
    })

    // Startup pass: the server failed. The stable MCP gateway is still present
    // so later catalog updates have a callable entry point.
    expect(built.diagnostics).toEqual([expect.objectContaining({ id: 'github', status: 'error' })])
    expect(built.providers.map((provider) => provider.id)).toEqual(['mcp:search', 'mcp:facade'])

    const registry = new CapabilityRegistry(built.providers)
    await built.startBackgroundReconnect({ register: (provider) => registry.registerProvider(provider), unregister: () => undefined })

    // The background retry connected, updated the gateway catalog, and flipped
    // the diagnostic without a runtime restart.
    expect(factories).toBe(2)
    expect(built.diagnostics).toEqual([
      expect.objectContaining({ id: 'github', status: 'connected', toolCount: 1 })
    ])
    const host = new LocalToolHost({ registry })
    const result = await host.execute({
      callId: 'call_1',
      toolName: 'mcp_call',
      arguments: { toolId: 'mcp_github_read', arguments: {} }
    }, buildContext('/tmp/project'))
    expect(result.item.kind === 'tool_result' ? result.item.output : {}).toMatchObject({
      result: { ok: true }
    })
  })

it('does not retry when every MCP server connected at startup', async () => {
    let factories = 0
    const config = KunCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          github: {
            transport: 'stdio',
            command: 'node',
            trustScope: 'workspace',
            trustedWorkspaceRoots: ['/tmp/project']
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      delay: async () => undefined,
      clientFactory: async () => {
        factories += 1
        return fakeClient()
      }
    })
    await built.startBackgroundReconnect({
      register: () => {
        throw new Error('register should not be called when nothing failed')
      },
      unregister: () => undefined
    })
    expect(factories).toBe(1)
  })

it('reports catalog drift after refreshing MCP search records', async () => {
    let expanded = false
    const config = KunCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        search: { enabled: true, mode: 'search' },
        servers: {
          github: {
            transport: 'stdio',
            command: 'node',
            trustScope: 'workspace',
            trustedWorkspaceRoots: ['/tmp/project']
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => ({
        async listTools() {
          return {
            tools: [
              { name: 'search_issues', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
              ...(expanded ? [{ name: 'create_issue', inputSchema: { type: 'object' } }] : [])
            ]
          }
        },
        async callTool() {
          return { ok: true }
        },
        async close() {
          // no-op
        }
      })
    })
    const host = new LocalToolHost({ registry: new CapabilityRegistry(built.providers) })
    expanded = true
    const refresh = await host.execute({
      callId: 'call_refresh',
      toolName: 'mcp_refresh_catalog',
      arguments: {}
    }, buildContext('/tmp/project'))

    expect(refresh.item.kind === 'tool_result' ? refresh.item.output : {}).toMatchObject({
      totalIndexed: 2,
      catalogDrift: true
    })
  })

it('redacts secrets from MCP diagnostics', async () => {
    const config = KunCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          broken: {
            transport: 'streamable-http',
            url: 'https://mcp.example.test/mcp',
            headers: { Authorization: 'Bearer config-secret' },
            trustScope: 'user'
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => {
        throw new Error('connect failed: authorization: Bearer runtime-secret token=other-secret')
      }
    })

    const encoded = JSON.stringify(built.diagnostics)
    expect(encoded).toContain(REDACTED_SECRET)
    expect(encoded).not.toContain('runtime-secret')
    expect(encoded).not.toContain('other-secret')
    expect(encoded).not.toContain('config-secret')
  })

it('keeps OAuth disabled unless remote MCP servers opt in', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-mcp-oauth-'))
    const config = KunCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          remote_docs: {
            transport: 'streamable-http',
            url: 'https://mcp.example.test/mcp',
            trustScope: 'user'
          }
        }
      }
    })
    const server = config.mcp.servers.remote_docs as McpServerConfig

    expect(createMcpOAuthProvider('remote_docs', server, { storageDir: root })).toBeUndefined()
    await expect(listMcpOAuthDiagnostics(config.mcp, { storageDir: root })).resolves.toEqual([])
  })

it('persists remote MCP OAuth client state outside the server config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-mcp-oauth-'))
    const server = KunCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          google_drive: {
            transport: 'streamable-http',
            url: 'https://drivemcp.googleapis.com/mcp/v1',
            trustScope: 'user',
            oauth: {
              scopes: ['drive.readonly']
            }
          }
        }
      }
    }).mcp.servers.google_drive as McpServerConfig
    const storagePath = join(root, 'google_drive.json')
    const provider = new FileMcpOAuthProvider('google_drive', server, storagePath, async () => undefined)

    await provider.saveClientInformation({ client_id: 'client-1', client_secret: 'secret-1' })
    await provider.saveTokens({ access_token: 'access-1', token_type: 'Bearer', refresh_token: 'refresh-1' })
    await provider.saveCodeVerifier('verifier-1')

    const restored = new FileMcpOAuthProvider('google_drive', server, storagePath, async () => undefined)
    expect(await restored.clientInformation()).toMatchObject({ client_id: 'client-1' })
    expect(await restored.tokens()).toMatchObject({ access_token: 'access-1', refresh_token: 'refresh-1' })
    expect(await restored.codeVerifier()).toBe('verifier-1')
    expect(restored.clientMetadata.scope).toBe('drive.readonly')
  })

it('reports and clears remote MCP OAuth credential state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-mcp-oauth-'))
    const config = KunCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          google_drive: {
            transport: 'streamable-http',
            url: 'https://drivemcp.googleapis.com/mcp/v1',
            trustScope: 'user',
            oauth: {
              scopes: ['drive.readonly']
            }
          }
        }
      }
    })
    const server = config.mcp.servers.google_drive as McpServerConfig
    const provider = createMcpOAuthProvider('google_drive', server, { storageDir: root })
    expect(provider).toBeDefined()
    await provider?.saveTokens({ access_token: 'access-1', token_type: 'Bearer', refresh_token: 'refresh-1' })

    const before = await listMcpOAuthDiagnostics(config.mcp, { storageDir: root })
    expect(before).toHaveLength(1)
    expect(before[0]).toMatchObject({
      serverId: 'google_drive',
      configured: true,
      status: 'authorized',
      hasTokens: true,
      hasRefreshToken: true
    })

    const built = await buildMcpToolProviders(config.mcp, {
      oauthStorageDir: root,
      clientFactory: async () => fakeClient()
    })
    await built.close()
    expect(built.oauth[0]).toMatchObject({
      serverId: 'google_drive',
      status: 'authorized'
    })
    await expect(clearMcpOAuthCredentials(config.mcp, {
      storageDir: root,
      serverId: 'google_drive'
    })).resolves.toEqual({ cleared: ['google_drive'] })
    expect((await listMcpOAuthDiagnostics(config.mcp, { storageDir: root }))[0]).toMatchObject({
      status: 'empty',
      hasTokens: false
    })
  })

})
