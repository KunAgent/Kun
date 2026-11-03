import { describe, expect, it, vi } from 'vitest'
import type { McpServerConfig } from '../../contracts/capabilities.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { createMcpAppsAccess, McpAppsAccessError } from './mcp-apps-access.js'
import type { McpConnectionState } from './mcp-tool-provider.js'
import type { McpClientLike, McpToolDescriptor } from './mcp-types.js'

function server(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    enabled: true,
    transport: 'stdio',
    command: 'node',
    args: [],
    headers: {},
    env: {},
    workspaceRoots: [],
    trustScope: 'user',
    trustedWorkspaceRoots: [],
    planModeReadOnlyTools: [],
    timeoutMs: 1_000,
    ...overrides
  } as McpServerConfig
}

const tools: McpToolDescriptor[] = [
  { name: 'canvas_create', _meta: { ui: { resourceUri: 'ui://kun-canvas/index.html', surface: 'canvas' } } },
  { name: 'canvas_commit', _meta: { ui: { visibility: ['app'] } } },
  { name: 'secret_admin', _meta: { ui: { visibility: ['model'] } } }
]

function state(config: McpServerConfig, client: Partial<McpClientLike>): McpConnectionState {
  return {
    serverId: 'kun_canvas',
    server: config,
    client: { listTools: async () => ({ tools }), callTool: async () => ({}), ...client } as McpClientLike,
    clientFactory: async () => { throw new Error('unused') },
    nowIso: () => '2026-10-19T00:00:00.000Z',
    toolNames: tools.map((tool) => tool.name),
    status: 'connected',
    reconnectAttempts: 0,
    reconnectBackoffMs: 0
  }
}

const context = {
  threadId: 'thread-1',
  turnId: 'mcp-app:kun_canvas',
  workspace: '/workspace',
  approvalPolicy: 'never',
  abortSignal: new AbortController().signal,
  awaitApproval: async () => 'deny'
} as ToolHostContext

describe('MCP Apps access', () => {
  it('lists UI-capable tools for usable servers', () => {
    const access = createMcpAppsAccess([state(server(), {})], new Map([['kun_canvas', tools]]))
    expect(access.catalog('/workspace')).toEqual([{
      serverId: 'kun_canvas',
      toolName: 'canvas_create',
      resourceUri: 'ui://kun-canvas/index.html',
      visibility: ['model', 'app'],
      surface: 'canvas'
    }])
    const untrusted = createMcpAppsAccess([state(server({ trustScope: 'workspace' }), {})], new Map([['kun_canvas', tools]]))
    expect(untrusted.catalog('/workspace')).toEqual([])
  })

  it('lets pages call only app-visible tools of their own server', async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'saved' }] }))
    const access = createMcpAppsAccess([state(server(), { callTool })], new Map([['kun_canvas', tools]]))
    await expect(access.callTool({ serverId: 'kun_canvas', name: 'canvas_commit', arguments: { a: 1 }, workspace: '/workspace', context }))
      .resolves.toMatchObject({ result: { content: [{ text: 'saved' }] } })
    expect(callTool).toHaveBeenCalledWith({ name: 'canvas_commit', arguments: { a: 1 } }, expect.objectContaining({ context }))
    await expect(access.callTool({ serverId: 'kun_canvas', name: 'secret_admin', arguments: {}, workspace: '/workspace', context }))
      .rejects.toMatchObject({ code: 'forbidden' })
    await expect(access.callTool({ serverId: 'other', name: 'canvas_commit', arguments: {}, workspace: '/workspace', context }))
      .rejects.toBeInstanceOf(McpAppsAccessError)
  })

  it('reads resources only from trusted, connected servers', async () => {
    const readResource = vi.fn(async () => ({ contents: [{ uri: 'ui://kun-canvas/index.html', text: '<p/>' }] }))
    const access = createMcpAppsAccess([state(server(), { readResource })], new Map([['kun_canvas', tools]]))
    await expect(access.readResource('kun_canvas', 'ui://kun-canvas/index.html', '/workspace')).resolves.toMatchObject({
      contents: [{ text: '<p/>' }]
    })
    const hidden = createMcpAppsAccess(
      [state(server({ workspaceRoots: ['/elsewhere'] }), { readResource })],
      new Map([['kun_canvas', tools]])
    )
    await expect(hidden.readResource('kun_canvas', 'ui://kun-canvas/index.html', '/workspace')).rejects.toMatchObject({ code: 'forbidden' })
  })
})
