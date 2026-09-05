import { readFile } from 'node:fs/promises'
import type { AppSettingsV1 } from '../../shared/app-settings'
import { McpServerConfig } from '../../../kun/src/contracts/capabilities.js'
import {
  buildClawScheduleMcpArgs,
  GUI_SCHEDULE_MCP_SERVER_NAME,
  resolveClawScheduleMcpCommand,
  type ClawScheduleMcpLaunchConfig
} from '../claw-schedule-mcp-config'
import {
  comparableSkillRootPath,
  guiSkillManagedComparablePaths,
  guiSkillWorkspaceRootsForRuntime,
  guiSkillRootsForRuntime,
  isCodexPluginCacheRoot,
  normalizeSkillRootPath
} from '../services/skill-service'

const GUI_SCHEDULE_MCP_TIMEOUT_MS = 5_000

export { GUI_SCHEDULE_MCP_SERVER_NAME }

export function buildGuiScheduleKunMcpServer(
  settings: AppSettingsV1,
  launch: ClawScheduleMcpLaunchConfig
): Record<string, unknown> {
  return {
    enabled: true,
    transport: 'stdio',
    command: resolveClawScheduleMcpCommand(launch),
    args: buildClawScheduleMcpArgs(settings, launch),
    env: { ELECTRON_RUN_AS_NODE: '1' },
    trustScope: 'user',
    timeoutMs: GUI_SCHEDULE_MCP_TIMEOUT_MS
  }
}

export async function skillCapabilityConfigForRuntime(
  existing: Record<string, unknown>,
  settings?: AppSettingsV1,
  builtinRoot?: string
): Promise<Record<string, unknown>> {
  const managed = guiSkillManagedComparablePaths(settings)
  const keepManual = (value: unknown): string[] => stringArrayValue(value)
    .map(normalizeSkillRootPath)
    .filter((path) => path.length > 0 &&
      !managed.has(comparableSkillRootPath(path)) &&
      !isHistoricalBundledAgentSkillsRoot(path) &&
      !isCodexPluginCacheRoot(path))
  const guiRoots = await guiSkillRootsForRuntime(settings)
  const roots = uniqueStrings([
    ...keepManual(existing.roots),
    ...guiRoots.filter((root) => root.scope === 'project').map((root) => root.path)
  ])
  const globalRoots = uniqueStrings([
    ...keepManual(existing.globalRoots),
    ...guiRoots.filter((root) => root.scope === 'global').map((root) => root.path)
  ])
  const builtinRoots = uniqueStrings([
    ...(builtinRoot?.trim() ? [normalizeSkillRootPath(builtinRoot)] : [])
  ])
  return {
    ...existing,
    enabled: roots.length > 0 || globalRoots.length > 0 || builtinRoots.length > 0 || existing.enabled === true,
    roots,
    workspaceRoots: guiSkillWorkspaceRootsForRuntime(settings),
    globalRoots,
    builtinRoots,
    disabledIds: settings?.disabledSkillIds ?? stringArrayValue(existing.disabledIds),
    legacySkillMd: existing.legacySkillMd === false ? false : true
  }
}

function isHistoricalBundledAgentSkillsRoot(path: string): boolean {
  return comparableSkillRootPath(path)
    .replace(/\\/g, '/')
    .endsWith('/bundled-agent-skills/skills')
}

export async function readGuiManagedMcpServers(
  path: string
): Promise<Record<string, Record<string, unknown>>> {
  const parsed = await readJsonObjectIfExists(path)
  if (!parsed) return {}
  const entries = Object.entries(mcpServersFromGuiConfig(parsed))
    .map(([serverId, server]) => {
      const normalized = normalizeGuiManagedMcpServer(server)
      return normalized ? [serverId, normalized] as const : null
    })
    .filter((entry): entry is readonly [string, Record<string, unknown>] => entry !== null)
  return Object.fromEntries(entries)
}

export async function readJsonObjectIfExists(
  path: string
): Promise<Record<string, unknown> | null> {
  try {
    const text = await readFile(path, 'utf8')
    return objectValue(JSON.parse(text) as unknown)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

function mcpServersFromGuiConfig(config: Record<string, unknown>): Record<string, unknown> {
  const direct = objectValue(config.servers)
  if (Object.keys(direct).length > 0) return direct
  return objectValue(objectValue(objectValue(config.capabilities).mcp).servers)
}

function normalizeGuiManagedMcpServer(server: unknown): Record<string, unknown> | null {
  const raw = objectValue(server)
  const command = scalarStringValue(raw.command)
  const cwd = scalarStringValue(raw.cwd)?.trim()
  const url = scalarStringValue(raw.url)
  const args = stringArrayValue(raw.args)
  const headers = stringRecordValue(raw.headers)
  const env = stringRecordValue(raw.env)
  const oauth = objectValue(raw.oauth)
  const transport = normalizeMcpTransport(raw.transport, command, url)
  if (!transport) return null
  const workspaceRoots = stringArrayValue(raw.workspaceRoots)
  const trustedWorkspaceRoots = stringArrayValue(raw.trustedWorkspaceRoots)
  const planModeReadOnlyTools = stringArrayValue(raw.planModeReadOnlyTools)
  const trustScope = normalizeMcpTrustScope(raw.trustScope, trustedWorkspaceRoots)
  if (trustScope === 'workspace' && trustedWorkspaceRoots.length === 0) return null
  const timeoutMs = positiveIntegerValue(raw.timeoutMs)
  const parsed = McpServerConfig.safeParse({
    enabled: raw.enabled === false || raw.disabled === true ? false : true,
    transport,
    ...(command ? { command } : {}),
    ...(transport === 'stdio' && cwd ? { cwd } : {}),
    ...(args.length ? { args } : {}),
    ...(url ? { url } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(Object.keys(env).length ? { env } : {}),
    ...(workspaceRoots.length ? { workspaceRoots } : {}),
    ...(Object.keys(oauth).length ? { oauth } : {}),
    trustScope,
    ...(trustedWorkspaceRoots.length ? { trustedWorkspaceRoots } : {}),
    ...(planModeReadOnlyTools.length ? { planModeReadOnlyTools } : {}),
    ...(timeoutMs ? { timeoutMs } : {})
  })
  return parsed.success ? objectValue(parsed.data) : null
}

function normalizeMcpTransport(
  value: unknown,
  command: string | undefined,
  url: string | undefined
): 'stdio' | 'streamable-http' | 'sse' | null {
  if (value === 'stdio' || value === 'streamable-http' || value === 'sse') return value
  if (command) return 'stdio'
  if (url) return 'streamable-http'
  return null
}

function normalizeMcpTrustScope(
  value: unknown,
  trustedRoots: string[]
): 'user' | 'workspace' {
  if (value === 'user' || value === 'workspace') return value
  return trustedRoots.length ? 'workspace' : 'user'
}

function scalarStringValue(value: unknown): string | undefined {
  return typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function stringRecordValue(value: unknown): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [key, item] of Object.entries(objectValue(value))) {
    const normalized = scalarStringValue(item)
    if (normalized !== undefined) next[key] = normalized
  }
  return next
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function positiveIntegerValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
