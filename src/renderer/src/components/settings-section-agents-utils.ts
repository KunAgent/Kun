import type { SkillRootListItem } from '@shared/kun-gui-api'
import { parseUsageResponse } from '../hooks/usage-response'
import { parseMcpConfigText, type McpFormServer } from './mcp/mcp-config-form'

export function statusPill(status: string | undefined): string {
  if (status === 'available') return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  if (status === 'disabled') return 'border-ds-border-muted bg-ds-card text-ds-faint'
  return 'border-red-300/50 bg-red-500/10 text-red-700 dark:text-red-200'
}

export function skillRootShortLabel(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts.slice(-2).join('/') || path
}

export function compactList(values: unknown, empty: string): string {
  if (!Array.isArray(values) || values.length === 0) return empty
  return values
    .map((value) => typeof value === 'string' ? value : JSON.stringify(value))
    .slice(0, 4)
    .join(', ')
}

export type SkillPermissionSummary = {
  enabledRoots: number
  disabledRoots: number
  workspaceRoots: number
  globalRoots: number
  disabledSkillIds: number
}

export function summarizeSkillPermissionSources(
  roots: readonly SkillRootListItem[],
  disabledSkillIds: unknown
): SkillPermissionSummary {
  return {
    enabledRoots: roots.filter((root) => root.enabled).length,
    disabledRoots: roots.filter((root) => !root.enabled).length,
    workspaceRoots: roots.filter((root) => root.enabled && root.scope === 'project').length,
    globalRoots: roots.filter((root) => root.enabled && root.scope === 'global').length,
    disabledSkillIds: Array.isArray(disabledSkillIds) ? disabledSkillIds.length : 0
  }
}

export type McpPermissionSummary = {
  parseError: string | null
  enabledServers: number
  disabledServers: number
  userScopeServers: number
  workspaceScopeServers: number
  workspaceVisibleServers: number
  localServers: number
  remoteServers: number
  envServers: number
  headerServers: number
}

function hasEntries(entries: McpFormServer['env'] | McpFormServer['headers']): boolean {
  return entries.some((entry) => entry.key.trim() || entry.value.trim())
}

export function summarizeMcpPermissionSources(text: string): McpPermissionSummary {
  const parsed = parseMcpConfigText(text)
  if (!parsed.ok) {
    return {
      parseError: parsed.error,
      enabledServers: 0,
      disabledServers: 0,
      userScopeServers: 0,
      workspaceScopeServers: 0,
      workspaceVisibleServers: 0,
      localServers: 0,
      remoteServers: 0,
      envServers: 0,
      headerServers: 0
    }
  }
  const enabled = parsed.model.servers.filter((server) => server.enabled)
  return {
    parseError: null,
    enabledServers: enabled.length,
    disabledServers: parsed.model.servers.length - enabled.length,
    userScopeServers: enabled.filter((server) => server.trustScope === 'user').length,
    workspaceScopeServers: enabled.filter((server) => server.trustScope === 'workspace').length,
    workspaceVisibleServers: enabled.filter((server) =>
      server.workspaceRoots.some((root) => root.trim())
    ).length,
    localServers: enabled.filter((server) => server.transport === 'stdio').length,
    remoteServers: enabled.filter((server) => server.transport !== 'stdio').length,
    envServers: enabled.filter((server) => hasEntries(server.env)).length,
    headerServers: enabled.filter((server) => hasEntries(server.headers)).length
  }
}

export type TokenEconomySavingsSummary = {
  tokens: number
}

export type TokenEconomySavingsState = {
  loading: boolean
  loaded: boolean
  summary: TokenEconomySavingsSummary | null
}

export const EMPTY_TOKEN_ECONOMY_SAVINGS_STATE: TokenEconomySavingsState = {
  loading: false,
  loaded: false,
  summary: null
}

export type ModelContextProfileSummary = {
  modelLabel: string
  contextWindowLabel: string
  softThresholdLabel: string
  hardThresholdLabel: string
  sourceLabelKey: string
}

const DEEPSEEK_V4_CONTEXT_PROFILE = {
  contextWindowTokens: 1_000_000,
  softThreshold: 980_000,
  hardThreshold: 990_000
}

function formatTokenNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

function normalizeModelId(model: string | undefined): string {
  const normalized = model?.trim().toLowerCase() ?? ''
  return normalized === 'auto' ? '' : normalized
}

function knownModelContextProfile(input: string | undefined): { modelLabel: string } | null {
  const normalized = normalizeModelId(input)
  if (!normalized) return null
  const match = ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner']
    .find((modelId) => normalized === modelId || normalized.endsWith(`/${modelId}`))
  return match ? { modelLabel: match } : null
}

export function modelContextProfileSummary(input: {
  model: string | undefined
  fallbackSoftThreshold: number
  fallbackHardThreshold: number
}): ModelContextProfileSummary {
  const known = knownModelContextProfile(input.model)
  if (known) {
    return {
      modelLabel: known.modelLabel,
      contextWindowLabel: formatTokenNumber(DEEPSEEK_V4_CONTEXT_PROFILE.contextWindowTokens),
      softThresholdLabel: formatTokenNumber(DEEPSEEK_V4_CONTEXT_PROFILE.softThreshold),
      hardThresholdLabel: formatTokenNumber(DEEPSEEK_V4_CONTEXT_PROFILE.hardThreshold),
      sourceLabelKey: 'kunModelContextSourceBuiltIn'
    }
  }
  const model = input.model?.trim() || 'auto'
  return {
    modelLabel: model,
    contextWindowLabel: 'models.profiles',
    softThresholdLabel: formatTokenNumber(input.fallbackSoftThreshold),
    hardThresholdLabel: formatTokenNumber(input.fallbackHardThreshold),
    sourceLabelKey: 'kunModelContextSourceFallback'
  }
}

function usageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export async function loadTokenEconomySavingsSummary(): Promise<TokenEconomySavingsSummary | null> {
  if (typeof window === 'undefined' || typeof window.kunGui?.runtimeRequest !== 'function') return null
  const response = await window.kunGui.runtimeRequest('/v1/usage?group_by=thread', 'GET')
  if (!response.ok || !response.body.trim()) return null
  const parsed = parseUsageResponse<{ totals?: Record<string, unknown> }>(response.body, 'token economy usage')
  const totals = parsed.totals ?? {}
  const tokens = usageNumber(totals.token_economy_savings_tokens)
  if (tokens <= 0) return null
  return { tokens }
}
