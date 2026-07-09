import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronDown,
  Download,
  FolderOpen,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings
} from 'lucide-react'
import { rendererRuntimeClient } from '../agent/runtime-client'
import {
  loadPreferredSkillRootId,
  savePreferredSkillRootId,
  type SkillRootId
} from '../lib/skill-root-preference'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { getProvider } from '../agent/registry'
import type { SkillListItem, SkillRootListItem } from '@shared/kun-gui-api'
import type {
  CoreRuntimeInfoJson,
  CoreRuntimeToolDiagnosticsJson
} from '../agent/kun-contract'
import { useChatStore } from '../store/chat-store'
import { NoticeView, TabButton, type MarketplaceNotice } from './PluginMarketplaceParts'
import {
  buildMcpMarketplaceOverlay,
  type McpMarketplaceOverlay,
  type McpMarketplaceOverlayStatus
} from './plugin-marketplace-runtime'
import { SidebarTitlebarToggleButton } from './sidebar/SidebarPrimitives'

type PluginKind = 'mcp' | 'skill'
type PluginFilter = 'all' | 'recommended' | 'installed'
type NoticeTone = 'success' | 'error' | 'info'

type Notice = MarketplaceNotice

type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
}

type MarketplaceItem = {
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

type JsonRecord = Record<string, unknown>

type SupplyChainPermission = 'file' | 'command' | 'network' | 'secret'

type SupplyChainInfo = {
  source: 'mcp' | 'remote-mcp' | 'skill'
  permissions: SupplyChainPermission[]
  packageName?: string
  version?: string
}

type MarketplaceInstallAudit = {
  ok: boolean
  permissions: SupplyChainPermission[]
  errors: string[]
}

type OAuthConnectorInfo = {
  docsUrl: string
  permissionKeys: string[]
  setupKeys: string[]
  noteKey?: string
}

type SkillRootOption = {
  id: SkillRootId
  label: string
  path: string
  scope: 'project' | 'global'
  enabled: boolean
  exists: boolean
  skillCount: number
}

const INSTALLED_STORAGE_KEY = 'kun.installedPlugins'
const GUI_SCHEDULE_MCP_SERVER_ID = 'gui_schedule'

function loadInstalledPlugins(): string[] {
  try {
    const raw = readBrowserStorageItem(INSTALLED_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function saveInstalledPlugins(ids: string[]): void {
  writeBrowserStorageItem(INSTALLED_STORAGE_KEY, JSON.stringify([...new Set(ids)]))
}

function storageKey(kind: PluginKind, id: string): string {
  return `${kind}:${id}`
}

function normalizeSkillId(id: string): string {
  return id.trim().replace(/^\/?skill:/i, '').trim()
}

function normalizeDisabledSkillIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  return [...new Set(ids
    .filter((id): id is string => typeof id === 'string')
    .map(normalizeSkillId)
    .filter(Boolean))]
}

function normalizePluginId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function isJsonRecord(value: unknown): value is JsonRecord {
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
function validateMcpServersHttps(servers: JsonRecord): void {
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
const OAUTH_DOCS_ALLOWED_ORIGINS: readonly string[] = [
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

function parseMcpJsonConfig(content: string): JsonRecord {
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

function buildStdioMcpServer(
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

function buildRemoteMcpServer(url: string): JsonRecord {
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

const PERMISSION_LABELS: Record<SupplyChainPermission, string> = {
  file: 'File',
  command: 'Command',
  network: 'Network',
  secret: 'Secret'
}

function uniquePermissions(permissions: readonly SupplyChainPermission[]): SupplyChainPermission[] {
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

function executableBasename(command: string): string {
  const normalized = command.trim().replace(/^['"]|['"]$/g, '').replace(/\\/g, '/')
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase()
  return basename.replace(/\.(?:cmd|exe)$/i, '')
}

function npxPackageSpec(args: readonly string[]): string | null {
  for (const arg of args) {
    if (!arg || arg.startsWith('-')) continue
    return arg
  }
  return null
}

function isExactNpmPackageSpec(spec: string): boolean {
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

const GOOGLE_WORKSPACE_MCP_SERVERS = {
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

function mcpServersFromConfig(config: JsonRecord): JsonRecord {
  if (isJsonRecord(config.servers)) return config.servers
  const capabilities = isJsonRecord(config.capabilities) ? config.capabilities : undefined
  const mcp = isJsonRecord(capabilities?.mcp) ? capabilities.mcp : undefined
  return isJsonRecord(mcp?.servers) ? mcp.servers : {}
}

function mcpServerConfigFromText(content: string, id: string): JsonRecord | undefined {
  try {
    const server = mcpServersFromConfig(parseMcpJsonConfig(content))[id]
    return isJsonRecord(server) ? server : undefined
  } catch {
    return undefined
  }
}

function mcpServerEnabledFromConfig(config: JsonRecord | undefined): boolean {
  return !(config?.enabled === false || config?.disabled === true)
}

function mcpServerDescription(server: JsonRecord | undefined, fallback: string): string {
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

function mcpServerStatus(diagnostic: JsonRecord | undefined, config: JsonRecord | undefined): string {
  const diagnosticStatus = typeof diagnostic?.status === 'string' ? diagnostic.status : ''
  if (diagnosticStatus) return diagnosticStatus
  if (config?.enabled === false || config?.disabled === true) return 'disabled'
  return ''
}

function mcpStatusTone(status: string): MarketplaceItem['statusTone'] {
  if (status === 'connected' || status === 'available') return 'success'
  if (status === 'error' || status === 'unavailable') return 'error'
  if (status === 'disabled') return 'warning'
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

function buildSkillContent(id: string, title: string, description: string, instructions: string): string {
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

function itemTitle(item: MarketplaceItem, t: (key: string) => string): string {
  return item.title ?? (item.titleKey ? t(item.titleKey) : item.id)
}

function itemDescription(item: MarketplaceItem, t: (key: string) => string): string {
  return item.description ?? (item.descriptionKey ? t(item.descriptionKey) : '')
}

export function skillMarketplaceItemsFromDiscoveredSkills(
  skills: SkillListItem[],
  labels: { project: string; global: string }
): MarketplaceItem[] {
  return skills.map((skill) => ({
    id: skill.id,
    kind: 'skill' as const,
    title: skill.name,
    description: skill.description ?? skill.root,
    group: 'personal' as const,
    sourceLabel: skill.scope === 'project' ? labels.project : labels.global
  }))
}

/** Last two path segments, e.g. `/Users/me/.claude/skills` → `.claude/skills`. */
export function skillRootShortLabel(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts.slice(-2).join('/') || path
}

/**
 * Builds the skill-root picker options from the backend's detected roots
 * (`skill:list-roots`) — the same source the settings page renders — so the
 * marketplace stays in sync instead of hardcoding a fixed subset of dirs.
 * Common dirs use their i18n label; user-added extra dirs fall back to a short
 * path label. (#321)
 */
export function skillRootOptionsFromRoots(
  roots: SkillRootListItem[],
  t: (key: string) => string
): SkillRootOption[] {
  return roots.map((root) => ({
    id: root.id,
    label: root.labelKey ? t(root.labelKey) : skillRootShortLabel(root.path),
    path: root.path,
    scope: root.scope,
    enabled: root.enabled,
    exists: root.exists,
    skillCount: root.skillCount
  }))
}

export function mcpMarketplaceItemsFromConfigAndDiagnostics(
  configText: string,
  diagnostics: CoreRuntimeToolDiagnosticsJson | null,
  labels: {
    configured: string
    connected: string
    error: string
    disabled: string
  }
): MarketplaceItem[] {
  const servers = new Map<string, {
    id: string
    config?: JsonRecord
    diagnostic?: JsonRecord
  }>()
  try {
    const configServers = mcpServersFromConfig(parseMcpJsonConfig(configText))
    for (const [id, value] of Object.entries(configServers)) {
      if (!id.trim()) continue
      servers.set(id, {
        id,
        config: isJsonRecord(value) ? value : {}
      })
    }
  } catch {
    /* Invalid config is surfaced elsewhere; keep the marketplace render resilient. */
  }
  for (const diagnostic of diagnostics?.mcpServers ?? []) {
    const id = typeof diagnostic.id === 'string' ? diagnostic.id.trim() : ''
    if (!id) continue
    const existing = servers.get(id)
    servers.set(id, {
      id,
      config: existing?.config,
      diagnostic
    })
  }
  return [...servers.values()].map(({ id, config, diagnostic }) => {
    const status = mcpServerStatus(diagnostic, config)
    const details = { ...(config ?? {}), ...(diagnostic ?? {}) }
    const sourceLabel =
      status === 'connected' || status === 'available' ? labels.connected :
      status === 'error' || status === 'unavailable' ? labels.error :
      status === 'disabled' ? labels.disabled :
      labels.configured
    const detail = mcpServerDescription(details, labels.configured)
    const catalogItem = RECOMMENDED_ITEMS.find((entry) => entry.kind === 'mcp' && entry.id === id)
    return {
      id,
      kind: 'mcp' as const,
      title: id,
      // Keep the catalog description for known servers so installing an item
      // does not replace its human-readable intro with the raw status string (#211).
      ...(catalogItem?.descriptionKey
        ? { descriptionKey: catalogItem.descriptionKey }
        : catalogItem?.description
          ? { description: catalogItem.description }
          : { description: detail }),
      detail,
      group: 'personal' as const,
      sourceLabel,
      statusTone: mcpStatusTone(status)
    }
  }).sort((left, right) => left.title.localeCompare(right.title))
}

function skillNameLooksValid(raw: string): boolean {
  const value = raw.trim()
  return !!value && value !== '.' && value !== '..' && !/[\\/]/.test(value)
}

const RECOMMENDED_ITEMS: MarketplaceItem[] = [
  {
    id: GUI_SCHEDULE_MCP_SERVER_ID,
    kind: 'mcp',
    titleKey: 'pluginMcpGuiScheduleTitle',
    descriptionKey: 'pluginMcpGuiScheduleDesc',
    group: 'recommended',
    systemManaged: true
  },
  {
    id: 'playwright',
    kind: 'mcp',
    titleKey: 'pluginMcpPlaywrightTitle',
    descriptionKey: 'pluginMcpPlaywrightDesc',
    group: 'recommended',
    mcpConfig: () =>
      buildMcpConfig(
        'playwright',
        'npx',
        ['-y', '@playwright/mcp@0.0.77']
      ),
    supplyChain: { source: 'mcp', packageName: '@playwright/mcp', version: '0.0.77', permissions: ['command', 'network', 'file'] }
  },
  {
    id: 'github',
    kind: 'mcp',
    titleKey: 'pluginMcpGithubTitle',
    descriptionKey: 'pluginMcpGithubDesc',
    group: 'recommended',
    mcpConfig: () =>
      buildMcpConfig(
        'github',
        'npx',
        ['-y', '@modelcontextprotocol/server-github@2025.4.8']
      ),
    supplyChain: { source: 'mcp', packageName: '@modelcontextprotocol/server-github', version: '2025.4.8', permissions: ['command', 'network', 'secret'] }
  },
  {
    id: 'vercel',
    kind: 'mcp',
    titleKey: 'pluginMcpVercelTitle',
    descriptionKey: 'pluginMcpVercelDesc',
    group: 'recommended',
    sourceLabel: 'OAuth',
    statusTone: 'warning',
    serverIds: ['vercel'],
    oauth: {
      docsUrl: 'https://vercel.com/docs/agent-resources/vercel-mcp.md',
      permissionKeys: [
        'pluginOAuthVercelPermissionAccount',
        'pluginOAuthVercelPermissionProjects',
        'pluginOAuthVercelPermissionDeployments',
        'pluginOAuthVercelPermissionLogs'
      ],
      setupKeys: [
        'pluginOAuthSetupInstall',
        'pluginOAuthVercelSetupProject',
        'pluginOAuthSetupAuthorize',
        'pluginOAuthSetupRestart'
      ],
      noteKey: 'pluginOAuthVercelNote'
    },
    supplyChain: { source: 'remote-mcp', permissions: ['network', 'secret'] },
    mcpConfig: () =>
      buildRemoteMcpConfig({
        vercel: 'https://mcp.vercel.com'
      })
  },
  {
    id: 'google-workspace',
    kind: 'mcp',
    titleKey: 'pluginMcpGoogleWorkspaceTitle',
    descriptionKey: 'pluginMcpGoogleWorkspaceDesc',
    group: 'recommended',
    sourceLabel: 'OAuth',
    statusTone: 'warning',
    serverIds: googleWorkspaceMcpServerIds(),
    oauth: {
      docsUrl: 'https://developers.google.com/workspace/guides/configure-mcp-servers',
      permissionKeys: [
        'pluginOAuthGooglePermissionGmail',
        'pluginOAuthGooglePermissionDrive',
        'pluginOAuthGooglePermissionDocs',
        'pluginOAuthGooglePermissionCalendar',
        'pluginOAuthGooglePermissionPeople',
        'pluginOAuthGooglePermissionChat'
      ],
      setupKeys: [
        'pluginOAuthGoogleSetupProject',
        'pluginOAuthGoogleSetupApis',
        'pluginOAuthGoogleSetupConsent',
        'pluginOAuthGoogleSetupAuthenticate',
        'pluginOAuthSetupInstall',
        'pluginOAuthSetupRestart'
      ],
      noteKey: 'pluginOAuthGoogleNote'
    },
    supplyChain: { source: 'remote-mcp', permissions: ['network', 'secret', 'file'] },
    mcpConfig: () =>
      buildRemoteMcpConfig(googleWorkspaceMcpServers())
  },
  {
    id: 'context7',
    kind: 'mcp',
    titleKey: 'pluginMcpContext7Title',
    descriptionKey: 'pluginMcpContext7Desc',
    group: 'recommended',
    mcpConfig: () =>
      buildMcpConfig(
        'context7',
        'npx',
        ['-y', '@upstash/context7-mcp@3.2.2']
      ),
    supplyChain: { source: 'mcp', packageName: '@upstash/context7-mcp', version: '3.2.2', permissions: ['command', 'network'] }
  },
  {
    id: 'sequential-thinking',
    kind: 'mcp',
    titleKey: 'pluginMcpSequentialThinkingTitle',
    descriptionKey: 'pluginMcpSequentialThinkingDesc',
    group: 'recommended',
    mcpConfig: () =>
      buildMcpConfig(
        'sequential-thinking',
        'npx',
        ['-y', '@modelcontextprotocol/server-sequential-thinking@2025.12.18']
      ),
    supplyChain: { source: 'mcp', packageName: '@modelcontextprotocol/server-sequential-thinking', version: '2025.12.18', permissions: ['command'] }
  },
  {
    id: 'memory',
    kind: 'mcp',
    titleKey: 'pluginMcpMemoryTitle',
    descriptionKey: 'pluginMcpMemoryDesc',
    group: 'recommended',
    mcpConfig: () =>
      buildMcpConfig(
        'memory',
        'npx',
        ['-y', '@modelcontextprotocol/server-memory@2026.1.26']
      ),
    supplyChain: { source: 'mcp', packageName: '@modelcontextprotocol/server-memory', version: '2026.1.26', permissions: ['command', 'file'] }
  },
  {
    id: 'brave-search',
    kind: 'mcp',
    titleKey: 'pluginMcpBraveSearchTitle',
    descriptionKey: 'pluginMcpBraveSearchDesc',
    group: 'recommended',
    mcpConfig: () =>
      buildMcpConfig(
        'brave-search',
        'npx',
        ['-y', '@modelcontextprotocol/server-brave-search@0.6.2'],
        { env: { BRAVE_API_KEY: '' } }
      ),
    supplyChain: { source: 'mcp', packageName: '@modelcontextprotocol/server-brave-search', version: '0.6.2', permissions: ['command', 'network', 'secret'] }
  },
  {
    id: 'code-review',
    kind: 'skill',
    titleKey: 'pluginSkillReviewTitle',
    descriptionKey: 'pluginSkillReviewDesc',
    group: 'recommended',
    supplyChain: { source: 'skill', permissions: ['file'] },
    skillInstructions:
      'Use this skill when reviewing a code change. Prioritize correctness, regressions, security, performance, and missing tests. Lead with concrete findings and file references.'
  },
  {
    id: 'frontend-polish',
    kind: 'skill',
    titleKey: 'pluginSkillFrontendTitle',
    descriptionKey: 'pluginSkillFrontendDesc',
    group: 'recommended',
    supplyChain: { source: 'skill', permissions: ['file'] },
    skillInstructions:
      'Use this skill when improving UI. Preserve the product style, check responsive states, avoid generic layouts, and verify the result visually before handing it back.'
  },
  {
    id: 'bug-hunt',
    kind: 'skill',
    titleKey: 'pluginSkillBugTitle',
    descriptionKey: 'pluginSkillBugDesc',
    group: 'recommended',
    supplyChain: { source: 'skill', permissions: ['file', 'command'] },
    skillInstructions:
      'Use this skill when investigating bugs. Reproduce or narrow the symptom, trace the data flow, identify the smallest fix, and add focused verification where possible.'
  },
  {
    id: 'release-notes',
    kind: 'skill',
    titleKey: 'pluginSkillReleaseTitle',
    descriptionKey: 'pluginSkillReleaseDesc',
    group: 'recommended',
    supplyChain: { source: 'skill', permissions: ['file'] },
    skillInstructions:
      'Use this skill when preparing release notes. Group user-facing changes by outcome, call out migrations or risks, and keep wording concise and scannable.'
  }
]

export function recommendedMarketplaceItemIds(): string[] {
  return RECOMMENDED_ITEMS.map((item) => item.id)
}

export function PluginMarketplaceView({ leftSidebarCollapsed, onToggleLeftSidebar }: Props): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = normalizeWorkspaceRoot(useChatStore((s) => s.workspaceRoot))
  const [activeKind, setActiveKind] = useState<PluginKind>('mcp')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PluginFilter>('all')
  const [installed, setInstalled] = useState<string[]>(() => loadInstalledPlugins())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [githubImportOpen, setGithubImportOpen] = useState(false)
  const [githubImportUrl, setGithubImportUrl] = useState('')
  const [githubImportBusy, setGithubImportBusy] = useState(false)
  const [githubImportSummary, setGithubImportSummary] = useState<{
    count: number
    names: string[]
  } | null>(null)
  const [customName, setCustomName] = useState('')
  const [customDescription, setCustomDescription] = useState('')
  const [customCommand, setCustomCommand] = useState('')
  const [customArgs, setCustomArgs] = useState('')
  const [customConfig, setCustomConfig] = useState('')
  const [customSkillBody, setCustomSkillBody] = useState('')
  const [skillRootId, setSkillRootId] = useState<SkillRootId>(() => loadPreferredSkillRootId())
  const [mcpConfigText, setMcpConfigText] = useState('')
  const [mcpLoaded, setMcpLoaded] = useState(false)
  const [runtimeInfo, setRuntimeInfo] = useState<CoreRuntimeInfoJson | null>(null)
  const [toolDiagnostics, setToolDiagnostics] = useState<CoreRuntimeToolDiagnosticsJson | null>(null)
  const [runtimeOverlayLoading, setRuntimeOverlayLoading] = useState(false)
  const [runtimeOverlayError, setRuntimeOverlayError] = useState('')
  const [mcpToggleBusyId, setMcpToggleBusyId] = useState<string | null>(null)
  const [discoveredSkills, setDiscoveredSkills] = useState<SkillListItem[]>([])
  const [skillListLoading, setSkillListLoading] = useState(false)
  const [skillListError, setSkillListError] = useState('')
  const [skillRoots, setSkillRoots] = useState<SkillRootListItem[]>([])
  const [disabledSkillIds, setDisabledSkillIds] = useState<string[]>([])
  const [skillToggleBusyId, setSkillToggleBusyId] = useState<string | null>(null)
  const [oauthPreviewItem, setOauthPreviewItem] = useState<MarketplaceItem | null>(null)

  const skillRootOptions = useMemo<SkillRootOption[]>(
    () => skillRootOptionsFromRoots(skillRoots, t),
    [skillRoots, t]
  )

  const selectedSkillRoot =
    skillRootOptions.find((option) => option.id === skillRootId) ??
    skillRootOptions.find((option) => option.enabled) ??
    skillRootOptions[0]

  useEffect(() => {
    if (skillRootOptions.length === 0) return
    if (skillRootOptions.some((option) => option.id === skillRootId)) {
      savePreferredSkillRootId(skillRootId)
      return
    }
    const fallback = skillRootOptions.find((option) => option.enabled) ?? skillRootOptions[0]
    if (fallback && fallback.id !== skillRootId) {
      setSkillRootId(fallback.id)
    }
  }, [skillRootId, skillRootOptions])

  const readMcpConfig = useCallback(async (): Promise<string> => {
    if (typeof window.kunGui?.getKunConfigFile !== 'function') return mcpConfigText
    const file = await window.kunGui.getKunConfigFile()
    setMcpConfigText(file.content)
    setMcpLoaded(true)
    return file.content
  }, [mcpConfigText])

  useEffect(() => {
    if (activeKind !== 'mcp' || mcpLoaded) return
    void readMcpConfig().catch((e) => {
      setNotice({ tone: 'error', message: e instanceof Error ? e.message : String(e) })
    })
  }, [activeKind, mcpLoaded, readMcpConfig])

  const refreshMcpRuntimeOverlay = useCallback(async (): Promise<void> => {
    if (typeof window.kunGui?.runtimeRequest !== 'function') {
      setRuntimeInfo(null)
      setToolDiagnostics(null)
      setRuntimeOverlayError(t('pluginMcpRuntimeUnavailable'))
      return
    }
    const provider = getProvider()
    if (!provider.getRuntimeInfo && !provider.getToolDiagnostics) {
      setRuntimeOverlayError(t('pluginMcpRuntimeUnavailable'))
      return
    }
    setRuntimeOverlayLoading(true)
    setRuntimeOverlayError('')
    try {
      const [runtimeResult, diagnosticsResult] = await Promise.allSettled([
        provider.getRuntimeInfo?.(),
        provider.getToolDiagnostics?.()
      ])
      if (runtimeResult.status === 'fulfilled' && runtimeResult.value) {
        setRuntimeInfo(runtimeResult.value)
      }
      if (diagnosticsResult.status === 'fulfilled' && diagnosticsResult.value) {
        setToolDiagnostics(diagnosticsResult.value)
      }
      const errors = [runtimeResult, diagnosticsResult]
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => runtimeOverlayErrorMessage(result.reason, t('pluginMcpRuntimeUnavailable')))
      if (errors.length > 0) setRuntimeOverlayError(errors[0] ?? t('pluginActionFailed'))
    } finally {
      setRuntimeOverlayLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (activeKind !== 'mcp') return
    void refreshMcpRuntimeOverlay()
  }, [activeKind, refreshMcpRuntimeOverlay])

  const refreshSkillList = useCallback(async (): Promise<void> => {
    if (typeof window.kunGui?.listSkills !== 'function') {
      setDiscoveredSkills([])
      setSkillListError(t('pluginSkillScanUnavailable'))
      return
    }
    setSkillListLoading(true)
    setSkillListError('')
    try {
      const result = await window.kunGui.listSkills(workspaceRoot || undefined)
      if (!result.ok) {
        setDiscoveredSkills([])
        setSkillListError(result.message)
        return
      }
      setDiscoveredSkills(result.skills)
      if (result.validationErrors.length > 0) {
        setSkillListError(result.validationErrors[0]?.message ?? t('pluginSkillScanPartial'))
      }
    } catch (error) {
      setDiscoveredSkills([])
      setSkillListError(error instanceof Error ? error.message : String(error))
    } finally {
      setSkillListLoading(false)
    }
  }, [t, workspaceRoot])

  const refreshSkillRoots = useCallback(async (): Promise<void> => {
    if (typeof window.kunGui?.listSkillRoots !== 'function') {
      setSkillRoots([])
      return
    }
    try {
      const result = await window.kunGui.listSkillRoots(workspaceRoot || undefined)
      setSkillRoots(result.ok ? result.roots : [])
    } catch {
      setSkillRoots([])
    }
  }, [workspaceRoot])

  useEffect(() => {
    if (activeKind !== 'skill') return
    void refreshSkillList()
    void refreshSkillRoots()
  }, [activeKind, refreshSkillList, refreshSkillRoots])

  useEffect(() => {
    if (activeKind !== 'skill') return
    let cancelled = false
    void rendererRuntimeClient.getSettings({ forceRefresh: true })
      .then((settings) => {
        if (!cancelled) setDisabledSkillIds(normalizeDisabledSkillIds(settings.disabledSkillIds))
      })
      .catch(() => {
        if (!cancelled) setDisabledSkillIds([])
      })
    return () => {
      cancelled = true
    }
  }, [activeKind])

  useEffect(() => {
    setNotice(null)
    setCustomOpen(false)
    setGithubImportOpen(false)
    setGithubImportSummary(null)
  }, [activeKind])

  const markInstalled = (key: string): void => {
    setInstalled((prev) => {
      const next = [...new Set([...prev, key])]
      saveInstalledPlugins(next)
      return next
    })
  }

  const discoveredSkillIds = useMemo(
    () => new Set(discoveredSkills.map((skill) => skill.id)),
    [discoveredSkills]
  )
  const discoveredSkillItems = useMemo(
    () => skillMarketplaceItemsFromDiscoveredSkills(discoveredSkills, {
      project: t('pluginSkillSourceProject'),
      global: t('pluginSkillSourceGlobal')
    }),
    [discoveredSkills, t]
  )
  const discoveredMcpItems = useMemo(
    () => mcpMarketplaceItemsFromConfigAndDiagnostics(mcpConfigText, toolDiagnostics, {
      configured: t('pluginMcpSourceConfigured'),
      connected: t('pluginMcpSourceConnected'),
      error: t('pluginMcpSourceError'),
      disabled: t('pluginMcpSourceDisabled')
    }).filter((item) => item.id !== GUI_SCHEDULE_MCP_SERVER_ID),
    [mcpConfigText, t, toolDiagnostics]
  )
  const discoveredMcpIds = useMemo(
    () => new Set(discoveredMcpItems.map((item) => item.id)),
    [discoveredMcpItems]
  )
  const marketplaceItems = useMemo(
    () => activeKind === 'skill'
      ? [...RECOMMENDED_ITEMS, ...discoveredSkillItems]
      : [...RECOMMENDED_ITEMS, ...discoveredMcpItems],
    [activeKind, discoveredMcpItems, discoveredSkillItems]
  )

  const isInstalled = useCallback((item: Pick<MarketplaceItem, 'kind' | 'id'> & Partial<Pick<MarketplaceItem, 'group' | 'serverIds'>>): boolean => {
    if ('group' in item && item.group === 'personal') return true
    const catalogItem = RECOMMENDED_ITEMS.find((candidate) => candidate.kind === item.kind && candidate.id === item.id)
    if (catalogItem?.systemManaged) return true
    if (item.kind === 'skill' && discoveredSkillIds.has(item.id)) return true
    if (item.kind === 'mcp' && discoveredMcpIds.has(item.id)) return true
    if (item.kind === 'mcp' && item.serverIds?.length) return mcpConfigHasServers(mcpConfigText, item.serverIds)
    const key = storageKey(item.kind, item.id)
    if (installed.includes(key)) return true
    return item.kind === 'mcp' && mcpConfigHasServer(mcpConfigText, item.id)
  }, [discoveredMcpIds, discoveredSkillIds, installed, mcpConfigText])

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return marketplaceItems.filter((item) => item.kind === activeKind)
      .filter((item) => {
        const title = itemTitle(item, t).toLowerCase()
        const description = itemDescription(item, t).toLowerCase()
        const source = item.sourceLabel?.toLowerCase() ?? ''
        return !normalizedQuery ||
          title.includes(normalizedQuery) ||
          description.includes(normalizedQuery) ||
          source.includes(normalizedQuery) ||
          item.id.includes(normalizedQuery)
      })
      .filter((item) => {
        if (filter === 'recommended') return item.group === 'recommended'
        if (filter === 'installed') return isInstalled(item)
        return true
      })
  }, [activeKind, filter, isInstalled, marketplaceItems, query, t])

  const builtInItems = visibleItems.filter((item) => item.systemManaged)
  const recommendedItems = visibleItems.filter((item) => !item.systemManaged && !isInstalled(item))
  const personalItems = visibleItems.filter((item) =>
    item.group === 'personal' ||
    (!item.systemManaged && isInstalled(item) && !discoveredSkillIds.has(item.id) && !discoveredMcpIds.has(item.id))
  )
  const mcpRuntimeOverlay = useMemo(
    () => buildMcpMarketplaceOverlay({
      runtimeInfo,
      toolDiagnostics,
      managedServers: [{ id: GUI_SCHEDULE_MCP_SERVER_ID, toolCount: 4 }]
    }),
    [runtimeInfo, toolDiagnostics]
  )

  const appendMcpConfig = async (id: string, config: JsonRecord): Promise<void> => {
    const content = mcpLoaded ? mcpConfigText : await readMcpConfig()
    const merged = mergeMcpJsonConfig(content, config)
    if (merged.alreadyExists) {
      markInstalled(storageKey('mcp', id))
      setNotice({ tone: 'info', message: t('pluginAlreadyAdded') })
      return
    }
    const result = await window.kunGui.setKunConfigFile(merged.text)
    setMcpConfigText(merged.text)
    setMcpLoaded(true)
    markInstalled(storageKey('mcp', id))
    setNotice({ tone: 'success', message: t('pluginMcpAdded', { path: result.path }) })
  }

  const installMcpItem = async (item: MarketplaceItem): Promise<void> => {
    if (!item.mcpConfig) return
    const audit = auditMarketplaceInstall(item, workspaceRoot)
    if (!audit.ok) throw new Error(audit.errors.join('\n'))
    await appendMcpConfig(item.id, item.mcpConfig(workspaceRoot))
  }

  const addItem = async (item: MarketplaceItem): Promise<void> => {
    if (item.kind === 'mcp' && item.oauth) {
      setNotice(null)
      setOauthPreviewItem(item)
      return
    }
    setBusyId(storageKey(item.kind, item.id))
    setNotice(null)
    try {
      if (item.kind === 'mcp') {
        await installMcpItem(item)
        return
      }

      if (!selectedSkillRoot?.path) {
        setNotice({ tone: 'error', message: t('pluginSkillRootMissing') })
        return
      }
      if (item.group === 'personal') return
      const title = itemTitle(item, t)
      const description = itemDescription(item, t)
      const content = buildSkillContent(
        item.id,
        title,
        description,
        item.skillInstructions ?? description
      )
      const result = await window.kunGui.saveSkillFile(selectedSkillRoot.path, item.id, content)
      if (!result.ok) {
        setNotice({ tone: 'error', message: result.message })
        return
      }
      markInstalled(storageKey('skill', item.id))
      await Promise.all([refreshSkillList(), refreshSkillRoots()])
      setNotice({ tone: 'success', message: t('pluginSkillAdded', { path: result.path }) })
    } catch (e) {
      setNotice({ tone: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusyId(null)
    }
  }

  const confirmOauthInstall = async (item: MarketplaceItem): Promise<void> => {
    setOauthPreviewItem(null)
    setBusyId(storageKey(item.kind, item.id))
    setNotice(null)
    try {
      await installMcpItem(item)
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusyId(null)
    }
  }

  const addCustom = async (): Promise<void> => {
    const id = normalizePluginId(customName)
    if (!id) {
      setNotice({ tone: 'error', message: t('pluginCustomNameRequired') })
      return
    }
    const description = customDescription.trim() || t('pluginCustomFallbackDesc')
    setBusyId(`custom:${activeKind}`)
    setNotice(null)
    try {
      if (activeKind === 'mcp') {
        const fallback = buildMcpConfig(
          id,
          customCommand.trim() || 'npx',
          customArgs
            .split('\n')
            .map((arg) => arg.trim())
            .filter(Boolean)
        )
        const fragment = customMcpConfigFragment(id, customConfig, fallback)
        const audit = auditMcpConfigSupplyChain(fragment)
        if (!audit.ok) throw new Error(audit.errors.join('\n'))
        await appendMcpConfig(id, fragment)
      } else {
        if (!selectedSkillRoot?.path) {
          setNotice({ tone: 'error', message: t('pluginSkillRootMissing') })
          return
        }
        const body = customSkillBody.trim() || t('pluginCustomSkillFallbackBody')
        const content = buildSkillContent(id, customName.trim() || id, description, body)
        const result = await window.kunGui.saveSkillFile(selectedSkillRoot.path, id, content)
        if (!result.ok) {
          setNotice({ tone: 'error', message: result.message })
          return
        }
        markInstalled(storageKey('skill', id))
        await Promise.all([refreshSkillList(), refreshSkillRoots()])
        setNotice({ tone: 'success', message: t('pluginSkillAdded', { path: result.path }) })
      }
      setCustomName('')
      setCustomDescription('')
      setCustomCommand('')
      setCustomArgs('')
      setCustomConfig('')
      setCustomSkillBody('')
      setCustomOpen(false)
    } catch (e) {
      setNotice({ tone: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusyId(null)
    }
  }

  const toggleSkillEnabled = async (id: string, enabled: boolean): Promise<void> => {
    const normalizedId = normalizeSkillId(id)
    if (!normalizedId) return
    setSkillToggleBusyId(normalizedId)
    setNotice(null)
    try {
      const next = enabled
        ? disabledSkillIds.filter((item) => item !== normalizedId)
        : [...new Set([...disabledSkillIds, normalizedId])]
      const settings = await rendererRuntimeClient.setSettings({ disabledSkillIds: next })
      const normalized = normalizeDisabledSkillIds(settings.disabledSkillIds)
      setDisabledSkillIds(normalized)
      useChatStore.setState({ disabledSkillIds: normalized })
      setNotice({
        tone: 'success',
        message: enabled ? t('pluginSkillEnabled') : t('pluginSkillDisabled')
      })
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setSkillToggleBusyId(null)
    }
  }

  const toggleMcpEnabled = async (id: string, enabled: boolean): Promise<void> => {
    setMcpToggleBusyId(id)
    setNotice(null)
    try {
      const content = mcpLoaded ? mcpConfigText : await readMcpConfig()
      const nextText = setMcpServerEnabled(content, id, enabled)
      await window.kunGui.setKunConfigFile(nextText)
      setMcpConfigText(nextText)
      setMcpLoaded(true)
      setNotice({
        tone: 'success',
        message: enabled ? t('pluginMcpEnabled') : t('pluginMcpDisabled')
      })
      await refreshMcpRuntimeOverlay()
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setMcpToggleBusyId(null)
    }
  }

  const openManageTarget = async (): Promise<void> => {
    try {
      if (activeKind === 'mcp') {
        const result = await window.kunGui.openKunConfigDir()
        if (!result.ok) setNotice({ tone: 'error', message: result.message ?? t('pluginActionFailed') })
        return
      }
      if (!selectedSkillRoot?.path) {
        setNotice({ tone: 'error', message: t('pluginSkillRootMissing') })
        return
      }
      const result = await window.kunGui.openSkillRoot(selectedSkillRoot.path)
      if (!result.ok) setNotice({ tone: 'error', message: result.message ?? t('pluginActionFailed') })
    } catch (e) {
      setNotice({ tone: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  const addFromGitHub = async (): Promise<void> => {
    if (!selectedSkillRoot?.path) {
      setNotice({ tone: 'error', message: t('pluginSkillRootMissing') })
      return
    }
    const trimmedUrl = githubImportUrl.trim()
    if (!trimmedUrl) {
      setNotice({ tone: 'error', message: t('pluginGithubImportUrlRequired') })
      return
    }
    setGithubImportBusy(true)
    setNotice(null)
    setGithubImportSummary(null)
    try {
      const result = await window.kunGui.importSkillsFromGitHub(selectedSkillRoot.path, trimmedUrl)
      if (!result.ok) {
        throw new Error(result.message)
      }
      await Promise.all([refreshSkillList(), refreshSkillRoots()])
      setGithubImportSummary({
        count: result.count,
        names: result.names
      })
      setNotice({ tone: 'success', message: t('pluginGithubImportSuccess', { count: result.count }) })
      setGithubImportUrl('')
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setGithubImportBusy(false)
    }
  }

  return (
    <div className="ds-drag flex h-full min-h-0 flex-col bg-ds-main">
      <div className="ds-stage-inset shrink-0">
        <header className="ds-topbar-surface relative z-10 mt-3 flex min-h-[46px] w-full items-stretch overflow-visible rounded-[24px]">
          <div className="grid w-full min-w-0 items-center gap-2.5 px-3 py-2 sm:px-4 md:pl-5 md:pr-2">
            <div
              className={`flex min-w-0 items-center gap-2.5 ${
                leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''
              }`}
            >
              <SidebarTitlebarToggleButton
                onClick={onToggleLeftSidebar}
                title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
                ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
              />
              <h1 className="sr-only">{t('plugins')}</h1>
            </div>
          </div>
        </header>
      </div>

      <main className="ds-no-drag min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-7 md:px-10 lg:px-14">
        <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-xl bg-ds-subtle p-1">
            <TabButton active={activeKind === 'mcp'} onClick={() => setActiveKind('mcp')}>
              {t('pluginTabMcp')}
            </TabButton>
            <TabButton active={activeKind === 'skill'} tone="skill" onClick={() => setActiveKind('skill')}>
              {t('pluginTabSkill')}
            </TabButton>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void openManageTarget()}
              className="inline-flex items-center gap-2 rounded-xl bg-ds-subtle px-3 py-2 text-[13px] font-semibold text-ds-ink transition hover:bg-ds-hover"
            >
              <Settings className="h-4 w-4" strokeWidth={1.75} />
              {t('pluginManage')}
            </button>
            <button
              type="button"
              onClick={() => {
                setCustomOpen((value) => !value)
                setGithubImportOpen(false)
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" strokeWidth={1.9} />
              {t('pluginCreate')}
            </button>
            {activeKind === 'skill' ? (
              <button
                type="button"
                onClick={() => {
                  setGithubImportOpen((value) => !value)
                  setCustomOpen(false)
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-semibold text-ds-ink shadow-sm transition hover:bg-ds-hover"
              >
                <Download className="h-4 w-4" strokeWidth={1.9} />
                {t('pluginGithubImport')}
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-9 flex flex-col items-center text-center">
          <h1 className="text-[32px] font-semibold text-ds-ink md:text-[40px]">
            {activeKind === 'mcp' ? t('pluginMcpTitle') : t('pluginSkillTitle')}
          </h1>
        </div>

        <div className="mt-9 flex flex-col gap-3 md:flex-row md:items-center">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-11 w-full rounded-2xl border border-ds-border bg-ds-card pl-11 pr-4 text-[15px] text-ds-ink shadow-sm outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
              placeholder={activeKind === 'mcp' ? t('pluginSearchMcp') : t('pluginSearchSkill')}
            />
          </label>
          <label className="relative w-full md:w-[168px]">
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as PluginFilter)}
              className="h-11 w-full appearance-none rounded-2xl border border-ds-border bg-ds-card px-4 pr-9 text-[15px] font-medium text-ds-ink shadow-sm outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
            >
              <option value="all">{t('pluginFilterAll')}</option>
              <option value="recommended">{t('pluginFilterRecommended')}</option>
              <option value="installed">{t('pluginFilterInstalled')}</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-faint" />
          </label>
        </div>

        {activeKind === 'skill' ? (
          <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center">
            <select
              value={selectedSkillRoot?.id ?? ''}
              onChange={(event) => setSkillRootId(event.target.value as SkillRootId)}
              disabled={skillRootOptions.length === 0}
              className="h-10 rounded-xl border border-ds-border bg-ds-card px-3 text-[13px] text-ds-ink shadow-sm outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {skillRootOptions.length === 0 ? (
                <option value="">{t('pluginSkillRootNone')}</option>
              ) : (
                skillRootOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.enabled ? option.label : `${option.label} · ${t('pluginSkillStatusDisabled')}`}
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              onClick={() => void openManageTarget()}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
            >
              <FolderOpen className="h-4 w-4" />
              {t('pluginOpenLocation')}
            </button>
            <button
              type="button"
              onClick={() => void Promise.all([refreshSkillList(), refreshSkillRoots()])}
              disabled={skillListLoading}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {skillListLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {t('pluginSkillRefresh')}
            </button>
            {skillListError ? (
              <span className="text-[12px] text-red-700 dark:text-red-300">
                {skillListError}
              </span>
            ) : (
              <span className="text-[12px] text-ds-faint">
                {t('pluginSkillDiscoveredCountWithEnabled', {
                  count: discoveredSkills.length,
                  enabled: discoveredSkills.filter((skill) => !disabledSkillIds.includes(normalizeSkillId(skill.id))).length
                })}
              </span>
            )}
          </div>
        ) : null}

        {activeKind === 'mcp' ? (
          <McpRuntimeOverlayPanel
            overlay={mcpRuntimeOverlay}
            loading={runtimeOverlayLoading}
            error={runtimeOverlayError}
            onRefresh={() => void refreshMcpRuntimeOverlay()}
            t={t}
          />
        ) : null}

        {customOpen ? (
          <CustomPluginPanel
            activeKind={activeKind}
            customName={customName}
            customDescription={customDescription}
            customCommand={customCommand}
            customArgs={customArgs}
            customConfig={customConfig}
            customSkillBody={customSkillBody}
            busy={busyId === `custom:${activeKind}`}
            onNameChange={setCustomName}
            onDescriptionChange={setCustomDescription}
            onCommandChange={setCustomCommand}
            onArgsChange={setCustomArgs}
            onConfigChange={setCustomConfig}
            onSkillBodyChange={setCustomSkillBody}
            onAdd={() => void addCustom()}
          />
        ) : null}

        {activeKind === 'skill' && githubImportOpen ? (
          <GitHubSkillImportPanel
            url={githubImportUrl}
            busy={githubImportBusy}
            summary={githubImportSummary}
            onUrlChange={setGithubImportUrl}
            onImport={() => void addFromGitHub()}
          />
        ) : null}

        {notice ? <NoticeView notice={notice} /> : null}
        {oauthPreviewItem?.oauth ? (
          <OAuthConnectorPreviewDialog
            item={oauthPreviewItem}
            onClose={() => setOauthPreviewItem(null)}
            onConfirm={() => void confirmOauthInstall(oauthPreviewItem)}
            t={t}
          />
        ) : null}

        {activeKind === 'mcp' ? (
          <PluginSection
            title={t('pluginBuiltIn')}
            emptyText={t('pluginNoResults')}
            items={builtInItems}
            busyId={busyId}
            isInstalled={isInstalled}
            onAdd={addItem}
            disabledSkillIds={disabledSkillIds}
            skillToggleBusyId={skillToggleBusyId}
            onToggleSkillEnabled={toggleSkillEnabled}
            mcpConfigText={mcpConfigText}
            mcpToggleBusyId={mcpToggleBusyId}
            onToggleMcpEnabled={toggleMcpEnabled}
            t={t}
          />
        ) : null}

        <PluginSection
          title={t('pluginRecommended')}
          emptyText={t('pluginNoResults')}
          items={recommendedItems}
          busyId={busyId}
          isInstalled={isInstalled}
          onAdd={addItem}
          disabledSkillIds={disabledSkillIds}
          skillToggleBusyId={skillToggleBusyId}
          onToggleSkillEnabled={toggleSkillEnabled}
          mcpConfigText={mcpConfigText}
          mcpToggleBusyId={mcpToggleBusyId}
          onToggleMcpEnabled={toggleMcpEnabled}
          t={t}
        />

        <PluginSection
          title={t('pluginPersonal')}
          emptyText={t('pluginPersonalEmpty')}
          items={personalItems}
          busyId={busyId}
          isInstalled={isInstalled}
          onAdd={addItem}
          disabledSkillIds={disabledSkillIds}
          skillToggleBusyId={skillToggleBusyId}
          onToggleSkillEnabled={toggleSkillEnabled}
          mcpConfigText={mcpConfigText}
          mcpToggleBusyId={mcpToggleBusyId}
          onToggleMcpEnabled={toggleMcpEnabled}
          t={t}
        />

        {activeKind === 'mcp' ? (
          <div className="mt-8 flex items-center gap-2 text-[12px] text-ds-faint">
            <RefreshCw className="h-3.5 w-3.5" />
            <span>{t('pluginMcpRestartHint')}</span>
          </div>
        ) : null}
        </div>
      </main>
    </div>
  )
}

function GitHubSkillImportPanel({
  url,
  busy,
  summary,
  onUrlChange,
  onImport
}: {
  url: string
  busy: boolean
  summary: { count: number; names: string[] } | null
  onUrlChange: (value: string) => void
  onImport: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <section className="mt-6 rounded-2xl border border-ds-border bg-ds-card/95 p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <input
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          className="h-10 min-w-0 flex-1 rounded-xl border border-ds-border bg-ds-main/45 px-3 text-[14px] text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
          placeholder={t('pluginGithubImportPlaceholder')}
          spellCheck={false}
        />
        <button
          type="button"
          onClick={onImport}
          disabled={busy}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-ds-userbubble px-4 text-[13px] font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Download className="h-4 w-4" strokeWidth={2} />}
          {t('pluginGithubImportAction')}
        </button>
      </div>
      <p className="mt-2 text-[12px] text-ds-faint">
        {t('pluginGithubImportHint')}
      </p>
      {summary ? (
        <p className="mt-3 text-[12px] text-ds-muted">
          {t('pluginGithubImportResult', {
            count: summary.count,
            names: summary.names.join(', ')
          })}
        </p>
      ) : null}
    </section>
  )
}

function McpRuntimeOverlayPanel({
  overlay,
  loading,
  error,
  onRefresh,
  t
}: {
  overlay: McpMarketplaceOverlay
  loading: boolean
  error: string
  onRefresh: () => void
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement {
  const status = mcpRuntimeStatusLabel(overlay.status, t)
  return (
    <section className="mt-4 rounded-lg border border-ds-border bg-ds-card px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.8} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-ds-ink">{t('pluginMcpRuntimeOverlay')}</span>
              <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${mcpRuntimeStatusTone(overlay.status)}`}>
                {status}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ds-muted">
              <span>{t('pluginMcpRuntimeServers', {
                connected: overlay.connectedServers,
                configured: overlay.configuredServers
              })}</span>
              <span>{t('pluginMcpRuntimeTools', { count: overlay.toolCount })}</span>
              <span>{t('pluginMcpRuntimeSearch', {
                mode: overlay.searchMode,
                status: overlay.searchActive ? t('pluginMcpRuntimeSearchActive') : t('pluginMcpRuntimeSearchInactive'),
                indexed: overlay.indexedToolCount,
                advertised: overlay.advertisedToolCount
              })}</span>
              {overlay.driftCount > 0 ? <span>{t('pluginMcpRuntimeDrift', { count: overlay.driftCount })}</span> : null}
            </div>
            {overlay.serverIds.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {overlay.serverIds.map((id) => (
                  <span
                    key={id}
                    className="rounded-md border border-ds-border-muted bg-ds-subtle px-2 py-0.5 font-mono text-[11px] text-ds-muted"
                  >
                    {id}
                  </span>
                ))}
              </div>
            ) : null}
            {error || overlay.lastError ? (
              <div className="mt-2 truncate text-[12px] text-red-700 dark:text-red-300">
                {error || t('pluginMcpRuntimeLastError', { message: overlay.lastError })}
              </div>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-ds-border bg-ds-subtle px-3 text-[12px] font-semibold text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t('pluginMcpRuntimeRefresh')}
        </button>
      </div>
    </section>
  )
}

function mcpRuntimeStatusLabel(
  status: McpMarketplaceOverlayStatus,
  t: (key: string) => string
): string {
  switch (status) {
    case 'connected':
      return t('pluginMcpRuntimeConnected')
    case 'configured':
      return t('pluginMcpRuntimeConfigured')
    case 'drift':
      return t('pluginMcpRuntimeDrifted')
    case 'error':
      return t('pluginMcpRuntimeError')
    case 'disabled':
      return t('pluginMcpRuntimeDisabled')
    case 'offline':
      return t('pluginMcpRuntimeOffline')
  }
}

function mcpRuntimeStatusTone(status: McpMarketplaceOverlayStatus): string {
  switch (status) {
    case 'connected':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200'
    case 'configured':
      return 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-200'
    case 'drift':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200'
    case 'error':
      return 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-200'
    case 'disabled':
    case 'offline':
      return 'bg-ds-subtle text-ds-muted'
  }
}

function marketplaceSourceTone(tone: MarketplaceItem['statusTone']): string {
  switch (tone) {
    case 'success':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200'
    case 'warning':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200'
    case 'error':
      return 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
    case 'default':
    default:
      return 'bg-ds-subtle text-ds-muted'
  }
}

function runtimeOverlayErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error)
  return /runtimeRequest|kunGui|Cannot read properties/i.test(message) ? fallback : message
}

function OAuthConnectorPreviewDialog({
  item,
  onClose,
  onConfirm,
  t
}: {
  item: MarketplaceItem
  onClose: () => void
  onConfirm: () => void
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement {
  const oauth = item.oauth
  const title = itemTitle(item, t)
  const openDocs = (): void => {
    if (!oauth || typeof window.kunGui?.openExternal !== 'function') return
    // Only open allowlisted https docs origins; ignore anything else so a
    // malformed or unexpected docsUrl can never reach the OS link handler.
    if (!isAllowedDocsUrl(oauth.docsUrl)) return
    void window.kunGui.openExternal(oauth.docsUrl).catch(() => undefined)
  }

  if (!oauth) return <></>

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-8 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t('pluginOAuthPreviewTitle', { name: title })}
        className="max-h-full w-full max-w-2xl overflow-y-auto rounded-3xl border border-ds-border bg-ds-card p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-ds-subtle text-ds-ink">
              <Info className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <h2 className="text-[18px] font-semibold text-ds-ink">
                {t('pluginOAuthPreviewTitle', { name: title })}
              </h2>
              <p className="mt-1 text-[13px] leading-5 text-ds-muted">
                {t('pluginOAuthPreviewDesc')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('pluginOAuthClose')}
          >
            <span aria-hidden="true" className="text-[18px] leading-none">x</span>
          </button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-ds-border bg-ds-main/35 p-4">
            <div className="text-[13px] font-semibold text-ds-ink">{t('pluginOAuthPermissionsTitle')}</div>
            <ul className="mt-3 grid gap-2 text-[13px] leading-5 text-ds-muted">
              {oauth.permissionKeys.map((key) => (
                <li key={key} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ds-muted/70" />
                  <span>{t(key)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-ds-border bg-ds-main/35 p-4">
            <div className="text-[13px] font-semibold text-ds-ink">{t('pluginOAuthSetupTitle')}</div>
            <ol className="mt-3 grid gap-2 text-[13px] leading-5 text-ds-muted">
              {oauth.setupKeys.map((key, index) => (
                <li key={key} className="flex gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ds-subtle text-[11px] font-semibold text-ds-ink">
                    {index + 1}
                  </span>
                  <span>{t(key)}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {oauth.noteKey ? (
          <div className="mt-4 rounded-2xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-[13px] leading-5 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/25 dark:text-amber-200">
            {t(oauth.noteKey)}
          </div>
        ) : null}

        <div className="mt-5 rounded-2xl border border-ds-border bg-ds-main/35 p-4">
          <div className="text-[13px] font-semibold text-ds-ink">{t('pluginOAuthConfigPreviewTitle')}</div>
          <pre className="mt-3 max-h-52 overflow-auto rounded-xl bg-ds-sidebar/70 p-3 text-[12px] leading-5 text-ds-muted">
            {item.mcpConfig ? JSON.stringify(item.mcpConfig(''), null, 2) : '{}'}
          </pre>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={openDocs}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-ds-border bg-ds-card px-4 py-2 text-[13px] font-semibold text-ds-ink transition hover:bg-ds-hover"
          >
            {t('pluginOAuthOpenDocs')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-xl bg-ds-subtle px-4 py-2 text-[13px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            {t('pluginOAuthCancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center justify-center rounded-xl bg-ds-userbubble px-4 py-2 text-[13px] font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
          >
            {t('pluginOAuthInstall')}
          </button>
        </div>
      </section>
    </div>
  )
}

function PluginSection({
  title,
  emptyText,
  items,
  busyId,
  isInstalled,
  onAdd,
  disabledSkillIds = [],
  skillToggleBusyId = null,
  onToggleSkillEnabled,
  mcpConfigText = '',
  mcpToggleBusyId = null,
  onToggleMcpEnabled,
  t
}: {
  title: string
  emptyText: string
  items: MarketplaceItem[]
  busyId: string | null
  isInstalled: (item: Pick<MarketplaceItem, 'kind' | 'id'> & Partial<Pick<MarketplaceItem, 'group' | 'serverIds'>>) => boolean
  onAdd: (item: MarketplaceItem) => Promise<void>
  disabledSkillIds?: string[]
  skillToggleBusyId?: string | null
  onToggleSkillEnabled?: (id: string, enabled: boolean) => Promise<void>
  mcpConfigText?: string
  mcpToggleBusyId?: string | null
  onToggleMcpEnabled?: (id: string, enabled: boolean) => Promise<void>
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement {
  return (
    <section className="mt-8">
      <h2 className="border-b border-ds-border-muted pb-3 text-[20px] font-semibold text-ds-ink">
        {title}
      </h2>
      {items.length === 0 ? (
        <div className="py-8 text-[14px] text-ds-faint">{emptyText}</div>
      ) : (
        <div className="grid gap-x-14 md:grid-cols-2">
          {items.map((item) => {
            const itemKey = storageKey(item.kind, item.id)
            const installed = isInstalled(item)
            const busy = busyId === itemKey
            const normalizedSkillId = normalizeSkillId(item.id)
            const skillDisabled = item.kind === 'skill' && disabledSkillIds.includes(normalizedSkillId)
            const canToggleSkill = item.kind === 'skill' && item.group === 'personal' && onToggleSkillEnabled
            const toggleBusy = skillToggleBusyId === normalizedSkillId
            const mcpConfig = item.kind === 'mcp' ? mcpServerConfigFromText(mcpConfigText, item.id) : undefined
            const mcpDisabled = item.kind === 'mcp' && !mcpServerEnabledFromConfig(mcpConfig)
            const canToggleMcp = item.kind === 'mcp' && item.group === 'personal' && !!mcpConfig && onToggleMcpEnabled
            const mcpBusy = mcpToggleBusyId === item.id
            return (
              <div
                key={itemKey}
                className="flex min-h-[92px] items-center gap-5 border-b border-ds-border-muted py-5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[17px] font-semibold text-ds-ink">
                      {itemTitle(item, t)}
                    </span>
                    {item.sourceLabel ? (
                      <span
                        className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${marketplaceSourceTone(item.statusTone)}`}
                      >
                        {item.sourceLabel}
                      </span>
                    ) : null}
                    {skillDisabled ? (
                      <span className="shrink-0 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-200">
                        {t('pluginSkillStatusDisabled')}
                      </span>
                    ) : null}
                    {mcpDisabled ? (
                      <span className="shrink-0 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-200">
                        {t('pluginMcpStatusDisabled')}
                      </span>
                    ) : null}
                    {item.oauth ? (
                      <span className="shrink-0 rounded-md bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-200">
                        {t('pluginOAuthBadge')}
                      </span>
                    ) : null}
                    {item.supplyChain?.permissions.length ? (
                      <span className="shrink-0 rounded-md bg-ds-subtle px-2 py-0.5 text-[11px] font-semibold text-ds-muted">
                        {item.supplyChain.permissions.map((permission) => PERMISSION_LABELS[permission]).join(' / ')}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[14px] leading-5 text-ds-muted">
                    {itemDescription(item, t)}
                  </p>
                  {item.detail && item.detail !== itemDescription(item, t) ? (
                    <p className="mt-0.5 truncate font-mono text-[12px] text-ds-faint" title={item.detail}>
                      {item.detail}
                    </p>
                  ) : null}
                </div>
                {canToggleSkill ? (
                  <button
                    type="button"
                    disabled={toggleBusy}
                    onClick={() => void onToggleSkillEnabled(item.id, skillDisabled)}
                    title={skillDisabled ? t('pluginSkillEnable') : t('pluginSkillDisable')}
                    className={`inline-flex h-9 shrink-0 items-center justify-center rounded-xl px-3 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      skillDisabled
                        ? 'bg-ds-subtle text-ds-ink hover:bg-ds-hover'
                        : 'bg-ds-skill-soft text-ds-skill hover:opacity-85'
                    }`}
                  >
                    {toggleBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                    ) : skillDisabled ? (
                      t('pluginSkillEnable')
                    ) : (
                      t('pluginSkillDisable')
                    )}
                  </button>
                ) : canToggleMcp ? (
                  <button
                    type="button"
                    disabled={mcpBusy}
                    onClick={() => void onToggleMcpEnabled(item.id, mcpDisabled)}
                    title={mcpDisabled ? t('pluginMcpEnable') : t('pluginMcpDisable')}
                    className={`inline-flex h-9 shrink-0 items-center justify-center rounded-xl px-3 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      mcpDisabled
                        ? 'bg-ds-subtle text-ds-ink hover:bg-ds-hover'
                        : 'bg-ds-subtle text-ds-muted hover:bg-ds-hover'
                    }`}
                  >
                    {mcpBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                    ) : mcpDisabled ? (
                      t('pluginMcpEnable')
                    ) : (
                      t('pluginMcpDisable')
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={installed || busy}
                    onClick={() => void onAdd(item)}
                    title={installed ? t('pluginAdded') : t('pluginAdd')}
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition ${
                      installed
                        ? 'text-ds-faint'
                        : 'bg-ds-subtle text-ds-ink hover:bg-ds-hover disabled:opacity-60'
                    }`}
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                    ) : installed ? (
                      <Check className="h-4 w-4" strokeWidth={2} />
                    ) : (
                      <Plus className="h-4 w-4" strokeWidth={2} />
                    )}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function CustomPluginPanel({
  activeKind,
  customName,
  customDescription,
  customCommand,
  customArgs,
  customConfig,
  customSkillBody,
  busy,
  onNameChange,
  onDescriptionChange,
  onCommandChange,
  onArgsChange,
  onConfigChange,
  onSkillBodyChange,
  onAdd
}: {
  activeKind: PluginKind
  customName: string
  customDescription: string
  customCommand: string
  customArgs: string
  customConfig: string
  customSkillBody: string
  busy: boolean
  onNameChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onCommandChange: (value: string) => void
  onArgsChange: (value: string) => void
  onConfigChange: (value: string) => void
  onSkillBodyChange: (value: string) => void
  onAdd: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <section className="mt-6 rounded-2xl border border-ds-border bg-ds-card/95 p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-2">
        <input
          value={customName}
          onChange={(event) => onNameChange(event.target.value)}
          className="h-10 rounded-xl border border-ds-border bg-ds-main/45 px-3 text-[14px] text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
          placeholder={t('pluginCustomName')}
        />
        <input
          value={customDescription}
          onChange={(event) => onDescriptionChange(event.target.value)}
          className="h-10 rounded-xl border border-ds-border bg-ds-main/45 px-3 text-[14px] text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
          placeholder={t('pluginCustomDescription')}
        />
      </div>
      {activeKind === 'mcp' ? (
        <div className="mt-3 grid gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            <input
              value={customCommand}
              onChange={(event) => onCommandChange(event.target.value)}
              className="h-10 rounded-xl border border-ds-border bg-ds-main/45 px-3 text-[14px] text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
              placeholder={t('pluginCustomCommand')}
            />
            <textarea
              value={customArgs}
              onChange={(event) => onArgsChange(event.target.value)}
              className="min-h-[80px] rounded-xl border border-ds-border bg-ds-main/45 px-3 py-2 font-mono text-[13px] leading-5 text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
              placeholder={t('pluginCustomArgs')}
              spellCheck={false}
            />
          </div>
          <textarea
            value={customConfig}
            onChange={(event) => onConfigChange(event.target.value)}
            className="min-h-[120px] rounded-xl border border-ds-border bg-ds-main/45 px-3 py-2 font-mono text-[13px] leading-5 text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
            placeholder={t('pluginCustomMcpConfig')}
            spellCheck={false}
          />
        </div>
      ) : (
        <textarea
          value={customSkillBody}
          onChange={(event) => onSkillBodyChange(event.target.value)}
          className="mt-3 min-h-[140px] w-full rounded-xl border border-ds-border bg-ds-main/45 px-3 py-2 font-mono text-[13px] leading-5 text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/30"
          placeholder={t('pluginCustomSkillBody')}
          spellCheck={false}
        />
      )}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onAdd}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-ds-userbubble px-4 py-2 text-[13px] font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Plus className="h-4 w-4" strokeWidth={2} />}
          {t('pluginAddCustom')}
        </button>
      </div>
    </section>
  )
}
