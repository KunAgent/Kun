import { McpServerConfig as McpServerConfigSchema, type McpCapabilityConfig, type McpServerConfig } from '../contracts/capabilities-core.js'
import type { RuntimeConfigApplyResponse } from '../contracts/runtime-config.js'
import type {
  McpOAuthAuthorizeResult,
  McpOAuthClearResult,
  McpOAuthDiagnostic,
  McpOAuthStatus,
  McpToolDescriptor
} from '../adapters/tool/mcp-types.js'

export const NOTION_APP_ID = 'notion'
export const NOTION_MCP_SERVER_ID = 'notion'
export const NOTION_MCP_ENDPOINT = 'https://mcp.notion.com/mcp'
export const NOTION_OAUTH_CALLBACK_TIMEOUT_MS = 120_000

export const NOTION_CAPABILITY_IDS = [
  'identity',
  'search',
  'fetch',
  'create_pages',
  'update_page'
] as const
export type NotionCapabilityId = (typeof NOTION_CAPABILITY_IDS)[number]

export type NotionCapability = {
  id: NotionCapabilityId
  available: boolean
  writes: boolean
  toolName?: string
}

export type NotionCapabilityMap = {
  capabilities: readonly NotionCapability[]
  toolNames: readonly string[]
  warnings: readonly string[]
}

export type NotionDiscoveryResult = {
  tools: readonly McpToolDescriptor[]
  warnings?: readonly string[]
}

/** The existing MCP service surface; no second configuration store is introduced. */
export type NotionMcpServerMutation = (current: McpServerConfig | undefined) =>
  McpServerConfig | null | 'exists' | 'missing' | 'unchanged'

export type NotionMcpPort = {
  config(): McpCapabilityConfig | Promise<McpCapabilityConfig>
  oauth(): readonly McpOAuthDiagnostic[] | Promise<readonly McpOAuthDiagnostic[]>
  setServer(serverId: string, mutation: NotionMcpServerMutation): Promise<RuntimeConfigApplyResponse>
  authorize(serverId: string): Promise<McpOAuthAuthorizeResult>
  clear(serverId: string): Promise<McpOAuthClearResult>
}

export type NotionDiscoveryPort = {
  discover(serverId: string): Promise<NotionDiscoveryResult>
}

/**
 * Reuse an existing MCP discovery snapshot when only tool names are available
 * (for example McpServerDiagnostic.toolNames) instead of opening a second MCP
 * client just to list Notion tools again.
 */
export function notionDiscoveryFromToolNames(toolNames: readonly string[]): NotionDiscoveryResult {
  const names = [...new Set(toolNames.map((name) => name.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
  return { tools: names.map((name) => ({ name })) }
}

export const NOTION_CONNECTION_STATES = [
  'not_installed',
  'conflict',
  'disabled',
  'oauth_disabled',
  'authorization_required',
  'authorized',
  'reauth_required',
  'error'
] as const
export type NotionConnectionState = (typeof NOTION_CONNECTION_STATES)[number]

export const NOTION_CONNECTION_ERROR_CODES = [
  'conflict',
  'disabled',
  'oauth_disabled',
  'not_installed',
  'authorization_failed',
  'apply_failed',
  'disconnect_failed'
] as const
export type NotionConnectionErrorCode = (typeof NOTION_CONNECTION_ERROR_CODES)[number]

export type NotionConnectionErrorCodeExtended = NotionConnectionErrorCode
  | 'configuration_unavailable'
  | 'oauth_diagnostics_failed'
  | 'discovery_failed'

export class NotionConnectionError extends Error {
  constructor(readonly code: NotionConnectionErrorCode, message: string) {
    super(message)
    this.name = 'NotionConnectionError'
  }
}

export type NotionConnectionSnapshot = {
  serverId: typeof NOTION_MCP_SERVER_ID
  endpoint: typeof NOTION_MCP_ENDPOINT
  state: NotionConnectionState
  installed: boolean
  enabled: boolean
  oauthStatus?: McpOAuthStatus
  nextAction: 'install' | 'resolve_conflict' | 'enable' | 'configure_oauth' | 'authorize' | 'reconnect' | 'manage'
  capabilities: readonly NotionCapability[]
  toolNames: readonly string[]
  warnings: readonly string[]
  errorCode?: NotionConnectionErrorCodeExtended
  errorMessage?: string
}

export type NotionInstallOutcome = 'installed' | 'reused' | 'disabled' | 'oauth_disabled' | 'conflict'
export type NotionInstallResult = {
  outcome: NotionInstallOutcome
  snapshot: NotionConnectionSnapshot
}

export function createNotionMcpServer(): McpServerConfig {
  return McpServerConfigSchema.parse({
    enabled: true,
    transport: 'streamable-http',
    url: NOTION_MCP_ENDPOINT,
    trustScope: 'user',
    oauth: {
      enabled: true,
      scopes: [],
      callbackTimeoutMs: NOTION_OAUTH_CALLBACK_TIMEOUT_MS
    }
  })
}

export function isNotionMcpTarget(server: McpServerConfig): boolean {
  return server.transport === 'streamable-http' && normalizedEndpoint(server.url) === NOTION_MCP_ENDPOINT
}

export function notionOAuthConfigured(server: McpServerConfig): boolean {
  return Boolean(server.oauth && server.oauth.enabled !== false)
}

function normalizedEndpoint(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return undefined
    const path = url.pathname.replace(/\/+$/, '') || '/'
    return `${url.protocol}//${url.host.toLowerCase()}${path}`
  } catch {
    return undefined
  }
}

const capabilityMatchers: ReadonlyArray<{
  id: NotionCapabilityId
  writes: boolean
  names: readonly string[]
  patterns: readonly RegExp[]
}> = [
  {
    id: 'identity', writes: false,
    names: ['get-self', 'get-me', 'whoami', 'users-me', 'get-current-user'],
    patterns: [/^(?:get-self|get-me|whoami|users-me|get-current-user)$/]
  },
  {
    id: 'search', writes: false,
    names: ['search'],
    patterns: [/^(?:search|search-pages|search-content)$/, /^(?:workspace-)?search$/]
  },
  {
    id: 'fetch', writes: false,
    names: ['fetch', 'retrieve-page', 'get-page'],
    patterns: [/^(?:fetch|fetch-page|retrieve-page|get-page|read-page)$/]
  },
  {
    id: 'create_pages', writes: true,
    names: ['create-pages', 'create-page'],
    patterns: [/create.*page/, /append.*(?:block|page)/]
  },
  {
    id: 'update_page', writes: true,
    names: ['update-page', 'update-pages'],
    patterns: [/update.*page/, /patch.*page/, /replace.*(?:page|content)/]
  }
]

export function mapNotionCapabilities(tools: readonly McpToolDescriptor[]): NotionCapabilityMap {
  const names = tools.map((tool) => tool.name.trim()).filter(Boolean).sort((left, right) => left.localeCompare(right))
  const assigned = new Map<NotionCapabilityId, string>()
  for (const name of names) {
    const normalized = normalizeToolName(name)
    for (const matcher of capabilityMatchers) {
      if (assigned.has(matcher.id)) continue
      if (matcher.names.includes(normalized) || matcher.patterns.some((pattern) => pattern.test(normalized))) {
        assigned.set(matcher.id, name)
      }
    }
  }
  const capabilities = capabilityMatchers.map((matcher) => {
    const toolName = assigned.get(matcher.id)
    return {
      id: matcher.id,
      available: Boolean(toolName),
      writes: matcher.writes,
      ...(toolName ? { toolName } : {})
    }
  })
  return {
    capabilities,
    toolNames: names,
    warnings: capabilities.filter((capability) => !capability.available)
      .map((capability) => `Notion capability ${capability.id} was not discovered; its tool name may differ.`)
  }
}

function normalizeToolName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^notion[_-]/, '')
    .replace(/[_\s]+/g, '-')
}
