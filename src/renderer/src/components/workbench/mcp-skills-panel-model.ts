import type { SkillListItem } from '@shared/kun-gui-api'

export type McpSkillsScope = 'project' | 'global'
export type McpSkillsCategory = 'mcp' | 'skills'
export type McpSkillsStatusFilter = 'all' | 'enabled' | 'disabled'

export type McpSkillsPanelEntry = {
  id: string
  name: string
  description: string
  enabled: boolean
  sourceScope: 'project' | 'global'
}

export const MCP_SKILLS_PAGE_SIZE = 5

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJsonRecord(content: string): JsonRecord {
  const trimmed = content.trim()
  if (!trimmed) return {}
  const parsed = JSON.parse(trimmed) as unknown
  if (!isRecord(parsed)) throw new Error('Configuration must be a JSON object.')
  return parsed
}

function globalMcpServers(config: JsonRecord): JsonRecord {
  if (isRecord(config.servers)) return config.servers
  const capabilities = isRecord(config.capabilities) ? config.capabilities : undefined
  const mcp = isRecord(capabilities?.mcp) ? capabilities.mcp : undefined
  return isRecord(mcp?.servers) ? mcp.servers : {}
}

function projectMcpServers(config: JsonRecord): JsonRecord {
  const mcp = isRecord(config.mcp) ? config.mcp : undefined
  return isRecord(mcp?.servers) ? mcp.servers : {}
}

function redactedMcpTarget(server: JsonRecord): string {
  const command = typeof server.command === 'string' ? server.command.trim() : ''
  if (command) return command
  const rawUrl = typeof server.url === 'string' ? server.url.trim() : ''
  if (!rawUrl) return ''
  try {
    const url = new URL(rawUrl)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return rawUrl.split('?')[0] ?? ''
  }
}

function serverEnabled(server: JsonRecord): boolean {
  return server.enabled !== false && server.disabled !== true
}

export function mcpEntriesFromConfig(
  content: string,
  scope: McpSkillsScope
): McpSkillsPanelEntry[] {
  const config = parseJsonRecord(content)
  const servers = scope === 'project' ? projectMcpServers(config) : globalMcpServers(config)
  return Object.entries(servers)
    .flatMap(([id, value]) => isRecord(value) ? [{ id, server: value }] : [])
    .map(({ id, server }) => ({
      id,
      name: id,
      description: redactedMcpTarget(server),
      enabled: serverEnabled(server),
      sourceScope: scope
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function updateServer(
  servers: JsonRecord,
  id: string,
  enabled: boolean
): JsonRecord {
  const server = servers[id]
  if (!isRecord(server)) throw new Error(`MCP server "${id}" does not exist.`)
  const nextServer: JsonRecord = { ...server, enabled }
  if (enabled) delete nextServer.disabled
  return { ...servers, [id]: nextServer }
}

export function setMcpEntryEnabled(
  content: string,
  scope: McpSkillsScope,
  id: string,
  enabled: boolean
): string {
  const config = parseJsonRecord(content)
  if (scope === 'project') {
    const mcp = isRecord(config.mcp) ? config.mcp : {}
    const servers = isRecord(mcp.servers) ? mcp.servers : {}
    return `${JSON.stringify({
      ...config,
      mcp: { ...mcp, servers: updateServer(servers, id, enabled) }
    }, null, 2)}\n`
  }
  if (isRecord(config.servers)) {
    return `${JSON.stringify({ ...config, servers: updateServer(config.servers, id, enabled) }, null, 2)}\n`
  }
  const capabilities = isRecord(config.capabilities) ? config.capabilities : undefined
  const mcp = isRecord(capabilities?.mcp) ? capabilities.mcp : undefined
  if (isRecord(mcp?.servers)) {
    return `${JSON.stringify({
      ...config,
      capabilities: {
        ...capabilities,
        mcp: { ...mcp, servers: updateServer(mcp.servers, id, enabled) }
      }
    }, null, 2)}\n`
  }
  throw new Error(`MCP server "${id}" does not exist.`)
}

export function normalizeSkillId(id: string): string {
  return id.trim().replace(/^\/?skill:/i, '').trim()
}

export function normalizeDisabledSkillIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((id): id is string => typeof id === 'string')
    .map(normalizeSkillId)
    .filter(Boolean))]
}

export function projectDisabledSkillIds(content: string): string[] {
  const config = parseJsonRecord(content)
  const skills = isRecord(config.skills) ? config.skills : undefined
  return normalizeDisabledSkillIds(skills?.disabledIds)
}

export function setProjectSkillEnabled(
  content: string,
  id: string,
  enabled: boolean
): string {
  const config = parseJsonRecord(content)
  const skills = isRecord(config.skills) ? config.skills : {}
  const normalizedId = normalizeSkillId(id)
  const disabled = normalizeDisabledSkillIds(skills.disabledIds)
  const disabledIds = enabled
    ? disabled.filter((candidate) => candidate !== normalizedId)
    : [...new Set([...disabled, normalizedId])]
  return `${JSON.stringify({
    ...config,
    skills: {
      enabled: true,
      includeConventional: true,
      roots: [],
      ...skills,
      disabledIds
    }
  }, null, 2)}\n`
}

export function skillEntries(
  skills: readonly SkillListItem[],
  scope: McpSkillsScope,
  disabledIds: readonly string[]
): McpSkillsPanelEntry[] {
  const disabled = new Set(disabledIds.map(normalizeSkillId))
  return skills
    .filter((skill) => scope === 'project' || skill.scope === 'global')
    .map((skill) => ({
      id: normalizeSkillId(skill.id),
      name: skill.name || normalizeSkillId(skill.id),
      description: skill.description?.trim() || skill.root,
      enabled: !disabled.has(normalizeSkillId(skill.id)),
      sourceScope: skill.scope
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function filterMcpSkillsEntries(
  entries: readonly McpSkillsPanelEntry[],
  query: string,
  status: McpSkillsStatusFilter
): McpSkillsPanelEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return entries.filter((entry) => {
    if (status === 'enabled' && !entry.enabled) return false
    if (status === 'disabled' && entry.enabled) return false
    if (!normalizedQuery) return true
    return `${entry.name}\n${entry.id}\n${entry.description}`
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  })
}

export function clampPage(page: number, totalItems: number, pageSize = MCP_SKILLS_PAGE_SIZE): number {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  return Math.min(totalPages, Math.max(1, Math.trunc(page) || 1))
}

export function pageEntries<T>(
  entries: readonly T[],
  page: number,
  pageSize = MCP_SKILLS_PAGE_SIZE
): T[] {
  const safePage = clampPage(page, entries.length, pageSize)
  const start = (safePage - 1) * pageSize
  return entries.slice(start, start + pageSize)
}

export function paginationItems(page: number, totalPages: number): Array<number | 'ellipsis'> {
  const safeTotal = Math.max(1, Math.trunc(totalPages) || 1)
  const safePage = Math.min(safeTotal, Math.max(1, Math.trunc(page) || 1))
  if (safeTotal <= 5) return Array.from({ length: safeTotal }, (_, index) => index + 1)
  const pages = new Set([1, safeTotal, safePage - 1, safePage, safePage + 1])
  const sorted = [...pages].filter((candidate) => candidate >= 1 && candidate <= safeTotal).sort((a, b) => a - b)
  const items: Array<number | 'ellipsis'> = []
  sorted.forEach((candidate, index) => {
    if (index > 0 && candidate - sorted[index - 1]! > 1) items.push('ellipsis')
    items.push(candidate)
  })
  return items
}
