import type { SkillRootId } from '../lib/skill-root-preference'
import {
  readBrowserStorageItem,
  writeBrowserStorageItem
} from '../lib/browser-storage'
import type { MarketplaceNotice } from './PluginMarketplaceParts'

export type PluginKind = 'mcp' | 'skill'
export type PluginFilter = 'all' | 'recommended' | 'installed'
export type NoticeTone = 'success' | 'error' | 'info'

export type Notice = MarketplaceNotice

export type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
}

export type MarketplaceItem = {
  id: string
  kind: PluginKind
  titleKey?: string
  descriptionKey?: string
  title?: string
  description?: string
  group: 'recommended' | 'personal'
  sourceLabel?: string
  detail?: string
  statusTone?: 'default' | 'success' | 'warning' | 'error'
  systemManaged?: boolean
  serverIds?: string[]
  mcpConfig?: (workspaceRoot: string) => JsonRecord
  oauth?: OAuthConnectorInfo
  supplyChain?: SupplyChainInfo
  skillInstructions?: string
}

export type JsonRecord = Record<string, unknown>

export type SupplyChainPermission = 'file' | 'command' | 'network' | 'secret'

export type SupplyChainInfo = {
  source: 'mcp' | 'remote-mcp' | 'skill'
  permissions: SupplyChainPermission[]
  packageName?: string
  version?: string
}

export type MarketplaceInstallAudit = {
  ok: boolean
  permissions: SupplyChainPermission[]
  errors: string[]
}

export type OAuthConnectorInfo = {
  docsUrl: string
  permissionKeys: string[]
  setupKeys: string[]
  noteKey?: string
}

export type SkillRootOption = {
  id: SkillRootId
  label: string
  path: string
  scope: 'project' | 'global'
  enabled: boolean
  exists: boolean
  skillCount: number
}

export const INSTALLED_STORAGE_KEY = 'kun.installedPlugins'
export const GUI_SCHEDULE_MCP_SERVER_ID = 'gui_schedule'

export function loadInstalledPlugins(): string[] {
  try {
    const raw = readBrowserStorageItem(INSTALLED_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function saveInstalledPlugins(ids: string[]): void {
  writeBrowserStorageItem(INSTALLED_STORAGE_KEY, JSON.stringify([...new Set(ids)]))
}

export function storageKey(kind: PluginKind, id: string): string {
  return `${kind}:${id}`
}

export function normalizeSkillId(id: string): string {
  return id.trim().replace(/^\/?skill:/i, '').trim()
}

export function normalizeDisabledSkillIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  return [...new Set(ids
    .filter((id): id is string => typeof id === 'string')
    .map(normalizeSkillId)
    .filter(Boolean))]
}

export function normalizePluginId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Returns true only when `url` parses as an absolute `https://` URL. The URL
 * constructor throws on malformed input, so it is guarded; any non-https scheme
 * (http, file, javascript, data, …) is rejected. Remote MCP servers carry the
 * `user` trust scope, so we never want to write a non-TLS endpoint into config.
 */
export function isHttpsUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url.trim()) return false
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Validates that every server entry in a `servers` object that declares a
 * remote `url` enforces HTTPS. Command-based servers (no `url` field) pass
 * through. Throws on any non-https url so the caller surfaces a clear error
 * before the fragment is written into the persisted MCP config.
 *
 * Iteration uses Object.entries (own enumerable properties) and the url lookup
 * uses Object.prototype.hasOwnProperty.call, so a prototype-polluted object
 * cannot smuggle a non-https url past the check via an inherited `url` key.
 */
export function validateMcpServersHttps(servers: JsonRecord): void {
  for (const [id, server] of Object.entries(servers)) {
    if (!isJsonRecord(server)) {
      throw new Error(`MCP server "${id}" must be an object`)
    }
    if (!Object.prototype.hasOwnProperty.call(server, 'url')) continue
    if (!isHttpsUrl(server.url)) {
      throw new Error(`MCP server "${id}" URL must use HTTPS (got ${typeof server.url === 'string' ? server.url : typeof server.url})`)
    }
  }
}

/** Origins whose docs links the OAuth connector preview may open externally. */
export const OAUTH_DOCS_ALLOWED_ORIGINS: readonly string[] = [
  'https://vercel.com',
  'https://developers.google.com'
]

/**
 * Validates that a connector docs URL is an https URL hosted on an allowlisted
 * origin before it is handed to the OS "open external link" path. Returns false
 * for malformed URLs, non-https schemes, or unexpected origins so the preview
 * dialog can no-op instead of opening an attacker-influenced link.
 */
export function isAllowedDocsUrl(url: unknown): boolean {
  if (!isHttpsUrl(url)) return false
  try {
    return OAUTH_DOCS_ALLOWED_ORIGINS.includes(new URL(url as string).origin)
  } catch {
    return false
  }
}

export function parseMcpJsonConfig(content: string): JsonRecord {
  const trimmed = content.trim()
  if (!trimmed) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`MCP config must be JSON: ${message}`)
  }
  if (!isJsonRecord(parsed)) {
    throw new Error('MCP config must be a JSON object.')
  }
  return parsed
}

export function buildStdioMcpServer(
  command: string,
  args: string[],
  options: {
    trustScope?: 'workspace' | 'user'
    trustedWorkspaceRoots?: string[]
    env?: JsonRecord
  } = {}
): JsonRecord {
  const trustScope = options.trustScope ?? 'user'
  return {
    enabled: true,
    transport: 'stdio',
    command,
    args,
    env: options.env ?? {},
    trustScope,
    ...(trustScope === 'workspace'
      ? {
          trustedWorkspaceRoots: options.trustedWorkspaceRoots?.length
            ? options.trustedWorkspaceRoots
            : ['/path/to/workspace']
        }
      : {}),
    timeoutMs: 30_000
  }
}

export function buildRemoteMcpServer(url: string): JsonRecord {
  // Remote MCP servers are written with trustScope "user", so reject anything
  // that is not an https:// endpoint before it lands in the config file.
  if (!isHttpsUrl(url)) {
    throw new Error(`Remote MCP server URL must be an https:// URL: ${url}`)
  }
  return {
    enabled: true,
    transport: 'streamable-http',
    url,
    headers: {},
    env: {},
    trustScope: 'user',
    timeoutMs: 30_000
  }
}

export const PERMISSION_LABELS: Record<SupplyChainPermission, string> = {
  file: 'File',
  command: 'Command',
  network: 'Network',
  secret: 'Secret'
}

export function uniquePermissions(permissions: readonly SupplyChainPermission[]): SupplyChainPermission[] {
  return [...new Set(permissions)]
}

export function auditMcpConfigSupplyChain(config: JsonRecord): MarketplaceInstallAudit {
  const permissions: SupplyChainPermission[] = ['network']
  const errors: string[] = []
  const servers = isJsonRecord(config.servers) ? config.servers : {}
  for (const [id, server] of Object.entries(servers)) {
    if (!isJsonRecord(server)) {
      errors.push(`MCP server "${id}" must be an object.`)
      continue
    }
    if (typeof server.command === 'string' && server.command.trim()) {
      permissions.push('command', 'file')
      const command = executableBasename(server.command)
      const args = Array.isArray(server.args) ? server.args.filter((arg): arg is string => typeof arg === 'string') : []
      if (command === 'npx') {
        const spec = npxPackageSpec(args)
        if (!spec) {
          errors.push(`MCP server "${id}" uses npx without an exact package version.`)
        } else if (!isExactNpmPackageSpec(spec)) {
          errors.push(`MCP server "${id}" must pin an exact npm package version (got "${spec}").`)
        }
      }
    }
    if (isJsonRecord(server.env) && Object.keys(server.env).length > 0) {
      permissions.push('secret')
    }
    if (typeof server.url === 'string') {
      permissions.push('network')
      if (!isHttpsUrl(server.url)) errors.push(`MCP server "${id}" URL must use HTTPS.`)
    }
  }
  return { ok: errors.length === 0, permissions: uniquePermissions(permissions), errors }
}

export function auditMarketplaceInstall(item: MarketplaceItem, workspaceRoot: string): MarketplaceInstallAudit {
  const configuredPermissions = item.supplyChain?.permissions ?? []
  const config = item.mcpConfig?.(workspaceRoot)
  if (!config) {
    return {
      ok: false,
      permissions: uniquePermissions(configuredPermissions),
      errors: ['MCP config is missing.']
    }
  }
  const audit = auditMcpConfigSupplyChain(config)
  return {
    ok: audit.ok,
    permissions: uniquePermissions([...configuredPermissions, ...audit.permissions]),
    errors: audit.errors
  }
}

export function executableBasename(command: string): string {
  const normalized = command.trim().replace(/^['"]|['"]$/g, '').replace(/\\/g, '/')
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase()
  return basename.replace(/\.(?:cmd|exe)$/i, '')
}

export function npxPackageSpec(args: readonly string[]): string | null {
  for (const arg of args) {
    if (!arg || arg.startsWith('-')) continue
    return arg
  }
  return null
}

export function isExactNpmPackageSpec(spec: string): boolean {
  if (spec.endsWith('@latest') || spec.includes('*') || spec.includes('^') || spec.includes('~')) return false
  const at = spec.lastIndexOf('@')
  if (at <= 0) return false
  const version = spec.slice(at + 1)
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
}

export function buildMcpConfig(
  id: string,
  command: string,
  args: string[],
  options?: Parameters<typeof buildStdioMcpServer>[2]
): JsonRecord {
  return {
    servers: {
      [id]: buildStdioMcpServer(command, args, options)
    }
  }
}

export const GOOGLE_WORKSPACE_MCP_SERVERS = {
  google_gmail: 'https://gmailmcp.googleapis.com/mcp/v1',
  google_drive: 'https://drivemcp.googleapis.com/mcp/v1',
  google_calendar: 'https://calendarmcp.googleapis.com/mcp/v1',
  google_people: 'https://people.googleapis.com/mcp/v1',
  google_chat: 'https://chatmcp.googleapis.com/mcp/v1'
} as const

export function googleWorkspaceMcpServerIds(): string[] {
  return Object.keys(GOOGLE_WORKSPACE_MCP_SERVERS)
}

export function googleWorkspaceMcpServers(): Record<string, string> {
  return { ...GOOGLE_WORKSPACE_MCP_SERVERS }
}

export function buildRemoteMcpConfig(servers: Record<string, string>): JsonRecord {
  return {
    servers: Object.fromEntries(
      Object.entries(servers).map(([id, url]) => [id, buildRemoteMcpServer(url)])
    )
  }
}

export function mcpServersFromConfig(config: JsonRecord): JsonRecord {
  if (isJsonRecord(config.servers)) return config.servers
  const capabilities = isJsonRecord(config.capabilities) ? config.capabilities : undefined
  const mcp = isJsonRecord(capabilities?.mcp) ? capabilities.mcp : undefined
  return isJsonRecord(mcp?.servers) ? mcp.servers : {}
}

export function mcpServerConfigFromText(content: string, id: string): JsonRecord | undefined {
  try {
    const server = mcpServersFromConfig(parseMcpJsonConfig(content))[id]
    return isJsonRecord(server) ? server : undefined
  } catch {
    return undefined
  }
}

export function mcpServerEnabledFromConfig(config: JsonRecord | undefined): boolean {
  return !(config?.enabled === false || config?.disabled === true)
}

export function mcpServerDescription(server: JsonRecord | undefined, fallback: string): string {
  if (!server) return fallback
  const transport = typeof server.transport === 'string' ? server.transport : ''
  const command = typeof server.command === 'string' ? server.command : ''
  const url = typeof server.url === 'string' ? server.url : ''
  const status = typeof server.status === 'string' ? server.status : ''
  const lastError = typeof server.lastError === 'string' ? server.lastError : ''
  const toolCount = typeof server.toolCount === 'number' && Number.isFinite(server.toolCount)
    ? server.toolCount
    : undefined
  const parts = [
    status ? `status: ${status}` : '',
    transport,
    command || url,
    toolCount != null ? `${toolCount} tools` : '',
    lastError ? `error: ${lastError}` : ''
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : fallback
}

export function mcpServerStatus(diagnostic: JsonRecord | undefined, config: JsonRecord | undefined): string {
  const diagnosticStatus = typeof diagnostic?.status === 'string' ? diagnostic.status : ''
  if (diagnosticStatus) return diagnosticStatus
  if (config?.enabled === false || config?.disabled === true) return 'disabled'
  return ''
}

export function mcpStatusTone(status: string): MarketplaceItem['statusTone'] {
  if (status === 'connected' || status === 'available') return 'success'
  if (status === 'error' || status === 'unavailable') return 'error'
  if (status === 'disabled' || status === 'authorization_required') return 'warning'
  return 'default'
}

export function mcpConfigHasServer(content: string, id: string): boolean {
  try {
    return Object.prototype.hasOwnProperty.call(mcpServersFromConfig(parseMcpJsonConfig(content)), id)
  } catch {
    return false
  }
}

export function mcpConfigHasServers(content: string, ids: readonly string[]): boolean {
  if (ids.length === 0) return false
  try {
    const servers = mcpServersFromConfig(parseMcpJsonConfig(content))
    return ids.every((id) => Object.prototype.hasOwnProperty.call(servers, id))
  } catch {
    return false
  }
}

export function customMcpConfigFragment(id: string, raw: string, fallback: JsonRecord): JsonRecord {
  const trimmed = raw.trim()
  if (!trimmed) return fallback
  const parsed = parseMcpJsonConfig(trimmed)
  if (isJsonRecord(parsed.servers)) {
    validateMcpServersHttps(parsed.servers)
    return parsed
  }
  if (isJsonRecord(parsed.capabilities)) {
    const mcp = isJsonRecord(parsed.capabilities.mcp) ? parsed.capabilities.mcp : undefined
    if (isJsonRecord(mcp?.servers)) {
      validateMcpServersHttps(mcp.servers)
      return { servers: mcp.servers }
    }
  }
  if (parsed.command !== undefined || parsed.url !== undefined || parsed.transport !== undefined) {
    if (parsed.url !== undefined && !isHttpsUrl(parsed.url)) {
      throw new Error(`MCP server URL must use HTTPS: ${String(parsed.url)}`)
    }
    return { servers: { [id]: parsed } }
  }
  throw new Error('MCP JSON config must include a servers object or a single server object.')
}

export function mergeMcpJsonConfig(content: string, fragment: JsonRecord): { alreadyExists: boolean; text: string } {
  const current = parseMcpJsonConfig(content)
  const currentServers = mcpServersFromConfig(current)
  const fragmentServers = mcpServersFromConfig(fragment)
  const fragmentServerIds = Object.keys(fragmentServers)
  if (fragmentServerIds.length === 0) {
    throw new Error('MCP JSON config must include at least one server.')
  }
  const alreadyExists = fragmentServerIds.some((id) =>
    Object.prototype.hasOwnProperty.call(currentServers, id)
  )
  if (alreadyExists) {
    return { alreadyExists: true, text: `${JSON.stringify(current, null, 2)}\n` }
  }

  const fragmentRest = { ...fragment }
  delete fragmentRest.servers
  const next = {
    ...current,
    ...fragmentRest,
    servers: {
      ...currentServers,
      ...fragmentServers
    }
  }
  return { alreadyExists: false, text: `${JSON.stringify(next, null, 2)}\n` }
}

export function setMcpServerEnabled(content: string, id: string, enabled: boolean): string {
  const current = parseMcpJsonConfig(content)
  const updateServer = (servers: JsonRecord): JsonRecord => {
    const rawServer = servers[id]
    if (!isJsonRecord(rawServer)) {
      throw new Error(`MCP server "${id}" does not exist.`)
    }
    return {
      ...servers,
      [id]: {
        ...rawServer,
        enabled,
        ...(enabled ? { disabled: undefined } : {})
      }
    }
  }

  if (isJsonRecord(current.servers)) {
    return `${JSON.stringify({ ...current, servers: updateServer(current.servers) }, null, 2)}\n`
  }

  const capabilities = isJsonRecord(current.capabilities) ? current.capabilities : undefined
  const mcp = isJsonRecord(capabilities?.mcp) ? capabilities.mcp : undefined
  if (isJsonRecord(mcp?.servers)) {
    return `${JSON.stringify({
      ...current,
      capabilities: {
        ...capabilities,
        mcp: {
          ...mcp,
          servers: updateServer(mcp.servers)
        }
      }
    }, null, 2)}\n`
  }

  throw new Error(`MCP server "${id}" does not exist.`)
}

export function buildSkillContent(id: string, title: string, description: string, instructions: string): string {
  return [
    '---',
    `name: ${id}`,
    `description: ${description}`,
    '---',
    '',
    `# ${title}`,
    '',
    instructions
  ].join('\n')
}
