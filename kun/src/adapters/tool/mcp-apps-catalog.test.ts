import { describe, expect, it, vi } from 'vitest'
import { McpCapabilityConfig } from '../../contracts/capabilities.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { buildMcpToolProviders, type McpClientLike, type McpToolDescriptor } from './mcp-tool-provider.js'
import { mcpClientOptions } from './mcp-transport.js'

const tools: McpToolDescriptor[] = [
  {
    name: 'canvas_create',
    inputSchema: { type: 'object', properties: {} },
    _meta: { ui: { resourceUri: 'ui://kun-canvas/index.html', surface: 'canvas' } }
  },
  { name: 'canvas_commit', inputSchema: { type: 'object', properties: {} }, _meta: { ui: { visibility: ['app'] } } },
  { name: 'canvas_read', inputSchema: { type: 'object', properties: {} } }
]

const config = McpCapabilityConfig.parse({
  enabled: true,
  servers: {
    canvas: {
      enabled: true,
      transport: 'streamable-http',
      url: 'http://127.0.0.1:39998/mcp',
      trustScope: 'user'
    }
  },
  search: { enabled: false }
})

const context: ToolHostContext = {
  threadId: 'thread_test',
  turnId: 'turn_test',
  workspace: '/workspace',
  approvalPolicy: 'auto',
  abortSignal: new AbortController().signal,
  awaitApproval: vi.fn()
}

describe('MCP Apps in the MCP tool catalog', () => {
  it('advertises the UI extension to every server', () => {
    const options = mcpClientOptions(config.servers.canvas!)
    expect(options.capabilities?.extensions).toEqual({
      'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] }
    })
  })

  it('keeps app-only tools out of the model catalog and attaches the UI sideband to results', async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }], structuredContent: { boardId: 'cb_x' } }))
    const client: McpClientLike = {
      listTools: async () => ({ tools }),
      callTool,
      setLifecycleHandlers: () => undefined,
      close: async () => undefined
    } as McpClientLike
    const result = await buildMcpToolProviders(config, { clientFactory: async () => client })
    const names = result.providers.flatMap((provider) => provider.tools.map((tool) => tool.name))
    expect(names).toContain('mcp_canvas_canvas_create')
    expect(names).toContain('mcp_canvas_canvas_read')
    expect(names).not.toContain('mcp_canvas_canvas_commit')

    const create = result.providers.flatMap((provider) => provider.tools)
      .find((tool) => tool.name === 'mcp_canvas_canvas_create')!
    const output = await create.execute({}, context)
    expect(output.meta).toEqual({
      mcpApp: {
        serverId: 'canvas',
        toolName: 'canvas_create',
        resourceUri: 'ui://kun-canvas/index.html',
        surface: 'canvas'
      }
    })
    expect(output.output).toEqual({
      serverId: 'canvas',
      toolName: 'canvas_create',
      result: { content: [{ type: 'text', text: 'ok' }], structuredContent: { boardId: 'cb_x' } }
    })
    const read = result.providers.flatMap((provider) => provider.tools)
      .find((tool) => tool.name === 'mcp_canvas_canvas_read')!
    expect((await read.execute({}, context)).meta).toBeUndefined()

    expect(result.apps.catalog('/workspace').map((entry) => entry.toolName)).toEqual(['canvas_create'])
    await expect(result.apps.callTool({ serverId: 'canvas', name: 'canvas_commit', arguments: {}, workspace: '/workspace', context }))
      .resolves.toMatchObject({ descriptor: { name: 'canvas_commit' } })
    await result.close()
  })
})
