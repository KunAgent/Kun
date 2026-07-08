import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { createServer, get as httpGet } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CapabilityRegistry } from '../src/adapters/tool/capability-registry.js'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
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
  normalizeMcpToolName,
  resolveMcpServerCwd,
  type McpClientLike
} from '../src/adapters/tool/mcp-tool-provider.js'
import { REDACTED_SECRET } from '../src/config/secret-redaction.js'
import { KunCapabilitiesConfig, type McpServerConfig } from '../src/contracts/capabilities.js'
import type { ToolHostContext } from '../src/ports/tool-host.js'

function buildContext(workspace: string): ToolHostContext {
  return {
    threadId: 'thr_1',
    turnId: 'turn_1',
    workspace,
    threadMode: 'agent',
    approvalPolicy: 'auto',
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
  it('normalizes stable MCP tool names', () => {
    expect(normalizeMcpToolName('GitHub Server', 'Search Issues')).toBe('mcp_github_server_search_issues')
  })

  it('adds common GUI app command paths to stdio MCP environments', () => {
    const env = buildMcpStdioEnvironment({ NODE_ENV: 'test' }, {
      platform: 'darwin',
      baseEnv: {
        PATH: '/usr/bin:/opt/homebrew/bin',
        HOME: '/Users/alice'
      }
    })

    expect(env.NODE_ENV).toBe('test')
    expect(env.PATH?.split(':')).toEqual([
      '/usr/bin',
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/opt/local/bin',
      '/Users/alice/.volta/bin',
      '/Users/alice/.local/bin',
      '/Users/alice/.bun/bin'
    ])
  })

  it('adds nvm node bin directories to stdio MCP environments on Linux', async () => {
    const home = (await mkdtemp(join(tmpdir(), 'kun-nvm-home-'))).replace(/\\/g, '/')
    const nvmBin = `${home}/.nvm/versions/node/v22.23.0/bin`
    await mkdir(nvmBin, { recursive: true })

    const env = buildMcpStdioEnvironment({}, {
      platform: 'linux',
      baseEnv: {
        PATH: '/usr/bin',
        HOME: home
      }
    })

    expect(env.PATH).toContain(nvmBin)
  })

  it('keeps explicitly configured stdio MCP PATH values ahead of common paths', () => {
    const env = buildMcpStdioEnvironment({ Path: 'C:\\Tools' }, {
      platform: 'win32',
      baseEnv: {
        APPDATA: 'C:\\Users\\alice\\AppData\\Roaming',
        ProgramFiles: 'C:\\Program Files',
        PATH: 'C:\\Windows\\System32'
      }
    })

    expect(env.Path?.split(';')).toEqual([
      'C:\\Tools',
      'C:\\Users\\alice\\AppData\\Roaming\\npm',
      'C:\\Program Files\\nodejs'
    ])
  })

  it('formats missing stdio MCP commands with an actionable PATH hint', () => {
    const server = KunCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          filesystem: {
            transport: 'stdio',
            command: 'npx',
            trustScope: 'user'
          }
        }
      }
    }).mcp.servers.filesystem
    const error = Object.assign(new Error('spawn npx ENOENT'), {
      code: 'ENOENT',
      path: 'npx'
    })

    expect(formatMcpConnectionError(error, server)).toContain('Could not find "npx" on PATH')
  })

  it('evaluates workspace trust scopes', () => {
    const server = {
      enabled: true,
      transport: 'stdio',
      command: 'node',
      args: [],
      url: undefined,
      headers: {},
      env: {},
      workspaceRoots: [],
      trustScope: 'workspace',
      trustedWorkspaceRoots: ['/tmp/project'],
      timeoutMs: 30_000
    } satisfies McpServerConfig

    expect(isMcpServerTrusted(server, '/tmp/project')).toBe(true)
    expect(isMcpServerTrusted(server, '/tmp/project/sub')).toBe(true)
    expect(isMcpServerTrusted(server, '/tmp/other')).toBe(false)
  })

  it('evaluates workspace visibility scopes independently from trust', () => {
    const server = {
      enabled: true,
      transport: 'stdio',
      command: 'node',
      args: [],
      url: undefined,
      headers: {},
      env: {},
      workspaceRoots: ['/tmp/project'],
      trustScope: 'user',
      trustedWorkspaceRoots: [],
      timeoutMs: 30_000
    } satisfies McpServerConfig

    expect(isMcpServerTrusted(server, '/tmp/other')).toBe(true)
    expect(isMcpServerVisible(server, '/tmp/project')).toBe(true)
    expect(isMcpServerVisible(server, '/tmp/project/sub')).toBe(true)
    expect(isMcpServerVisible(server, '/tmp/other')).toBe(false)
  })

  it('resolves stdio MCP working directories from explicit config or trusted workspace fallback', () => {
    const base = {
      enabled: true,
      transport: 'stdio',
      command: 'node',
      args: [],
      url: undefined,
      headers: {},
      env: {},
      workspaceRoots: [],
      trustScope: 'workspace',
      trustedWorkspaceRoots: ['/tmp/project'],
      timeoutMs: 30_000
    } satisfies McpServerConfig

    expect(resolveMcpServerCwd({ ...base, cwd: '/tmp/explicit' })).toBe('/tmp/explicit')
    expect(resolveMcpServerCwd(base)).toBe('/tmp/project')
    expect(resolveMcpServerCwd({ ...base, trustScope: 'user', trustedWorkspaceRoots: [] })).toBeUndefined()
    expect(resolveMcpServerCwd({ ...base, transport: 'streamable-http', url: 'https://mcp.example.test' })).toBeUndefined()
  })

  it('builds registry providers from connected MCP clients and executes tools', async () => {
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
      clientFactory: async () => fakeClient()
    })
    const host = new LocalToolHost({ registry: new CapabilityRegistry(built.providers) })

    expect(built.connectedServers).toBe(1)
    expect(built.toolCount).toBe(1)
    expect(built.diagnostics[0]).toMatchObject({ id: 'github', status: 'connected', toolCount: 1 })

    const tools = await host.listTools(buildContext('/tmp/project'))
    expect(tools.map((tool) => tool.name)).toEqual(['mcp_github_search_issues'])
    expect(tools[0]?.providerId).toBe('mcp:github')

    const result = await host.execute({
      callId: 'call_1',
      toolName: 'mcp_github_search_issues',
      arguments: { query: 'bug' }
    }, buildContext('/tmp/project'))
    expect(result.item.kind).toBe('tool_result')
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({
        serverId: 'github',
        toolName: 'Search Issues'
      })
    }
  })

  it('uses BM25 MCP search meta tools when search discovery is enabled', async () => {
    const config = KunCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        search: {
          enabled: true,
          mode: 'search',
          topKDefault: 2,
          topKMax: 5
        },
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
              {
                name: 'search_issues',
                title: 'Search issues',
                description: 'Search GitHub issues and pull requests by query',
                inputSchema: {
                  type: 'object',
                  properties: { query: { type: 'string', description: 'Issue search query' } },
                  required: ['query']
                },
                annotations: { readOnlyHint: true }
              },
              {
                name: 'create_issue',
                description: 'Create a GitHub issue',
                inputSchema: {
                  type: 'object',
                  properties: { title: { type: 'string' }, body: { type: 'string' } },
                  required: ['title']
                }
              }
            ]
          }
        },
        async callTool(input) {
          return { called: input.name, arguments: input.arguments }
        },
        async close() {
          // no-op
        }
      })
    })
    const host = new LocalToolHost({ registry: new CapabilityRegistry(built.providers) })
    const context = buildContext('/tmp/project')

    expect(built.toolCount).toBe(2)
    expect(built.search).toMatchObject({
      enabled: true,
      mode: 'search',
      active: true,
      indexedToolCount: 2,
      advertisedToolCount: 9
    })
    expect((await host.listTools(context)).map((tool) => tool.name)).toEqual([
      'mcp_search',
      'mcp_describe',
      'mcp_call',
      'mcp_refresh_catalog'
    ])

    const search = await host.execute({
      callId: 'call_search',
      toolName: 'mcp_search',
      arguments: { query: '查 github issue' }
    }, context)
    expect(search.item.kind).toBe('tool_result')
    if (search.item.kind === 'tool_result') {
      const output = search.item.output as { results: Array<{ toolId: string }> }
      expect(output.results[0]?.toolId).toBe('github/search_issues')
    }

    const describe = await host.execute({
      callId: 'call_describe',
      toolName: 'mcp_describe',
      arguments: { toolId: 'github/search_issues' }
    }, context)
    if (describe.item.kind === 'tool_result') {
      expect(describe.item.output).toMatchObject({
        toolId: 'github/search_issues',
        toolName: 'search_issues'
      })
    }

    const call = await host.execute({
      callId: 'call_tool',
      toolName: 'mcp_call',
      arguments: { toolId: 'github/search_issues', arguments: { query: 'bug' } }
    }, context)
    if (call.item.kind === 'tool_result') {
      expect(call.item.output).toMatchObject({
        serverId: 'github',
        toolName: 'search_issues',
        result: {
          called: 'search_issues',
          arguments: { query: 'bug' }
        }
      })
    }
  })

  it('hides workspace-scoped tools outside trusted roots', async () => {
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
      clientFactory: async () => fakeClient()
    })
    const host = new LocalToolHost({ registry: new CapabilityRegistry(built.providers) })

    expect(await host.listTools(buildContext('/tmp/other'))).toEqual([])
    await expect(
      host.execute({
        callId: 'call_1',
        toolName: 'mcp_github_search_issues',
        arguments: { query: 'bug' }
      }, buildContext('/tmp/other'))
    ).rejects.toThrow(/not advertised/)
  })

  it('hides workspace-visible tools outside configured visibility roots', async () => {
    const config = KunCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          codegraph: {
            transport: 'stdio',
            command: 'node',
            workspaceRoots: ['/tmp/project'],
            trustScope: 'user'
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => fakeClient()
    })
    const host = new LocalToolHost({ registry: new CapabilityRegistry(built.providers) })

    expect((await host.listTools(buildContext('/tmp/project'))).map((tool) => tool.name)).toEqual([
      'mcp_codegraph_search_issues'
    ])
    expect(await host.listTools(buildContext('/tmp/other'))).toEqual([])
  })

  it('records diagnostics for failed MCP server connections', async () => {
    const config = KunCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          broken: {
            transport: 'streamable-http',
            url: 'https://example.invalid/mcp',
            trustScope: 'user'
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => {
        throw new Error('connect failed')
      }
    })

    expect(built.providers.map((provider) => provider.id)).toEqual(['mcp:facade'])
    expect(built.connectedServers).toBe(0)
    expect(built.diagnostics[0]).toMatchObject({
      id: 'broken',
      status: 'error',
      lastError: 'connect failed'
    })
  })

  it('records actionable diagnostics when stdio MCP commands are missing', async () => {
    const config = KunCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          filesystem: {
            transport: 'stdio',
            command: 'npx',
            trustScope: 'user'
          }
        }
      }
    })
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => {
        throw Object.assign(new Error('spawn npx ENOENT'), {
          code: 'ENOENT',
          path: 'npx'
        })
      }
    })

    expect(built.providers.map((provider) => provider.id)).toEqual(['mcp:facade'])
    expect(built.diagnostics[0]).toMatchObject({
      id: 'filesystem',
      status: 'error'
    })
    expect(built.diagnostics[0]?.lastError).toContain('Could not find "npx" on PATH')
  })

  it('passes MCP timeouts and abort signals to discovery and execution', async () => {
    const listOptions: Array<{ signal?: AbortSignal; timeout?: number } | undefined> = []
    const callOptions: Array<{ signal?: AbortSignal; timeout?: number } | undefined> = []
    const config = KunCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          github: {
            transport: 'stdio',
            command: 'node',
            trustScope: 'workspace',
            trustedWorkspaceRoots: ['/tmp/project'],
            timeoutMs: 1234
          }
        }
      }
    })
    const client: McpClientLike = {
      async listTools(options) {
        listOptions.push(options)
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
      async callTool(_input, options) {
        callOptions.push(options)
        return { ok: true }
      },
      async close() {
        // no-op
      }
    }
    const built = await buildMcpToolProviders(config.mcp, {
      clientFactory: async () => client
    })
    const host = new LocalToolHost({ registry: new CapabilityRegistry(built.providers) })
    const controller = new AbortController()
    const context = { ...buildContext('/tmp/project'), abortSignal: controller.signal }

    await host.execute({
      callId: 'call_1',
      toolName: 'mcp_github_read',
      arguments: {}
    }, context)

    expect(listOptions[0]?.timeout).toBe(1234)
    expect(callOptions[0]?.timeout).toBe(1234)
    expect(callOptions[0]?.signal).toBe(controller.signal)
  })

  it('reconnects and retries once when an MCP tool call fails', async () => {
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
      toolName: 'mcp_github_read',
      arguments: {}
    }, buildContext('/tmp/project'))

    expect(factories).toBe(2)
    expect(closes).toBe(1)
    expect(result.item.kind === 'tool_result' ? result.item.output : {}).toMatchObject({
      result: { ok: true, instance: 2 }
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
      toolName: 'mcp_github_search',
      arguments: {}
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

    // Startup pass: the server failed and advertised no tools.
    expect(built.diagnostics).toEqual([expect.objectContaining({ id: 'github', status: 'error' })])
    expect(built.providers.map((provider) => provider.id)).toEqual(['mcp:facade'])

    const registry = new CapabilityRegistry(built.providers)
    await built.startBackgroundReconnect((provider) => registry.registerProvider(provider))

    // The background retry connected, registered the tools live, and flipped
    // the diagnostic without a runtime restart.
    expect(factories).toBe(2)
    expect(built.diagnostics).toEqual([
      expect.objectContaining({ id: 'github', status: 'connected', toolCount: 1 })
    ])
    const host = new LocalToolHost({ registry })
    expect((await host.listTools(buildContext('/tmp/project'))).map((tool) => tool.name)).toContain(
      'mcp_github_read'
    )
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
    await built.startBackgroundReconnect(() => {
      throw new Error('register should not be called when nothing failed')
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

  it('receives remote MCP OAuth authorization codes on a loopback callback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-mcp-oauth-'))
    const redirectPort = await getFreePort()
    const opened: string[] = []
    const server = KunCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          vercel: {
            transport: 'streamable-http',
            url: 'https://mcp.vercel.com',
            trustScope: 'user',
            oauth: {
              redirectPort,
              callbackTimeoutMs: 5_000
            }
          }
        }
      }
    }).mcp.servers.vercel as McpServerConfig
    const provider = new FileMcpOAuthProvider(
      'vercel',
      server,
      join(root, 'vercel.json'),
      async (url) => {
        opened.push(url.toString())
      },
      undefined,
      true
    )

    const oauthState = provider.state()
    await provider.redirectToAuthorization(new URL('https://auth.example.test/authorize'))
    expect(provider.redirectUrl.port).toBe(String(redirectPort))
    const code = provider.waitForAuthorizationCode()
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ ok: false as const, error }))
    const callbackUrl = new URL(provider.redirectUrl)
    callbackUrl.searchParams.set('code', 'abc123')
    callbackUrl.searchParams.set('state', oauthState)
    const status = await httpStatus(callbackUrl)

    expect(status).toBe(200)
    await expect(code).resolves.toEqual({ ok: true, value: 'abc123' })
    expect(opened).toEqual(['https://auth.example.test/authorize'])
  }, 10_000)

  it('rejects non-http MCP OAuth authorization urls', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-mcp-oauth-'))
    const opened: string[] = []
    const server = KunCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          vercel: {
            transport: 'streamable-http',
            url: 'https://mcp.vercel.com',
            trustScope: 'user',
            oauth: {}
          }
        }
      }
    }).mcp.servers.vercel as McpServerConfig
    const provider = new FileMcpOAuthProvider(
      'vercel',
      server,
      join(root, 'vercel.json'),
      async (url) => {
        opened.push(url.toString())
      },
      undefined,
      true
    )

    await expect(provider.redirectToAuthorization(new URL('file:///tmp/token'))).rejects.toThrow(/http or https/)
    expect(opened).toEqual([])
  })

  it('keeps remote MCP OAuth callbacks bound to the generated state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-mcp-oauth-'))
    const redirectPort = await getFreePort()
    const server = KunCapabilitiesConfig.parse({
      mcp: {
        enabled: true,
        servers: {
          vercel: {
            transport: 'streamable-http',
            url: 'https://mcp.vercel.com',
            trustScope: 'user',
            oauth: {
              redirectPort,
              callbackTimeoutMs: 5_000
            }
          }
        }
      }
    }).mcp.servers.vercel as McpServerConfig
    const provider = new FileMcpOAuthProvider(
      'vercel',
      server,
      join(root, 'vercel.json'),
      async () => undefined,
      undefined,
      true
    )

    const state = provider.state()
    await provider.redirectToAuthorization(new URL('https://auth.example.test/authorize'))
    const code = provider.waitForAuthorizationCode()
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ ok: false as const, error }))

    const wrongStateUrl = new URL(provider.redirectUrl)
    wrongStateUrl.searchParams.set('code', 'wrong-code')
    wrongStateUrl.searchParams.set('state', 'wrong-state')
    await expect(httpStatus(wrongStateUrl)).resolves.toBe(400)

    const callbackUrl = new URL(provider.redirectUrl)
    callbackUrl.searchParams.set('code', 'right-code')
    callbackUrl.searchParams.set('state', state)
    await expect(httpStatus(callbackUrl)).resolves.toBe(200)
    await expect(code).resolves.toEqual({ ok: true, value: 'right-code' })
  }, 10_000)

  it('closes connected MCP clients during shutdown', async () => {
    let closed = 0
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
      clientFactory: async () => ({
        async listTools() {
          return { tools: [] }
        },
        async callTool() {
          return { ok: true }
        },
        async close() {
          closed += 1
        }
      })
    })

    await built.close()

    expect(closed).toBe(1)
  })
})

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
    const registered: string[] = []
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
    // Capture the live register callback (as the runtime does).
    await built.startBackgroundReconnect((provider) => registered.push(provider.id))

    const result = await built.authorizeOAuth('vercel')
    await built.close()

    expect(result).toMatchObject({ serverId: 'vercel', authorized: true })
    expect(authorizeCalls).toBe(1)
    // The freshly authorized server is connected + registered live.
    expect(registered).toContain('mcp:vercel')
    expect(built.diagnostics.find((entry) => entry.id === 'vercel')?.status).toBe('connected')
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
    await built.startBackgroundReconnect(() => undefined)

    const [a, b] = await Promise.all([built.authorizeOAuth('vercel'), built.authorizeOAuth('vercel')])
    await built.close()

    expect(authorizeCalls).toBe(1)
    expect(a).toEqual(b)
  })
})
