import { describe, expect, it, vi } from 'vitest'
import { McpCapabilityConfig, McpServerConfig } from '../contracts/capabilities-core.js'
import type { RuntimeConfigApplyResponse } from '../contracts/runtime-config.js'
import type { McpOAuthDiagnostic, McpOAuthStatus } from '../adapters/tool/mcp-types.js'
import {
  NOTION_MCP_ENDPOINT,
  NOTION_MCP_SERVER_ID,
  createNotionMcpServer,
  isNotionMcpTarget,
  mapNotionCapabilities,
  notionDiscoveryFromToolNames,
  type NotionDiscoveryResult,
  type NotionMcpPort
} from './notion-connection-contract.js'
import { NotionConnectionBackend } from './notion-connection-backend.js'

const matchingServer = (overrides: Record<string, unknown> = {}): McpServerConfig => McpServerConfig.parse({
  ...createNotionMcpServer(),
  ...overrides
})

const diagnostic = (status: McpOAuthStatus): McpOAuthDiagnostic => ({
  serverId: NOTION_MCP_SERVER_ID,
  enabled: true,
  configured: true,
  transport: 'streamable-http',
  status,
  hasClientInformation: true,
  hasTokens: true,
  hasRefreshToken: true,
  hasCodeVerifier: false,
  hasDiscoveryState: true
})

function fixture(options: {
  server?: McpServerConfig
  oauth?: McpOAuthDiagnostic[]
  discovery?: NotionDiscoveryResult
  discoveryError?: Error
} = {}) {
  let server = options.server
  let oauth = options.oauth ?? []
  const calls = { setServer: 0, authorize: 0, clear: 0, discover: 0 }

  const setServer = vi.fn(async (_serverId: string, mutation: Parameters<NotionMcpPort['setServer']>[1]) => {
    calls.setServer += 1
    const next = mutation(server)
    if (next === 'exists' || next === 'missing') {
      return { ok: false, code: 'invalid_config', message: next } as RuntimeConfigApplyResponse
    }
    if (next !== 'unchanged') server = next ?? undefined
    return { ok: true } as RuntimeConfigApplyResponse
  })
  const authorize = vi.fn(async () => {
    calls.authorize += 1
    oauth = [diagnostic('authorized')]
    return { serverId: NOTION_MCP_SERVER_ID, status: 'authorized' as const, authorized: true }
  })
  const clear = vi.fn(async () => {
    calls.clear += 1
    oauth = []
    return { cleared: [NOTION_MCP_SERVER_ID] }
  })
  const discover = vi.fn(async () => {
    calls.discover += 1
    if (options.discoveryError) throw options.discoveryError
    return options.discovery ?? { tools: [] }
  })
  const mcp: NotionMcpPort = {
    config: () => McpCapabilityConfig.parse({ servers: server ? { [NOTION_MCP_SERVER_ID]: server } : {} }),
    oauth: () => oauth,
    setServer,
    authorize,
    clear
  }
  return {
    backend: new NotionConnectionBackend(mcp, { discover }),
    calls,
    setServer,
    authorize,
    clear,
    discover,
    get server() { return server }
  }
}

describe('Notion connection backend installation', () => {
  it('installs one controlled Streamable HTTP OAuth server when absent', async () => {
    const f = fixture()

    const result = await f.backend.install()

    expect(result.outcome).toBe('installed')
    expect(f.server).toMatchObject({
      enabled: true,
      transport: 'streamable-http',
      url: NOTION_MCP_ENDPOINT,
      trustScope: 'user',
      headers: {},
      env: {},
      oauth: { enabled: true, scopes: [] }
    })
    expect(result.snapshot).toMatchObject({
      state: 'authorization_required',
      installed: true,
      enabled: true,
      nextAction: 'authorize'
    })
    expect(f.authorize).not.toHaveBeenCalled()
  })

  it('reuses the matching server without replacing user configuration', async () => {
    const server = matchingServer()
    const f = fixture({ server })

    const result = await f.backend.install()

    expect(result.outcome).toBe('reused')
    expect(f.server).toEqual(server)
    expect(f.setServer).toHaveBeenCalledTimes(1)
    expect(f.authorize).not.toHaveBeenCalled()
  })

  it('does not auto-enable a matching disabled server', async () => {
    const server = matchingServer({ enabled: false })
    const f = fixture({ server })

    const result = await f.backend.install()

    expect(result.outcome).toBe('disabled')
    expect(f.server?.enabled).toBe(false)
    expect(result.snapshot).toMatchObject({
      state: 'disabled',
      installed: true,
      enabled: false,
      nextAction: 'enable',
      errorCode: 'disabled'
    })
    expect(f.authorize).not.toHaveBeenCalled()
  })

  it('does not auto-enable OAuth when the existing matching server disabled it', async () => {
    const server = matchingServer({ oauth: { enabled: false } })
    const f = fixture({ server })

    const result = await f.backend.install()

    expect(result.outcome).toBe('oauth_disabled')
    expect(f.server?.oauth?.enabled).toBe(false)
    expect(result.snapshot).toMatchObject({
      state: 'oauth_disabled',
      nextAction: 'configure_oauth',
      errorCode: 'oauth_disabled'
    })
    expect(f.authorize).not.toHaveBeenCalled()
  })

  it('reports an ID collision without overwriting or authorizing', async () => {
    const server = McpServerConfig.parse({
      enabled: true,
      transport: 'streamable-http',
      url: 'https://other.example/mcp',
      trustScope: 'user'
    })
    const f = fixture({ server })

    const result = await f.backend.install()

    expect(result.outcome).toBe('conflict')
    expect(f.server).toEqual(server)
    expect(result.snapshot).toMatchObject({
      state: 'conflict',
      installed: true,
      nextAction: 'resolve_conflict',
      errorCode: 'conflict'
    })
    expect(f.authorize).not.toHaveBeenCalled()
    expect(f.clear).not.toHaveBeenCalled()
  })
})

describe('Notion connection backend lifecycle', () => {
  it('stops connect before authorization when the matching server is disabled', async () => {
    const f = fixture({ server: matchingServer({ enabled: false }) })

    await expect(f.backend.connect()).rejects.toMatchObject({ code: 'disabled' })
    expect(f.authorize).not.toHaveBeenCalled()
    expect(f.discover).not.toHaveBeenCalled()
  })

  it('stops connect before authorization when existing OAuth is disabled', async () => {
    const f = fixture({ server: matchingServer({ oauth: { enabled: false } }) })

    await expect(f.backend.connect()).rejects.toMatchObject({ code: 'oauth_disabled' })
    expect(f.authorize).not.toHaveBeenCalled()
    expect(f.discover).not.toHaveBeenCalled()
  })

  it('stops connect before authorization on an ID collision', async () => {
    const server = McpServerConfig.parse({
      enabled: true,
      transport: 'sse',
      url: NOTION_MCP_ENDPOINT,
      trustScope: 'user'
    })
    const f = fixture({ server })

    await expect(f.backend.connect()).rejects.toMatchObject({ code: 'conflict' })
    expect(f.authorize).not.toHaveBeenCalled()
    expect(f.discover).not.toHaveBeenCalled()
  })

  it('authorizes then discovers tools for a newly installed server', async () => {
    const f = fixture({
      discovery: {
        tools: [
          { name: 'notion-get-self' },
          { name: 'search' },
          { name: 'notion-fetch' },
          { name: 'create-pages' },
          { name: 'update-page' }
        ]
      }
    })

    const snapshot = await f.backend.connect()

    expect(f.authorize).toHaveBeenCalledTimes(1)
    expect(f.discover).toHaveBeenCalledWith(NOTION_MCP_SERVER_ID)
    expect(snapshot).toMatchObject({
      state: 'authorized',
      installed: true,
      enabled: true,
      nextAction: 'manage'
    })
    expect(snapshot.capabilities).toEqual([
      { id: 'identity', available: true, writes: false, toolName: 'notion-get-self' },
      { id: 'search', available: true, writes: false, toolName: 'search' },
      { id: 'fetch', available: true, writes: false, toolName: 'notion-fetch' },
      { id: 'create_pages', available: true, writes: true, toolName: 'create-pages' },
      { id: 'update_page', available: true, writes: true, toolName: 'update-page' }
    ])
    expect(snapshot.warnings).toEqual([])
  })

  it('enables a disabled matching server only through the explicit action', async () => {
    const f = fixture({ server: matchingServer({ enabled: false }) })

    const snapshot = await f.backend.enable()

    expect(f.server?.enabled).toBe(true)
    expect(snapshot.state).toBe('authorization_required')
    expect(f.authorize).not.toHaveBeenCalled()
  })

  it('disables and clears only the matching server on disconnect', async () => {
    const f = fixture({ server: matchingServer(), oauth: [diagnostic('authorized')] })

    const snapshot = await f.backend.disconnect()

    expect(f.clear).toHaveBeenCalledWith(NOTION_MCP_SERVER_ID)
    expect(f.server?.enabled).toBe(false)
    expect(snapshot).toMatchObject({ state: 'disabled', nextAction: 'enable' })
  })

  it('refuses to disconnect an ID collision without clearing credentials', async () => {
    const f = fixture({
      server: McpServerConfig.parse({
        enabled: true,
        transport: 'streamable-http',
        url: 'https://other.example/mcp',
        trustScope: 'user'
      })
    })

    await expect(f.backend.disconnect()).rejects.toMatchObject({ code: 'conflict' })
    expect(f.clear).not.toHaveBeenCalled()
    expect(f.server?.enabled).toBe(true)
  })

  it('surfaces expired OAuth as reauthentication without claiming readiness', async () => {
    const f = fixture({ server: matchingServer(), oauth: [diagnostic('expired')] })

    const snapshot = await f.backend.status()

    expect(snapshot).toMatchObject({
      state: 'reauth_required',
      oauthStatus: 'expired',
      nextAction: 'reconnect'
    })
  })

  it('keeps authorization but reports a discovery failure when tools/list fails', async () => {
    const f = fixture({ discoveryError: new Error('tools/list timed out') })

    const snapshot = await f.backend.connect()

    expect(snapshot).toMatchObject({
      state: 'error',
      oauthStatus: 'authorized',
      errorCode: 'discovery_failed',
      nextAction: 'reconnect'
    })
    expect(snapshot.warnings[0]).toContain('tools/list')
  })
})

describe('Notion capability discovery mapping', () => {
  it('maps the documented Notion tools to capabilities without inventing names', () => {
    const mapped = mapNotionCapabilities([
      { name: 'notion-get-self' },
      { name: 'search' },
      { name: 'notion-fetch' },
      { name: 'create-pages' },
      { name: 'update-page' }
    ])

    expect(mapped.capabilities).toEqual([
      { id: 'identity', available: true, writes: false, toolName: 'notion-get-self' },
      { id: 'search', available: true, writes: false, toolName: 'search' },
      { id: 'fetch', available: true, writes: false, toolName: 'notion-fetch' },
      { id: 'create_pages', available: true, writes: true, toolName: 'create-pages' },
      { id: 'update_page', available: true, writes: true, toolName: 'update-page' }
    ])
    expect(mapped.toolNames).toEqual([
      'create-pages',
      'notion-fetch',
      'notion-get-self',
      'search',
      'update-page'
    ])
    expect(mapped.warnings).toEqual([])
  })

  it('reuses existing diagnostic tool names without opening a second client', () => {
    expect(notionDiscoveryFromToolNames(['search', 'notion-get-self', 'search', ' '])).toEqual({
      tools: [{ name: 'notion-get-self' }, { name: 'search' }]
    })
  })

  it('reports missing capabilities instead of fabricating tools', () => {
    const mapped = mapNotionCapabilities([{ name: 'notion-search' }])

    expect(mapped.capabilities.find((entry) => entry.id === 'search')).toMatchObject({
      available: true,
      toolName: 'notion-search'
    })
    expect(mapped.capabilities.filter((entry) => !entry.available)).toHaveLength(4)
    expect(mapped.warnings).toHaveLength(4)
    expect(mapped.warnings.every((warning) => warning.includes('not discovered'))).toBe(true)
  })
})

describe('Notion target matching', () => {
  it('accepts only the exact Streamable HTTP endpoint', () => {
    expect(isNotionMcpTarget(matchingServer())).toBe(true)
    expect(isNotionMcpTarget(matchingServer({ url: `${NOTION_MCP_ENDPOINT}/` }))).toBe(true)
    expect(isNotionMcpTarget(matchingServer({ url: 'https://mcp.notion.com/other' }))).toBe(false)
    expect(isNotionMcpTarget(matchingServer({ transport: 'sse' }))).toBe(false)
  })
})
