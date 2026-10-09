import type { SkillListItem } from '@shared/kun-gui-api'
import type { CoreRuntimeToolDiagnosticsJson } from '../../agent/kun-contract'
import {
  isJsonRecord,
  mcpServersFromConfig,
  parseMcpJsonConfig,
  type JsonRecord,
  type MarketplaceItem
} from '../plugin-marketplace-config'
import { missingEnvForServer, serverToForm } from './mcp-server-form'

export type McpRowStatus = 'needs-config' | 'error' | 'unauthorized' | 'connected' | 'configured' | 'disabled'
export type InstalledGroup = 'attention' | 'enabled' | 'disabled'
export type RowSource = 'market' | 'kun' | 'builtin' | 'custom'

export type InstalledMcpRow = {
  id: string
  title: string
  description: string
  source: RowSource
  /** Market name for market rows. */
  sourceLabel?: string
  status: McpRowStatus
  group: InstalledGroup
  toolCount?: number
  lastError?: string
  missingKeys: string[]
  enabled: boolean
  /** The server has an entry in the Kun config (so it can be edited or deleted). */
  hasConfig: boolean
  systemManaged: boolean
  /** `npx -y pkg@1.2.3` or the remote URL. */
  launch: string
}

type MarketLookup = (id: string) => {
  sourceId: string
  label: string
  description?: string
  title?: string
  requiredEnvKeys: string[]
} | undefined

function stringField(record: Record<string, unknown> | undefined, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function launchLine(server: JsonRecord | undefined): string {
  if (!server) return ''
  const form = serverToForm('', server)
  return form.transport === 'remote' ? form.url : [form.command, ...form.args].filter(Boolean).join(' ')
}

function statusFor(input: {
  diagnostic?: Record<string, unknown>
  server?: JsonRecord
  missingKeys: string[]
}): McpRowStatus {
  if (input.missingKeys.length > 0) return 'needs-config'
  if (input.server && (input.server.enabled === false || input.server.disabled === true)) return 'disabled'
  const status = stringField(input.diagnostic, 'status')
  if (status === 'connected' || status === 'available') return 'connected'
  if (status === 'authorization_required') return 'unauthorized'
  if (status === 'error' || status === 'unavailable' || stringField(input.diagnostic, 'lastError')) return 'error'
  if (status === 'disabled') return 'disabled'
  return 'configured'
}

function groupFor(status: McpRowStatus, systemManaged: boolean): InstalledGroup {
  if (status === 'connected' || status === 'configured') return 'enabled'
  if (status === 'disabled') return 'disabled'
  // A built-in connector waiting for the user to sign in is optional, not broken.
  if (status === 'unauthorized' && systemManaged) return 'disabled'
  return 'attention'
}

const GROUP_ORDER: Record<InstalledGroup, number> = { attention: 0, enabled: 1, disabled: 2 }

/**
 * Every MCP server the user has: configured ones, ones only the runtime
 * reports, and Kun's built-ins, each with one status and a group.
 */
export function buildInstalledMcpRows(input: {
  configText: string
  diagnostics: CoreRuntimeToolDiagnosticsJson | null
  builtins: readonly MarketplaceItem[]
  kunPicks: readonly MarketplaceItem[]
  market: MarketLookup
  translate: (item: MarketplaceItem) => { title: string; description: string }
}): InstalledMcpRow[] {
  let servers: JsonRecord = {}
  try {
    servers = mcpServersFromConfig(parseMcpJsonConfig(input.configText))
  } catch {
    servers = {}
  }
  const diagnostics = new Map<string, Record<string, unknown>>()
  for (const diagnostic of input.diagnostics?.mcpServers ?? []) {
    const id = stringField(diagnostic, 'id')
    if (id) diagnostics.set(id, diagnostic)
  }
  const builtinIds = new Set(input.builtins.map((item) => item.id))
  const ids = new Set<string>([...input.builtins.map((item) => item.id), ...Object.keys(servers), ...diagnostics.keys()])
  const rows: InstalledMcpRow[] = []
  for (const id of ids) {
    if (!id.trim()) continue
    const server = isJsonRecord(servers[id]) ? servers[id] as JsonRecord : undefined
    const diagnostic = diagnostics.get(id)
    const builtin = input.builtins.find((item) => item.id === id)
    const systemManaged = builtinIds.has(id) && !server
    const pick = input.kunPicks.find((item) => item.id === id)
    const market = systemManaged || pick ? undefined : input.market(id)
    const missingKeys = systemManaged ? [] : missingEnvForServer(server, market?.requiredEnvKeys ?? [])
    const status = statusFor({ diagnostic, server, missingKeys })
    const toolCount = typeof diagnostic?.toolCount === 'number' ? diagnostic.toolCount : undefined
    const copy = builtin ? input.translate(builtin) : pick ? input.translate(pick) : undefined
    rows.push({
      id,
      title: copy?.title || market?.title || id,
      description: copy?.description || market?.description || '',
      source: systemManaged ? 'builtin' : market ? 'market' : pick ? 'kun' : 'custom',
      ...(market ? { sourceLabel: market.label } : {}),
      status,
      group: groupFor(status, systemManaged),
      ...(toolCount !== undefined ? { toolCount } : {}),
      ...(stringField(diagnostic, 'lastError') ? { lastError: stringField(diagnostic, 'lastError') } : {}),
      missingKeys,
      enabled: server ? !(server.enabled === false || server.disabled === true) : status !== 'disabled',
      hasConfig: Boolean(server),
      systemManaged,
      launch: launchLine(server)
    })
  }
  return rows.sort((a, b) =>
    GROUP_ORDER[a.group] - GROUP_ORDER[b.group] ||
    Number(a.systemManaged) - Number(b.systemManaged) ||
    a.title.localeCompare(b.title)
  )
}

/** Numeric dotted-version compare; non-numeric parts compare as text. */
export function compareVersions(a: string, b: string): number {
  const left = a.replace(/^v/i, '').split(/[.+-]/)
  const right = b.replace(/^v/i, '').split(/[.+-]/)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const x = left[index] ?? '0'
    const y = right[index] ?? '0'
    const nx = Number(x)
    const ny = Number(y)
    const diff = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

export type InstalledSkillRow = {
  id: string
  name: string
  description: string
  /** Folder that holds the skill folder (the install location). */
  rootPath: string
  skillDir: string
  readOnly: boolean
  market?: { sourceId: string; label: string; version?: string }
  latestVersion?: string
  canUpdate: boolean
  enabled: boolean
}

export function parentDirectory(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return index > 0 ? trimmed.slice(0, index) : trimmed
}

export function buildInstalledSkillRows(input: {
  skills: readonly SkillListItem[]
  disabledIds: readonly string[]
  marketLabel: (sourceId: string) => string | undefined
  latestVersion: (sourceId: string, skillId: string) => string | undefined
}): InstalledSkillRow[] {
  const disabled = new Set(input.disabledIds)
  return input.skills.map((skill) => {
    const label = skill.market ? input.marketLabel(skill.market.sourceId) : undefined
    const latest = skill.market ? input.latestVersion(skill.market.sourceId, skill.id) : undefined
    const installed = skill.market?.version
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description ?? '',
      rootPath: parentDirectory(skill.root),
      skillDir: skill.root,
      readOnly: skill.builtin === true,
      ...(skill.market && label
        ? { market: { sourceId: skill.market.sourceId, label, ...(installed ? { version: installed } : {}) } }
        : {}),
      ...(latest ? { latestVersion: latest } : {}),
      canUpdate: Boolean(skill.market && label && latest && installed && compareVersions(latest, installed) > 0),
      enabled: !disabled.has(skill.id)
    }
  })
}
