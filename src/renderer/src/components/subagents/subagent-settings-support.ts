import type {
  KunRuntimeSettingsPatchV1,
  KunRuntimeSettingsV1,
  KunSubagentProfileV1,
  KunSubagentSurfaceV1,
  KunSubagentsSettingsV1,
  ModelProviderModelProfileV1,
  ModelReasoningEffort
} from '@shared/app-settings'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { KUN_RUNTIME_TOOLS_PATH, kunDelegationProfilesPath } from '@shared/kun-endpoints'
import type { CoreRuntimeToolDiagnosticsJson } from '../../agent/kun-contract'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import {
  BUILTIN_AGENT_CATALOG,
  type BuiltinAgentCategory
} from '../../../../../kun/src/delegation/builtin-agent-catalog'

type EditorVariant = 'panel' | 'settings'
type SubagentSettingsTab = 'policy' | 'profiles' | 'automatic'

export type SubagentSettingsEditorProps = {
  kun: KunRuntimeSettingsV1
  onPatch: (patch: KunRuntimeSettingsPatchV1) => void | Promise<void>
  variant: EditorVariant
  className?: string
}

const EMPTY_SUBAGENTS: KunSubagentsSettingsV1 = {
  enabled: true,
  useExistingAgents: true,
  maxParallel: 256,
  proactiveRetry: { enabled: true, maxAttempts: 3 },
  profiles: []
}
const PRESET_COLORS = ['#3b82d8', '#1d9e75', '#e8943a', '#7f77dd', '#d4537e', '#d85a30']

/** kun's built-in tool names (mirror kun/src/adapters/tool/builtin-tool-types.ts). Small,
 *  stable set — a static catalog gives nicer labels than parsing the loose diagnostics shape. */
const BUILTIN_TOOL_NAMES = [
  'read',
  'grep',
  'find',
  'ls',
  'repo_map',
  'git_inspect',
  'edit',
  'write',
  'bash',
  'lsp',
  'verify_changes',
  'send_im_attachment'
] as const

type CapabilityCatalog = {
  mcpServers: Array<{ id: string; toolCount: number; status?: string }>
  skills: Array<{ id: string; name: string; description?: string }>
}

/** Fetch the live MCP-server + skill catalog from kun for the permission picker.
 *  Built-in tools come from the static list above; this only needs the dynamic bits.
 *  Returns empty lists on any failure so the dialog still renders. */
async function loadCapabilityCatalog(): Promise<CapabilityCatalog> {
  const empty: CapabilityCatalog = { mcpServers: [], skills: [] }
  try {
    const res = await rendererRuntimeClient.runtimeRequest(KUN_RUNTIME_TOOLS_PATH, 'GET')
    if (!res.ok) return empty
    const data = JSON.parse(res.body) as CoreRuntimeToolDiagnosticsJson
    const str = (v: unknown): string => (typeof v === 'string' ? v : '')
    const mcpServers = (data.mcpServers ?? [])
      .map((raw) => {
        const rec = raw as Record<string, unknown>
        return { id: str(rec.id), toolCount: Number(rec.toolCount ?? 0) || 0, status: str(rec.status) || undefined }
      })
      .filter((server) => server.id)
    const skills = (data.skills?.skills ?? [])
      .map((raw) => {
        const rec = raw as Record<string, unknown>
        const id = str(rec.id)
        return { id, name: str(rec.name) || id, description: str(rec.description) || undefined }
      })
      .filter((skill) => skill.id)
    return { mcpServers, skills }
  } catch {
    return empty
  }
}

/** Canonical runtime catalog; settings store only user overrides. */
const BUILTIN_AGENTS: KunSubagentProfileV1[] = BUILTIN_AGENT_CATALOG.map((agent) => ({
  id: agent.id,
  enabled: true,
  name: agent.name,
  description: agent.description,
  mode: 'subagent',
  toolPolicy: agent.toolPolicy,
  color: agent.color,
  surfaces: [...agent.surfaces]
}))
const BUILTIN_IDS = new Set(BUILTIN_AGENTS.map((agent) => agent.id))
const BUILTIN_AGENT_BY_ID: ReadonlyMap<string, (typeof BUILTIN_AGENT_CATALOG)[number]> =
  new Map(BUILTIN_AGENT_CATALOG.map((agent) => [agent.id, agent]))

type AgentCategory = BuiltinAgentCategory | 'custom'
type AgentCatalogFilter = AgentCategory | 'base'
type AgentCategoryFilter = AgentCatalogFilter | 'all'
type SurfaceTab = KunSubagentSurfaceV1

const SURFACE_TABS: readonly SurfaceTab[] = ['shared', 'code', 'write', 'design']
const SETTINGS_PAGE_SIZE = 12

const AGENT_CATEGORY_ORDER: readonly AgentCategory[] = [
  'development',
  'review',
  'quality',
  'planning',
  'operations',
  'research',
  'custom'
]

type CatalogAgentSource = 'builtin' | 'configured' | 'workspace'

type CatalogAgent = {
  profile: KunSubagentProfileV1
  builtin: boolean
  source: CatalogAgentSource
  filePath?: string
  name: string
  desc: string
  category: AgentCategory
  baseAgent: boolean
  searchText: string
}

type WorkspaceAgentJson = {
  id: string
  source: 'workspace'
  filePath?: string
  name?: string
  description?: string
  mode?: KunSubagentProfileV1['mode']
  toolPolicy?: KunSubagentProfileV1['toolPolicy']
  color?: string
  systemPrompt?: string
  promptPreamble?: string
  allowedTools?: string[]
  blockedTools?: string[]
  surfaces?: KunSubagentSurfaceV1[]
}

function workspaceProfileToKun(entry: WorkspaceAgentJson): KunSubagentProfileV1 {
  return {
    id: entry.id,
    enabled: true,
    name: entry.name?.trim() || entry.id,
    description: entry.description,
    mode: entry.mode === 'primary' || entry.mode === 'all' ? entry.mode : 'subagent',
    toolPolicy: entry.toolPolicy === 'inherit' ? 'inherit' : 'readOnly',
    color: entry.color,
    systemPrompt: entry.systemPrompt,
    promptPreamble: entry.promptPreamble,
    allowedTools: entry.allowedTools,
    blockedTools: entry.blockedTools,
    surfaces: entry.surfaces ?? ['code']
  }
}

async function loadWorkspaceAgentCatalog(workspaceRoot: string): Promise<WorkspaceAgentJson[]> {
  const workspace = workspaceRoot.trim()
  if (!workspace) return []
  try {
    const res = await rendererRuntimeClient.runtimeRequest(
      kunDelegationProfilesPath(workspace),
      'GET'
    )
    if (!res.ok) return []
    const data = JSON.parse(res.body) as { profiles?: unknown }
    if (!Array.isArray(data.profiles)) return []
    return data.profiles.flatMap((raw) => {
      if (!raw || typeof raw !== 'object') return []
      const rec = raw as Record<string, unknown>
      const id = typeof rec.id === 'string' ? rec.id.trim() : ''
      if (!id || rec.source !== 'workspace') return []
      return [{
        id,
        source: 'workspace' as const,
        ...(typeof rec.filePath === 'string' ? { filePath: rec.filePath } : {}),
        ...(typeof rec.name === 'string' ? { name: rec.name } : {}),
        ...(typeof rec.description === 'string' ? { description: rec.description } : {}),
        ...(rec.mode === 'primary' || rec.mode === 'all' || rec.mode === 'subagent'
          ? { mode: rec.mode }
          : {}),
        ...(rec.toolPolicy === 'inherit' || rec.toolPolicy === 'readOnly'
          ? { toolPolicy: rec.toolPolicy }
          : {}),
        ...(typeof rec.color === 'string' ? { color: rec.color } : {}),
        ...(typeof rec.systemPrompt === 'string' ? { systemPrompt: rec.systemPrompt } : {}),
        ...(typeof rec.promptPreamble === 'string' ? { promptPreamble: rec.promptPreamble } : {}),
        ...(Array.isArray(rec.allowedTools)
          ? { allowedTools: rec.allowedTools.filter((item): item is string => typeof item === 'string') }
          : {}),
        ...(Array.isArray(rec.blockedTools)
          ? { blockedTools: rec.blockedTools.filter((item): item is string => typeof item === 'string') }
          : {}),
        ...(Array.isArray(rec.surfaces)
          ? {
              surfaces: rec.surfaces.filter((item): item is KunSubagentSurfaceV1 =>
                item === 'shared' || item === 'code' || item === 'write' || item === 'design'
              )
            }
          : {})
      }]
    })
  } catch {
    return []
  }
}

function newProfile(surface: SurfaceTab): KunSubagentProfileV1 {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    name: '',
    mode: 'subagent',
    toolPolicy: 'readOnly',
    surfaces: [surface]
  }
}

function profileSurfaces(profile: KunSubagentProfileV1): KunSubagentSurfaceV1[] {
  if (profile.surfaces !== undefined) {
    return profile.surfaces.includes('shared') ? ['shared'] : [...new Set(profile.surfaces)]
  }
  const builtin = BUILTIN_AGENT_BY_ID.get(profile.id)
  return builtin ? [...builtin.surfaces] : ['shared']
}

function profileAvailableOnSurface(
  profile: KunSubagentProfileV1,
  surface: Exclude<SurfaceTab, 'shared'>
): boolean {
  const surfaces = profileSurfaces(profile)
  return surfaces.includes('shared') || surfaces.includes(surface)
}

// Reasoning-effort segment (mirrors the composer's reasoning picker). Labels
// reuse the composer i18n keys (composerReasoning*). When a model declares
// supportedEfforts those are used; otherwise the full list is offered so
// follow-default / unprofiled models can still set profile.reasoningEffort.
const REASONING_OPTIONS: Array<{ id: ModelReasoningEffort; labelKey: string }> = [
  { id: 'auto', labelKey: 'composerReasoningAuto' },
  { id: 'off', labelKey: 'composerReasoningOff' },
  { id: 'low', labelKey: 'composerReasoningLow' },
  { id: 'medium', labelKey: 'composerReasoningMedium' },
  { id: 'high', labelKey: 'composerReasoningHigh' },
  { id: 'max', labelKey: 'composerReasoningMax' }
]

function normalizeModelCapabilityKey(modelId: string): string {
  return modelId.trim().toLowerCase()
}

/** Resolve the model profile for (group, model), matching by id or alias. */
function modelProfileForModel(
  group: ModelProviderModelGroup | undefined,
  modelId: string
): ModelProviderModelProfileV1 | undefined {
  if (!group || !modelId) return undefined
  const key = normalizeModelCapabilityKey(modelId)
  if (!key) return undefined
  const profiles = group.modelProfiles ?? {}
  const direct = profiles[key] ?? profiles[modelId.trim()]
  if (direct) return direct
  return Object.values(profiles).find((p) =>
    p.aliases?.some((alias) => normalizeModelCapabilityKey(alias) === key)
  )
}

/** Capability-gated options for a model profile; empty when unsupported/unknown. */
function reasoningOptionsForModel(
  profile: ModelProviderModelProfileV1 | undefined
): Array<{ id: ModelReasoningEffort; labelKey: string }> {
  const supported = profile?.reasoning?.supportedEfforts
  if (!supported || supported.length === 0) return []
  return supported
    .map((effort) => REASONING_OPTIONS.find((o) => o.id === effort))
    .filter((o): o is { id: ModelReasoningEffort; labelKey: string } => Boolean(o))
}

/** Resolve picker options: prefer model capability list, else full REASONING_OPTIONS. */
function resolveReasoningOptions(
  groups: ModelProviderModelGroup[],
  model: string,
  providerId: string
): Array<{ id: ModelReasoningEffort; labelKey: string }> {
  if (!model) return REASONING_OPTIONS
  const selectedGroup = providerId ? groups.find((group) => group.providerId === providerId) : undefined
  const profile = modelProfileForModel(selectedGroup, model)
    ?? groups.map((group) => modelProfileForModel(group, model)).find(Boolean)
  const gated = reasoningOptionsForModel(profile)
  return gated.length > 0 ? gated : REASONING_OPTIONS
}

function normalizeStoredReasoning(effort: string | undefined): ModelReasoningEffort {
  return effort && REASONING_OPTIONS.some((option) => option.id === effort)
    ? (effort as ModelReasoningEffort)
    : 'off'
}

type RoleSlot = {
  model: string
  providerId: string
}


export {
  AGENT_CATEGORY_ORDER,
  BUILTIN_AGENT_BY_ID,
  BUILTIN_AGENTS,
  BUILTIN_IDS,
  BUILTIN_TOOL_NAMES,
  EMPTY_SUBAGENTS,
  loadCapabilityCatalog,
  loadWorkspaceAgentCatalog,
  newProfile,
  normalizeStoredReasoning,
  PRESET_COLORS,
  profileAvailableOnSurface,
  profileSurfaces,
  REASONING_OPTIONS,
  resolveReasoningOptions,
  SETTINGS_PAGE_SIZE,
  SURFACE_TABS,
  workspaceProfileToKun
}
export type {
  AgentCatalogFilter,
  AgentCategory,
  AgentCategoryFilter,
  CapabilityCatalog,
  CatalogAgent,
  CatalogAgentSource,
  EditorVariant,
  RoleSlot,
  SubagentSettingsTab,
  SurfaceTab,
  WorkspaceAgentJson
}
