import {
  isAppVisibleMcpTool,
  MCP_APP_HTML_MAX_BYTES,
  normalizeMcpToolUiMeta,
  type McpAppCatalogEntry
} from '../../contracts/mcp-apps.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { canUseMcpServer } from './mcp-naming.js'
import { callMcpToolWithReconnect, isMcpReplaySafe } from './mcp-tool-runtime.js'
import { mcpCallTimeoutMs } from './mcp-call-budget.js'
import type { McpToolDescriptor } from './mcp-types.js'
import type { McpConnectionState } from './mcp-tool-provider.js'

export class McpAppsAccessError extends Error {
  constructor(readonly code: 'not_found' | 'forbidden' | 'unavailable' | 'too_large', message: string) {
    super(message)
    this.name = 'McpAppsAccessError'
  }
}

/**
 * Page-facing access to live MCP connections. Every call is pinned to one
 * connected server and re-checks workspace visibility/trust for the thread.
 * Tool calls are restricted to tools whose `_meta.ui.visibility` includes
 * `app`; nothing here can reach another server or bypass that list.
 */
export type McpAppsAccess = {
  catalog(workspace: string): McpAppCatalogEntry[]
  readResource(serverId: string, uri: string, workspace: string, signal?: AbortSignal): Promise<unknown>
  listResources(serverId: string, workspace: string, cursor?: string, signal?: AbortSignal): Promise<unknown>
  callTool(input: {
    serverId: string
    name: string
    arguments: Record<string, unknown>
    workspace: string
    context: ToolHostContext
  }): Promise<{ result: unknown; descriptor: McpToolDescriptor }>
  toolDescriptor(serverId: string, name: string): McpToolDescriptor | undefined
}

export function createMcpAppsAccess(
  connected: readonly McpConnectionState[],
  listedByServer: ReadonlyMap<string, McpToolDescriptor[]>
): McpAppsAccess {
  const usableState = (serverId: string, workspace: string): McpConnectionState => {
    const state = connected.find((candidate) => candidate.serverId === serverId)
    if (!state) throw new McpAppsAccessError('not_found', `MCP server ${serverId} is not connected`)
    if (!canUseMcpServer(state.server, workspace)) {
      throw new McpAppsAccessError('forbidden', `MCP server ${serverId} is not enabled or trusted for this workspace`)
    }
    if (state.status !== 'connected') throw new McpAppsAccessError('unavailable', `MCP server ${serverId} is reconnecting`)
    return state
  }

  return {
    catalog(workspace) {
      const entries: McpAppCatalogEntry[] = []
      for (const state of connected) {
        if (!canUseMcpServer(state.server, workspace)) continue
        for (const tool of listedByServer.get(state.serverId) ?? []) {
          const ui = normalizeMcpToolUiMeta(tool._meta)
          if (!ui) continue
          entries.push({
            serverId: state.serverId,
            toolName: tool.name,
            ...(tool.title ? { title: tool.title } : {}),
            resourceUri: ui.resourceUri,
            visibility: ui.visibility,
            ...(ui.surface ? { surface: ui.surface } : {})
          })
        }
      }
      return entries
    },

    async readResource(serverId, uri, workspace, signal) {
      const state = usableState(serverId, workspace)
      if (!state.client.readResource) throw new McpAppsAccessError('unavailable', 'server does not support resources')
      const result = await state.client.readResource({ uri }, { signal, timeout: state.server.timeoutMs })
      const size = JSON.stringify(result ?? null).length
      if (size > Math.ceil(MCP_APP_HTML_MAX_BYTES * 1.4)) throw new McpAppsAccessError('too_large', 'resource is too large')
      return result
    },

    async listResources(serverId, workspace, cursor, signal) {
      const state = usableState(serverId, workspace)
      if (!state.client.listResources) return { resources: [] }
      return state.client.listResources({ ...(cursor ? { cursor } : {}), signal, timeout: state.server.timeoutMs })
    },

    async callTool(input) {
      const state = usableState(input.serverId, input.workspace)
      const descriptor = (listedByServer.get(input.serverId) ?? []).find((tool) => tool.name === input.name)
      if (!descriptor) throw new McpAppsAccessError('not_found', `unknown tool ${input.name}`)
      if (!isAppVisibleMcpTool(descriptor)) {
        throw new McpAppsAccessError('forbidden', `tool ${input.name} is not available to app pages`)
      }
      const result = await callMcpToolWithReconnect(
        state,
        { name: input.name, arguments: input.arguments },
        input.context,
        mcpCallTimeoutMs(state.server),
        isMcpReplaySafe(descriptor.annotations)
      )
      return { result, descriptor }
    },

    toolDescriptor(serverId, name) {
      return (listedByServer.get(serverId) ?? []).find((tool) => tool.name === name)
    }
  }
}
