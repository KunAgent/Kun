import { createHash } from 'node:crypto'
import type { AppSettingsV1 } from '../../shared/app-settings'
import { getKunRuntimeSettings } from '../../shared/app-settings'
import {
  loadKunProjectConfig,
  type KunProjectConfigLoadResult
} from '../../../kun/src/config/project-config.js'
import { McpServerConfig } from '../../../kun/src/contracts/capabilities.js'

export const GENERATED_PROJECT_MCP_SERVER_PREFIX = '__kun_project_'

export type ProjectConfigTrustStatus = 'untrusted' | 'trusted' | 'stale'

export type ProjectConfigServerSummary = {
  id: string
  transport: 'stdio' | 'streamable-http' | 'sse'
  target: string
  enabled: boolean
}

export type ProjectConfigState = {
  workspaceRoot: string
  path: string
  status: KunProjectConfigLoadResult['status']
  message?: string
  digest?: string
  trust: ProjectConfigTrustStatus
  serverSummaries: ProjectConfigServerSummary[]
  skillRootCount: number
  disabledSkillCount: number
}

export async function readProjectConfigState(
  settings: AppSettingsV1,
  workspaceRoot: string
): Promise<ProjectConfigState> {
  const loaded = await loadKunProjectConfig(workspaceRoot)
  const grants = getKunRuntimeSettings(settings).projectConfig.grants
  const workspaceGrant = grants.find((grant) =>
    comparablePath(grant.workspaceRoot) === comparablePath(loaded.workspaceRoot)
  )
  const trust: ProjectConfigTrustStatus = loaded.status === 'valid' && workspaceGrant
    ? workspaceGrant.configDigest === loaded.digest ? 'trusted' : 'stale'
    : workspaceGrant ? 'stale' : 'untrusted'
  return {
    workspaceRoot: loaded.workspaceRoot,
    path: loaded.path,
    status: loaded.status,
    ...(loaded.status === 'invalid' ? { message: loaded.message } : {}),
    ...(loaded.status === 'valid' ? {
      digest: loaded.digest,
      serverSummaries: Object.entries(loaded.mcp.servers).map(([id, server]) => ({
        id,
        transport: server.transport,
        target: projectMcpServerTarget(server),
        enabled: server.enabled
      })),
      skillRootCount: loaded.skills.roots.length,
      disabledSkillCount: loaded.skills.disabledIds.length
    } : {
      serverSummaries: [],
      skillRootCount: 0,
      disabledSkillCount: 0
    }),
    trust
  }
}

export async function approvedProjectMcpServers(
  settings: AppSettingsV1
): Promise<Record<string, Record<string, unknown>>> {
  const grants = getKunRuntimeSettings(settings).projectConfig.grants
  const servers: Record<string, Record<string, unknown>> = {}
  const seenWorkspaces = new Set<string>()
  for (const grant of grants.slice(0, 64)) {
    const loaded = await loadKunProjectConfig(grant.workspaceRoot)
    if (loaded.status !== 'valid' || loaded.digest !== grant.configDigest) continue
    const workspaceKey = comparablePath(loaded.workspaceRoot)
    if (seenWorkspaces.has(workspaceKey)) continue
    seenWorkspaces.add(workspaceKey)
    for (const [declaredId, projectServer] of Object.entries(loaded.mcp.servers)) {
      const internalId = generatedProjectMcpServerId(loaded.workspaceRoot, declaredId)
      const parsed = McpServerConfig.safeParse({
        ...projectServer,
        workspaceRoots: [loaded.workspaceRoot],
        trustScope: 'workspace',
        trustedWorkspaceRoots: [loaded.workspaceRoot]
      })
      if (parsed.success) servers[internalId] = parsed.data
    }
  }
  return servers
}

export function stripGeneratedProjectMcpServers<T>(
  servers: Record<string, T>
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(servers).filter(([serverId]) =>
      !serverId.startsWith(GENERATED_PROJECT_MCP_SERVER_PREFIX)
    )
  )
}

export function generatedProjectMcpServerId(
  workspaceRoot: string,
  declaredId: string
): string {
  const workspaceHash = shortHash(comparablePath(workspaceRoot), 12)
  const declaredHash = shortHash(declaredId, 6)
  return `${GENERATED_PROJECT_MCP_SERVER_PREFIX}${workspaceHash}_${slug(declaredId)}_${declaredHash}`
}

function projectMcpServerTarget(
  server: { transport: 'stdio' | 'streamable-http' | 'sse'; command?: string; url?: string }
): string {
  if (server.transport === 'stdio') return server.command ?? '(missing command)'
  try {
    const url = new URL(server.url ?? '')
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return '(invalid URL)'
  }
}

function comparablePath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/g, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function shortHash(value: string, length: number): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length)
}

function slug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || 'server'
}
