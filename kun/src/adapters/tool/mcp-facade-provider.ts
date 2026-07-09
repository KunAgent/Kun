import type { McpServerConfig } from '../../contracts/capabilities.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import {
  canUseMcpServer,
  isMcpServerTrusted,
  isMcpServerVisible
} from './mcp-naming.js'
import type { McpClientLike } from './mcp-types.js'

export type McpFacadeConnectionState = {
  serverId: string
  server: McpServerConfig
  client: McpClientLike
  status: 'connected' | 'reconnecting' | 'error'
}

type FacadeCapability =
  | 'listResources'
  | 'readResource'
  | 'listResourceTemplates'
  | 'listPrompts'
  | 'getPrompt'

const MCP_FACADE_PROVIDER_ID = 'mcp:facade'

export function createMcpFacadeProvider(connected: McpFacadeConnectionState[]): CapabilityToolProvider {
  return {
    id: MCP_FACADE_PROVIDER_ID,
    kind: 'mcp',
    enabled: true,
    available: true,
    tools: [
      createListResourcesTool(connected),
      createReadResourceTool(connected),
      createListResourceTemplatesTool(connected),
      createListPromptsTool(connected),
      createGetPromptTool(connected)
    ]
  }
}

function createListResourcesTool(connected: McpFacadeConnectionState[]): LocalTool {
  return LocalToolHost.defineTool({
    name: 'mcp_list_resources',
    description: 'List MCP resources exposed by currently connected MCP servers.',
    policy: 'auto',
    inputSchema: {
      type: 'object',
      properties: {
        serverId: { type: 'string' }
      }
    },
    shouldAdvertise: (context) => hasUsableServer(connected, context, 'listResources'),
    execute: async (args, context) => {
      const states = selectUsableServers(connected, context, 'listResources', stringArg(args.serverId))
      if (!states.length) return unavailableOutput('listResources')
      const results = []
      for (const state of states) {
        const listed = await state.client.listResources?.({ signal: context.abortSignal, timeout: state.server.timeoutMs })
        results.push({ serverId: state.serverId, resources: listed?.resources ?? [], nextCursor: listed?.nextCursor })
      }
      return { output: { servers: results } }
    }
  })
}

function createReadResourceTool(connected: McpFacadeConnectionState[]): LocalTool {
  return LocalToolHost.defineTool({
    name: 'mcp_read_resource',
    description: 'Read one MCP resource from a connected MCP server.',
    policy: 'auto',
    inputSchema: {
      type: 'object',
      properties: {
        serverId: { type: 'string' },
        uri: { type: 'string' }
      },
      required: ['uri']
    },
    shouldAdvertise: (context) => hasUsableServer(connected, context, 'readResource'),
    execute: async (args, context) => {
      const uri = stringArg(args.uri)
      if (!uri) return { output: { error: 'uri is required' }, isError: true }
      const state = selectSingleUsableServer(connected, context, 'readResource', stringArg(args.serverId))
      if (!state) return unavailableOutput('readResource')
      const result = await state.client.readResource?.({ uri }, { signal: context.abortSignal, timeout: state.server.timeoutMs })
      return { output: { serverId: state.serverId, uri, result } }
    }
  })
}

function createListResourceTemplatesTool(connected: McpFacadeConnectionState[]): LocalTool {
  return LocalToolHost.defineTool({
    name: 'mcp_list_resource_templates',
    description: 'List MCP resource templates exposed by currently connected MCP servers.',
    policy: 'auto',
    inputSchema: {
      type: 'object',
      properties: {
        serverId: { type: 'string' }
      }
    },
    shouldAdvertise: (context) => hasUsableServer(connected, context, 'listResourceTemplates'),
    execute: async (args, context) => {
      const states = selectUsableServers(connected, context, 'listResourceTemplates', stringArg(args.serverId))
      if (!states.length) return unavailableOutput('listResourceTemplates')
      const results = []
      for (const state of states) {
        const listed = await state.client.listResourceTemplates?.({ signal: context.abortSignal, timeout: state.server.timeoutMs })
        results.push({ serverId: state.serverId, resourceTemplates: listed?.resourceTemplates ?? [], nextCursor: listed?.nextCursor })
      }
      return { output: { servers: results } }
    }
  })
}

function createListPromptsTool(connected: McpFacadeConnectionState[]): LocalTool {
  return LocalToolHost.defineTool({
    name: 'mcp_list_prompts',
    description: 'List MCP prompts exposed by currently connected MCP servers.',
    policy: 'auto',
    inputSchema: {
      type: 'object',
      properties: {
        serverId: { type: 'string' }
      }
    },
    shouldAdvertise: (context) => hasUsableServer(connected, context, 'listPrompts'),
    execute: async (args, context) => {
      const states = selectUsableServers(connected, context, 'listPrompts', stringArg(args.serverId))
      if (!states.length) return unavailableOutput('listPrompts')
      const results = []
      for (const state of states) {
        const listed = await state.client.listPrompts?.({ signal: context.abortSignal, timeout: state.server.timeoutMs })
        results.push({ serverId: state.serverId, prompts: listed?.prompts ?? [], nextCursor: listed?.nextCursor })
      }
      return { output: { servers: results } }
    }
  })
}

function createGetPromptTool(connected: McpFacadeConnectionState[]): LocalTool {
  return LocalToolHost.defineTool({
    name: 'mcp_get_prompt',
    description: 'Get one MCP prompt from a connected MCP server.',
    policy: 'auto',
    inputSchema: {
      type: 'object',
      properties: {
        serverId: { type: 'string' },
        name: { type: 'string' },
        arguments: { type: 'object', additionalProperties: true }
      },
      required: ['name']
    },
    shouldAdvertise: (context) => hasUsableServer(connected, context, 'getPrompt'),
    execute: async (args, context) => {
      const name = stringArg(args.name)
      if (!name) return { output: { error: 'name is required' }, isError: true }
      const state = selectSingleUsableServer(connected, context, 'getPrompt', stringArg(args.serverId))
      if (!state) return unavailableOutput('getPrompt')
      const result = await state.client.getPrompt?.(
        { name, arguments: objectArg(args.arguments) },
        { signal: context.abortSignal, timeout: state.server.timeoutMs }
      )
      return { output: { serverId: state.serverId, name, result } }
    }
  })
}

function hasUsableServer(
  connected: McpFacadeConnectionState[],
  context: ToolHostContext,
  capability: FacadeCapability
): boolean {
  return connected.some((state) => isUsableServer(state, context, capability))
}

function selectUsableServers(
  connected: McpFacadeConnectionState[],
  context: ToolHostContext,
  capability: FacadeCapability,
  serverId?: string
): McpFacadeConnectionState[] {
  return connected.filter((state) => {
    if (serverId && state.serverId !== serverId) return false
    return isUsableServer(state, context, capability)
  })
}

function selectSingleUsableServer(
  connected: McpFacadeConnectionState[],
  context: ToolHostContext,
  capability: FacadeCapability,
  serverId?: string
): McpFacadeConnectionState | null {
  const states = selectUsableServers(connected, context, capability, serverId)
  return states[0] ?? null
}

function isUsableServer(
  state: McpFacadeConnectionState,
  context: ToolHostContext,
  capability: FacadeCapability
): boolean {
  return state.status === 'connected' &&
    typeof state.client[capability] === 'function' &&
    canUseMcpServer(state.server, context.workspace) &&
    isMcpServerVisible(state.server, context.workspace) &&
    isMcpServerTrusted(state.server, context.workspace)
}

function unavailableOutput(capability: FacadeCapability): { output: { error: string }; isError: true } {
  return {
    output: { error: `No connected MCP server can use ${capability} in this workspace.` },
    isError: true
  }
}

function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function objectArg(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
