import type {
  McpSearchConfig,
  McpServerConfig
} from '../../contracts/capabilities.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import {
  describeRecord,
  formatSearchResult,
  searchRecords
} from './mcp-tool-search-ranking.js'
import {
  VirtualToolCatalog,
  type FrozenToolCatalogView,
  type VirtualToolEntry
} from './virtual-tool-catalog.js'

const MCP_SEARCH_TOOL_NAME = 'mcp_search'
const MCP_DESCRIBE_TOOL_NAME = 'mcp_describe'
const MCP_CALL_TOOL_NAME = 'mcp_call'
const MCP_READ_ONLY_CALL_TOOL_NAME = 'mcp_read_only_call'
const MCP_REFRESH_CATALOG_TOOL_NAME = 'mcp_refresh_catalog'
const MAX_FROZEN_MCP_CATALOGS = 256


export type McpSearchClientLike = {
  callTool(
    input: { name: string; arguments: Record<string, unknown> },
    options?: { signal?: AbortSignal; timeout?: number; context?: ToolHostContext }
  ): Promise<unknown>
}

export type McpSearchToolDescriptor = {
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: {
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
  execution?: unknown
  icons?: unknown
  _meta?: Record<string, unknown>
}

export type McpSearchCatalogRecord = {
  toolId: string
  serverId: string
  server: McpServerConfig
  client: McpSearchClientLike
  descriptor: McpSearchToolDescriptor
  normalizedName: string
  policy: LocalTool['policy']
}

export type McpSearchRuntimeDiagnostic = {
  enabled: boolean
  mode: McpSearchConfig['mode']
  active: boolean
  indexedToolCount: number
  advertisedToolCount: number
  topKDefault: number
  topKMax: number
  minScore: number
  lastRefreshedAt?: string
  lastError?: string
  catalogFingerprint?: string
  catalogDrift?: boolean
}

export type McpSearchCatalogState = {
  records: McpSearchCatalogRecord[]
  lastRefreshedAt?: string
  lastError?: string
  catalogFingerprint?: string
  catalogDrift?: boolean
}

export type McpSearchProviderOptions = {
  config: McpSearchConfig
  state: McpSearchCatalogState
  catalog: McpSearchCatalogController
  refreshCatalog: () => Promise<McpSearchCatalogRecord[]>
  isServerAvailable: (server: McpServerConfig, workspace: string) => boolean
}

/**
 * The live search index plus its per-turn frozen views. The provider builder
 * owns a single instance so every catalog replacement (startup, manual
 * refresh, OAuth late-connect, background reconnect) goes through one
 * `replaceAll` commit instead of being written by the search tools themselves.
 */
export class McpSearchCatalogController {
  private readonly live: VirtualToolCatalog<McpSearchCatalogRecord>
  private readonly frozenByTurn = new Map<string, FrozenToolCatalogView<McpSearchCatalogRecord>>()

  constructor(records: McpSearchCatalogRecord[]) {
    this.live = new VirtualToolCatalog(toVirtualCatalogEntries(records))
  }

  replaceAll(records: McpSearchCatalogRecord[]): string {
    return this.live.replaceAll(toVirtualCatalogEntries(records))
  }

  currentVersion(): string {
    return this.live.currentVersion()
  }

  frozenFor(context: ToolHostContext): FrozenToolCatalogView<McpSearchCatalogRecord> {
    const key = JSON.stringify([context.threadId, context.turnId])
    const existing = this.frozenByTurn.get(key)
    if (existing) return existing
    const frozen = this.live.freeze()
    this.frozenByTurn.set(key, frozen)
    if (this.frozenByTurn.size > MAX_FROZEN_MCP_CATALOGS) {
      const oldest = this.frozenByTurn.keys().next().value
      if (oldest !== undefined) this.frozenByTurn.delete(oldest)
    }
    return frozen
  }
}

export { tokenizeMcpSearchText } from './mcp-tool-search-ranking.js'


export function createMcpSearchProvider(
  options: McpSearchProviderOptions
): CapabilityToolProvider {
  return {
    id: 'mcp:search',
    kind: 'mcp',
    enabled: true,
    available: true,
    tools: createMcpSearchTools(options, options.catalog)
  }
}

export function mcpSearchDiagnostic(input: {
  config: McpSearchConfig
  active: boolean
  indexedToolCount: number
  advertisedToolCount: number
  state: McpSearchCatalogState
}): McpSearchRuntimeDiagnostic {
  return {
    enabled: input.config.enabled,
    mode: input.config.mode,
    active: input.active,
    indexedToolCount: input.indexedToolCount,
    advertisedToolCount: input.advertisedToolCount,
    topKDefault: input.config.topKDefault,
    topKMax: input.config.topKMax,
    minScore: input.config.minScore,
    ...(input.state.lastRefreshedAt ? { lastRefreshedAt: input.state.lastRefreshedAt } : {}),
    ...(input.state.lastError ? { lastError: input.state.lastError } : {}),
    ...(input.state.catalogFingerprint ? { catalogFingerprint: input.state.catalogFingerprint } : {}),
    ...(input.state.catalogDrift !== undefined ? { catalogDrift: input.state.catalogDrift } : {})
  }
}


function createMcpSearchTools(
  options: McpSearchProviderOptions,
  catalog: McpSearchCatalogController
): LocalTool[] {
  return [
    LocalToolHost.defineTool({
      name: MCP_SEARCH_TOOL_NAME,
      description: 'Search connected MCP tools by natural-language intent, server, action, and parameter names.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The user intent or task to find MCP tools for.' },
          topK: { type: 'number', description: 'Maximum number of matching tools to return.' },
          serverId: { type: 'string', description: 'Optional MCP server id to search within.' }
        },
        required: ['query']
      },
      policy: 'auto',
      sideEffect: 'read-only',
      execute: async (args, context) => {
        const query = stringArg(args.query)
        if (!query) return { output: { error: 'query is required' }, isError: true }
        const serverId = stringArg(args.serverId)
        const topK = clampPositiveInt(numberArg(args.topK), options.config.topKDefault, options.config.topKMax)
        const view = catalog.frozenFor(context)
        const records = availableRecords(options, view, context)
          .filter((record) => !serverId || record.serverId === serverId)
        const results = searchRecords(records, query, topK, options.config)
        return {
          output: {
            query,
            totalIndexed: view.size(),
            searchedTools: records.length,
            catalogVersion: view.frozenVersion,
            catalogUpdatePending: view.pendingUpdate(),
            results: results.map(formatSearchResult)
          }
        }
      }
    }),
    LocalToolHost.defineTool({
      name: MCP_DESCRIBE_TOOL_NAME,
      description: 'Return the full schema and metadata for a connected MCP tool found by mcp_search.',
      inputSchema: {
        type: 'object',
        properties: {
          toolId: { type: 'string', description: 'Canonical MCP tool id in the form mcp_<server>_<tool>.' }
        },
        required: ['toolId']
      },
      policy: 'auto',
      sideEffect: 'read-only',
      execute: async (args, context) => {
        const toolId = stringArg(args.toolId)
        const record = resolveAvailableRecord(options, catalog, context, toolId)
        if (!record) return { output: { error: `unknown MCP tool: ${toolId}` }, isError: true }
        return { output: describeRecord(record) }
      }
    }),
    LocalToolHost.defineTool({
      name: MCP_READ_ONLY_CALL_TOOL_NAME,
      description: 'Call a host-approved read-only MCP tool by canonical tool id. Available in Plan mode; rejects tools not listed in the server planModeReadOnlyTools configuration.',
      inputSchema: {
        type: 'object',
        properties: {
          toolId: { type: 'string', description: 'Canonical MCP tool id in the form mcp_<server>_<tool>.' },
          arguments: { type: 'object', description: 'Arguments matching the MCP tool input schema.' }
        },
        required: ['toolId', 'arguments']
      },
      policy: 'on-request',
      sideEffect: 'read-only',
      toolKind: 'command_execution',
      execute: async (args, context) => {
        const toolId = stringArg(args.toolId)
        const record = resolveAvailableRecord(options, catalog, context, toolId)
        if (!record) return { output: { error: `unknown MCP tool: ${toolId}` }, isError: true }
        if (!record.server.planModeReadOnlyTools?.includes(record.descriptor.name)) {
          return {
            output: { error: `MCP tool ${record.toolId} is not host-approved as read-only` },
            isError: true
          }
        }
        const callArgs = objectArg(args.arguments)
        const result = await record.client.callTool(
          { name: record.descriptor.name, arguments: callArgs },
          { signal: context.abortSignal, timeout: record.server.timeoutMs, context }
        )
        return {
          output: {
            serverId: record.serverId,
            toolName: record.descriptor.name,
            toolId: record.toolId,
            result
          },
          isError: typeof result === 'object' && result !== null && (result as { isError?: boolean }).isError === true
        }
      }
    }),
    LocalToolHost.defineTool({
      name: MCP_CALL_TOOL_NAME,
      description: 'Call a connected MCP tool by canonical tool id with JSON arguments.',
      inputSchema: {
        type: 'object',
        properties: {
          toolId: { type: 'string', description: 'Canonical MCP tool id in the form mcp_<server>_<tool>.' },
          arguments: { type: 'object', description: 'Arguments matching the MCP tool input schema.' }
        },
        required: ['toolId', 'arguments']
      },
      policy: 'on-request',
      toolKind: 'command_execution',
      execute: async (args, context) => {
        const toolId = stringArg(args.toolId)
        const record = resolveAvailableRecord(options, catalog, context, toolId)
        if (!record) return { output: { error: `unknown MCP tool: ${toolId}` }, isError: true }
        const callArgs = objectArg(args.arguments)
        const result = await record.client.callTool(
          { name: record.descriptor.name, arguments: callArgs },
          { signal: context.abortSignal, timeout: record.server.timeoutMs, context }
        )
        return {
          output: {
            serverId: record.serverId,
            toolName: record.descriptor.name,
            toolId: record.toolId,
            result
          },
          isError: typeof result === 'object' && result !== null && (result as { isError?: boolean }).isError === true
        }
      }
    }),
    LocalToolHost.defineTool({
      name: MCP_REFRESH_CATALOG_TOOL_NAME,
      description: 'Refresh the MCP tool catalog and rebuild the local search index.',
      inputSchema: {
        type: 'object',
        properties: {}
      },
      // Refreshing invokes every connected MCP server, so it is an external
      // command boundary just like mcp_call rather than a local index read.
      policy: 'on-request',
      toolKind: 'command_execution',
      // A child turn can explicitly block individual MCP servers. A catalog
      // refresh is global state and cannot safely refresh only a subset, so do
      // not let such a turn contact any MCP server through this back door.
      shouldAdvertise: (context) => !context.blockedProviderIds?.some((id) => id.startsWith('mcp:')),
      execute: async (_args, context) => {
        const visible = catalog.frozenFor(context)
        // The provider builder owns the commit (records, direct wrappers,
        // search index, exposure, fingerprint). The tool only triggers it and
        // then reads the committed state back; it never rewrites the index.
        await options.refreshCatalog()
        return {
          output: {
            refreshedAt: options.state.lastRefreshedAt,
            totalIndexed: options.state.records.length,
            catalogFingerprint: options.state.catalogFingerprint,
            catalogDrift: options.state.catalogDrift === true,
            visibleCatalogVersion: visible.frozenVersion,
            catalogVersion: catalog.currentVersion(),
            catalogUpdatePending: visible.pendingUpdate()
          }
        }
      }
    })
  ]
}

function availableRecords(
  options: McpSearchProviderOptions,
  view: FrozenToolCatalogView<McpSearchCatalogRecord>,
  context: ToolHostContext
): McpSearchCatalogRecord[] {
  const blocked = context.blockedProviderIds
  return view.list().flatMap((entry) => entry.value ? [entry.value] : []).filter((record) =>
    options.isServerAvailable(record.server, context.workspace)
    // Honor the per-turn provider deny-list (e.g. a subagent's blockedMcpServers).
    // In search mode the per-server `mcp:<id>` provider is never registered, so
    // CapabilityRegistry.canUseProvider can't gate it — this is the single
    // chokepoint shared by mcp_search/mcp_describe/mcp_call, so filtering here
    // blocks enumeration, schema disclosure, AND execution of a blocked server.
    && !blocked?.includes(`mcp:${record.serverId}`)
  )
}

function resolveAvailableRecord(
  options: McpSearchProviderOptions,
  catalog: McpSearchCatalogController,
  context: ToolHostContext,
  toolId: string
): McpSearchCatalogRecord | undefined {
  if (!toolId) return undefined
  const view = catalog.frozenFor(context)
  return availableRecords(options, view, context).find((record) => record.toolId === toolId)
}

function toVirtualCatalogEntries(
  records: McpSearchCatalogRecord[]
): VirtualToolEntry<McpSearchCatalogRecord>[] {
  return records.map((record) => ({
    id: record.toolId,
    name: record.descriptor.name,
    kind: 'mcp',
    description: record.descriptor.description ?? '',
    inputSchema: record.descriptor.inputSchema ?? { type: 'object' },
    keywords: [record.serverId, record.normalizedName],
    metadata: {
      outputSchema: record.descriptor.outputSchema,
      annotations: record.descriptor.annotations,
      execution: record.descriptor.execution,
      icons: record.descriptor.icons,
      meta: record.descriptor._meta,
      policy: record.policy
    },
    value: record
  }))
}

function stringArg(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberArg(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function objectArg(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function clampPositiveInt(value: number | undefined, fallback: number, max: number): number {
  if (!value || value <= 0) return fallback
  return Math.min(Math.floor(value), max)
}
