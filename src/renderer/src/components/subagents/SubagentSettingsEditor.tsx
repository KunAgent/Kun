import type { Dispatch, ReactElement, ReactNode, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { Bot, Check, ChevronDown, ChevronLeft, ChevronRight, Pencil, Plug, Plus, Power, Search, Sparkles, Trash2, Wrench, X } from 'lucide-react'
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
import { confirmDialog } from '../../lib/confirm-dialog'
import { useChatStore } from '../../store/chat-store'
import { SettingsSubTabs, SettingsTabPanel, Toggle } from '../settings-controls'
import { AgentKun } from './AgentKun'
import {
  BUILTIN_AGENT_CATALOG,
  type BuiltinAgentCategory
} from '../../../../../kun/src/delegation/builtin-agent-catalog'

export type { SubagentSettingsEditorProps } from './subagent-settings-support'
import {
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
  workspaceProfileToKun,
  type AgentCatalogFilter,
  type AgentCategory,
  type AgentCategoryFilter,
  type CapabilityCatalog,
  type CatalogAgent,
  type RoleSlot,
  type SubagentSettingsEditorProps,
  type SubagentSettingsTab,
  type SurfaceTab,
  type WorkspaceAgentJson
} from './subagent-settings-support'
import {
  AgentCatalogToolbar,
  CategoryBatchControls,
  CatalogPagination,
  CompactPolicySetting,
  EditorSettingsCard,
  ExtensionAgentsControl,
  SurfaceTabs,
  agentCategoryLabel,
  categoryConfigurationSummary
} from './SubagentCatalogControls'
import {
  AgentCategorySection,
  AgentDetailsPanel,
  BoundedNumberInput,
  CatalogAgentRow,
  EmptyCatalogState
} from './SubagentCatalogViews'
import {
  ModelSelect,
  ReasoningEffortPicker,
  Row,
  RowActions,
  SubagentPanelHeader
} from './SubagentProfileControls'
export { SubagentPanelHeader } from './SubagentProfileControls'
import { ProfileDialog } from './SubagentProfileDialog'
import { SubagentSettingsContent } from './SubagentSettingsContent'
export function SubagentSettingsEditor({
  kun,
  onPatch,
  variant,
  className
}: SubagentSettingsEditorProps): ReactElement {
  const { t } = useTranslation('common')
  const { t: tSettings } = useTranslation('settings')
  const composerModelGroups = useChatStore((s) => s.composerModelGroups)
  const activeRoute = useChatStore((s) => s.route)
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const loadComposerModels = useChatStore((s) => s.loadComposerModels)
  const [dialog, setDialog] = useState<{ profile: KunSubagentProfileV1; isNew: boolean } | null>(null)
  const [settingsTab, setSettingsTab] = useState<SubagentSettingsTab>('policy')
  const [catalogQuery, setCatalogQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<AgentCategoryFilter>(variant === 'panel' ? 'base' : 'all')
  const [selectedSurface, setSelectedSurface] = useState<SurfaceTab>('shared')
  const [catalogPage, setCatalogPage] = useState(1)
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<AgentCategory>>(
    () => new Set(AGENT_CATEGORY_ORDER.slice(1))
  )
  const [systemRolesOpen, setSystemRolesOpen] = useState(false)
  const [workspaceAgents, setWorkspaceAgents] = useState<WorkspaceAgentJson[]>([])
  const subagents = kun.subagents ?? EMPTY_SUBAGENTS
  // Compaction always runs in model mode (the heuristic fold is only a silent
  // fallback when the model call fails), so there is no user-facing mode toggle.
  // The model lives under contextCompaction.summaryModel (distinct from the
  // top-level kun.summaryModel, which drives the session-summary role).
  const compactionSlot: RoleSlot = {
    model: kun.contextCompaction.summaryModel ?? '',
    providerId: kun.contextCompaction.summaryProviderId ?? ''
  }
  const smallModel: RoleSlot = { model: kun.smallModel ?? '', providerId: kun.smallModelProviderId ?? '' }
  const titleSlot: RoleSlot = { model: kun.titleModel ?? '', providerId: kun.titleProviderId ?? '' }
  const summarySlot: RoleSlot = { model: kun.summaryModel ?? '', providerId: kun.summaryProviderId ?? '' }
  const codeReviewSlot: RoleSlot = { model: kun.codeReviewModel ?? '', providerId: kun.codeReviewProviderId ?? '' }
  const planSlot: RoleSlot = { model: kun.planModel ?? '', providerId: kun.planProviderId ?? '' }
  const titleReasoning = kun.titleReasoningEffort ?? 'off'
  const summaryReasoning = kun.summaryReasoningEffort ?? 'off'
  const codeReviewReasoning = kun.codeReviewReasoningEffort ?? 'off'

  useEffect(() => { void loadComposerModels() }, [loadComposerModels])

  useEffect(() => {
    let cancelled = false
    const workspace = workspaceRoot?.trim() ?? ''
    if (!workspace) {
      setWorkspaceAgents([])
      return
    }
    void loadWorkspaceAgentCatalog(workspace).then((agents) => {
      if (cancelled) return
      setWorkspaceAgents(agents)
      if (agents.length === 0) return
      // Sidebar defaults to the base filter; promote to "all" once so
      // workspace-defined custom roles are visible without hunting filters.
      if (variant === 'panel') {
        setCategoryFilter((current) => (current === 'base' ? 'all' : current))
      }
      setCollapsedCategories((current) => {
        if (!current.has('custom')) return current
        const next = new Set(current)
        next.delete('custom')
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [variant, workspaceRoot])

  const patchSubagents = useCallback((patch: Partial<KunSubagentsSettingsV1>): void => {
    void onPatch({
      subagents: {
        ...subagents,
        ...patch,
        profiles: patch.profiles ?? subagents.profiles
      }
    })
  }, [onPatch, subagents])

  const persistProfiles = useCallback((profiles: KunSubagentProfileV1[]): void => {
    const defaultProfile = subagents.defaultProfile
    patchSubagents({
      profiles,
      ...(defaultProfile && !profiles.some((profile) => profile.enabled && profile.id === defaultProfile)
        ? { defaultProfile: '' }
        : {})
    })
  }, [patchSubagents, subagents.defaultProfile])

  // Built-ins may not be in settings yet — upsert so configuring one persists it for the first time.
  const upsertProfile = useCallback((id: string, patch: Partial<KunSubagentProfileV1>): void => {
    const baseline = subagents.profiles.find((p) => p.id === id) ?? BUILTIN_AGENTS.find((p) => p.id === id)
    if (!baseline) return
    const next = { ...baseline, ...patch }
    const exists = subagents.profiles.some((p) => p.id === id)
    persistProfiles(exists ? subagents.profiles.map((p) => (p.id === id ? next : p)) : [...subagents.profiles, next])
  }, [subagents.profiles, persistProfiles])

  const setProfileModel = useCallback((id: string, model: string, providerId: string): void => {
    upsertProfile(id, {
      ...(model ? { model } : { model: undefined }),
      ...(providerId ? { providerId } : { providerId: undefined })
    })
  }, [upsertProfile])

  // Batch-apply one model pair to every id in a single persistProfiles write so
  // sequential upserts cannot clobber each other.
  const setCategoryModels = useCallback((ids: string[], model: string, providerId: string): void => {
    if (ids.length === 0) return
    const modelPatch: Pick<KunSubagentProfileV1, 'model' | 'providerId'> = {
      model: model || undefined,
      providerId: providerId || undefined
    }
    let next = [...subagents.profiles]
    for (const id of ids) {
      const existingIdx = next.findIndex((profile) => profile.id === id)
      const baseline = (existingIdx >= 0 ? next[existingIdx] : undefined)
        ?? BUILTIN_AGENTS.find((profile) => profile.id === id)
      if (!baseline) continue
      const patched = { ...baseline, ...modelPatch }
      if (existingIdx >= 0) next[existingIdx] = patched
      else next.push(patched)
    }
    persistProfiles(next)
  }, [subagents.profiles, persistProfiles])

  // Per-profile reasoning depth. 'off' is the default → store undefined so the
  // round-trip omits it (mergeKunRuntimeSettings strips 'off'/invalid).
  const setProfileReasoning = useCallback((id: string, effort: ModelReasoningEffort): void => {
    upsertProfile(id, { reasoningEffort: effort === 'off' ? undefined : effort })
  }, [upsertProfile])

  const setCategoryReasoning = useCallback((ids: string[], effort: ModelReasoningEffort): void => {
    if (ids.length === 0) return
    const reasoningEffort = effort === 'off' ? undefined : effort
    let next = [...subagents.profiles]
    for (const id of ids) {
      const existingIdx = next.findIndex((profile) => profile.id === id)
      const baseline = (existingIdx >= 0 ? next[existingIdx] : undefined)
        ?? BUILTIN_AGENTS.find((profile) => profile.id === id)
      if (!baseline) continue
      const patched = { ...baseline, reasoningEffort }
      if (existingIdx >= 0) next[existingIdx] = patched
      else next.push(patched)
    }
    persistProfiles(next)
  }, [subagents.profiles, persistProfiles])

  const resetCategoryConfiguration = useCallback((ids: string[]): void => {
    if (ids.length === 0) return
    let next = [...subagents.profiles]
    for (const id of ids) {
      const existingIdx = next.findIndex((profile) => profile.id === id)
      const baseline = (existingIdx >= 0 ? next[existingIdx] : undefined)
        ?? BUILTIN_AGENTS.find((profile) => profile.id === id)
      if (!baseline) continue
      const reset = {
        ...baseline,
        model: undefined,
        providerId: undefined,
        reasoningEffort: undefined
      }
      if (existingIdx >= 0) next[existingIdx] = reset
      else next.push(reset)
    }
    persistProfiles(next)
  }, [subagents.profiles, persistProfiles])

  const toggleEnabled = useCallback((id: string): void => {
    const cur = subagents.profiles.find((p) => p.id === id) ?? BUILTIN_AGENTS.find((p) => p.id === id)
    upsertProfile(id, { enabled: !(cur?.enabled ?? true) })
  }, [subagents.profiles, upsertProfile])

  const removeProfile = useCallback(async (id: string): Promise<void> => {
    const p = subagents.profiles.find((x) => x.id === id)
    if (!(await confirmDialog(t('agentsView.deleteConfirm', 'Delete this agent?'), p?.name ?? id))) return
    persistProfiles(subagents.profiles.filter((x) => x.id !== id))
  }, [subagents.profiles, persistProfiles, t])

  const saveDialog = useCallback((profile: KunSubagentProfileV1): void => {
    const exists = subagents.profiles.some((p) => p.id === profile.id)
    persistProfiles(exists
      ? subagents.profiles.map((p) => (p.id === profile.id ? profile : p))
      : [...subagents.profiles, profile])
    setDialog(null)
  }, [subagents.profiles, persistProfiles])

  // Compaction model override is nested under contextCompaction (not a flat
  // kun.* key), so it needs its own patch. Empty string clears it → compaction
  // falls back to the main conversation model.
  const persistCompactionSlot = useCallback((model: string, providerId: string): void => {
    void onPatch({ contextCompaction: { summaryModel: model, summaryProviderId: providerId } })
  }, [onPatch])

  // Each role slot patches its own agents.kun.* override fields. The model/
  // provider keys are typed pairs on KunRuntimeSettingsV1; empty string clears
  // them server-side (mergeKunRuntimeSettings omits blank slots).
  const persistRoleSlot = useCallback(
    (
      modelKey: 'smallModel' | 'titleModel' | 'summaryModel' | 'codeReviewModel' | 'planModel',
      providerKey: 'smallModelProviderId' | 'titleProviderId' | 'summaryProviderId' | 'codeReviewProviderId' | 'planProviderId',
      model: string,
      providerId: string
    ): void => {
      void onPatch({ [modelKey]: model, [providerKey]: providerId })
    },
    [onPatch]
  )

  // Persist a role-level reasoning slot to agents.kun.*. 'off' is the default;
  // mergeKunRuntimeSettings strips 'off'/invalid, so the field round-trips clean.
  const persistRoleReasoning = useCallback(
    (
      key: 'titleReasoningEffort' | 'summaryReasoningEffort' | 'codeReviewReasoningEffort',
      effort: ModelReasoningEffort
    ): void => {
      void onPatch({ [key]: effort })
    },
    [onPatch]
  )

  const isBuiltin = (id: string): boolean => BUILTIN_IDS.has(id)
  const delegatable = useMemo(() => {
    // Kun always installs its first-party profiles at composition time. Until
    // the runtime contract has an explicit disabled-builtin list, presenting a
    // power switch here would be a false promise: an omitted builtin is added
    // back by mergeBuiltinSubagentProfiles(). Keep those rows honestly enabled.
    const builtins = BUILTIN_AGENTS.map((builtin) => {
      const override = subagents.profiles.find((profile) => profile.id === builtin.id)
      return override ? { ...builtin, ...override, enabled: true } : builtin
    })
    const custom = subagents.profiles.filter((p) => !BUILTIN_IDS.has(p.id))
    return [...builtins, ...custom]
  }, [subagents.profiles])

  const extensionAgentIds = useMemo(() => new Set(
    BUILTIN_AGENT_CATALOG
      .filter((agent) => agent.family !== 'base')
      .map((agent) => agent.id)
  ), [])
  const enabledExtensionAgentCount = delegatable.filter((profile) =>
    extensionAgentIds.has(profile.id) && profileSurfaces(profile).length > 0
  ).length
  const extensionAgentsStatus = enabledExtensionAgentCount === 0
    ? 'disabled'
    : enabledExtensionAgentCount === extensionAgentIds.size
      ? 'enabled'
      : 'partial'
  const setExtensionAgentsEnabled = useCallback((enabled: boolean): void => {
    const profilesById = new Map(subagents.profiles.map((profile) => [profile.id, profile]))
    for (const builtin of BUILTIN_AGENTS) {
      if (!extensionAgentIds.has(builtin.id)) continue
      const current = profilesById.get(builtin.id) ?? builtin
      const activeSurfaces: KunSubagentSurfaceV1[] = [
        ...(BUILTIN_AGENT_BY_ID.get(builtin.id)?.recommendedSurfaces ?? [])
      ]
      profilesById.set(builtin.id, {
        ...current,
        surfaces: enabled ? activeSurfaces : []
      })
    }
    persistProfiles([...profilesById.values()])
  }, [extensionAgentIds, persistProfiles, subagents.profiles])

  const toggleSurface = useCallback((id: string, surface: SurfaceTab): void => {
    const profile = delegatable.find((candidate) => candidate.id === id)
    if (!profile || (id === 'general' && surface === 'shared')) return
    const current = profileSurfaces(profile)
    if (surface === 'shared') {
      upsertProfile(id, { surfaces: current.includes('shared') ? [] : ['shared'] })
      return
    }
    if (current.includes('shared')) return
    const next = current.includes(surface)
      ? current.filter((candidate) => candidate !== surface)
      : [...current, surface]
    upsertProfile(id, { surfaces: next })
  }, [delegatable, upsertProfile])

  const catalogAgents = useMemo<CatalogAgent[]>(() => {
    const workspaceById = new Map(workspaceAgents.map((entry) => [entry.id, entry]))
    const seen = new Set<string>()
    const rows: CatalogAgent[] = []

    for (const profile of delegatable) {
      const workspace = workspaceById.get(profile.id)
      const builtin = isBuiltin(profile.id)
      const metadata = BUILTIN_AGENT_BY_ID.get(profile.id)
      if (workspace) {
        const merged = {
          ...workspaceProfileToKun(workspace),
          // Keep any GUI surface/model overrides when the same id exists in settings,
          // but the role body still comes from the workspace markdown overlay.
          ...(profile.surfaces !== undefined ? { surfaces: profile.surfaces } : {}),
          ...(profile.model ? { model: profile.model } : {}),
          ...(profile.providerId ? { providerId: profile.providerId } : {}),
          ...(profile.reasoningEffort ? { reasoningEffort: profile.reasoningEffort } : {})
        }
        const name = merged.name || merged.id
        const desc = merged.description ?? ''
        rows.push({
          profile: merged,
          builtin: false,
          source: 'workspace',
          ...(workspace.filePath ? { filePath: workspace.filePath } : {}),
          name,
          desc,
          // Overlays of first-party ids keep their catalog category so Base/filters
          // still find them; pure workspace ids land in custom.
          category: metadata?.category ?? 'custom',
          baseAgent: metadata?.family === 'base',
          searchText: [merged.id, name, desc, workspace.filePath, metadata?.name, metadata?.description]
            .filter(Boolean)
            .join(' ')
            .toLocaleLowerCase()
        })
        seen.add(profile.id)
        continue
      }
      const name = builtin
        ? t(`subagentsPanel.role.${profile.id}.name`, profile.name || profile.id)
        : profile.name || profile.id
      const desc = builtin
        ? t(`subagentsPanel.role.${profile.id}.desc`, profile.description ?? '')
        : (profile.description ?? '')
      const category: AgentCategory = metadata?.category ?? 'custom'
      const baseAgent = metadata?.family === 'base'
      rows.push({
        profile,
        builtin,
        source: builtin ? 'builtin' : 'configured',
        name,
        desc,
        category,
        baseAgent,
        searchText: [
          profile.id,
          name,
          desc,
          metadata?.name,
          metadata?.description,
          ...(metadata?.routingTerms ?? [])
        ].filter(Boolean).join(' ').toLocaleLowerCase()
      })
      seen.add(profile.id)
    }

    for (const workspace of workspaceAgents) {
      if (seen.has(workspace.id)) continue
      const profile = workspaceProfileToKun(workspace)
      const name = profile.name || profile.id
      const desc = profile.description ?? ''
      rows.push({
        profile,
        builtin: false,
        source: 'workspace',
        ...(workspace.filePath ? { filePath: workspace.filePath } : {}),
        name,
        desc,
        category: 'custom',
        baseAgent: false,
        searchText: [profile.id, name, desc, workspace.filePath].filter(Boolean).join(' ').toLocaleLowerCase()
      })
    }

    return rows.sort((left, right) => {
      const categoryDelta = AGENT_CATEGORY_ORDER.indexOf(left.category) - AGENT_CATEGORY_ORDER.indexOf(right.category)
      return categoryDelta || left.name.localeCompare(right.name)
    })
  }, [delegatable, t, workspaceAgents])

  const panelSurface: Exclude<SurfaceTab, 'shared'> = activeRoute === 'write'
    ? 'write'
    : activeRoute === 'design'
      ? 'design'
      : 'code'

  const normalizedQuery = catalogQuery.trim().toLocaleLowerCase()
  const filteredCatalogAgents = useMemo(() => catalogAgents.filter((agent) => {
    if (variant === 'panel' && !profileAvailableOnSurface(agent.profile, panelSurface)) return false
    if (categoryFilter === 'base' && !agent.baseAgent) return false
    if (categoryFilter !== 'all' && categoryFilter !== 'base' && agent.category !== categoryFilter) return false
    return !normalizedQuery || agent.searchText.includes(normalizedQuery)
  }), [catalogAgents, categoryFilter, normalizedQuery, panelSurface, variant])

  const pageCount = Math.max(1, Math.ceil(filteredCatalogAgents.length / SETTINGS_PAGE_SIZE))
  const visibleCatalogAgents = variant === 'settings'
    ? filteredCatalogAgents.slice((catalogPage - 1) * SETTINGS_PAGE_SIZE, catalogPage * SETTINGS_PAGE_SIZE)
    : filteredCatalogAgents

  useEffect(() => {
    setCatalogPage(1)
  }, [catalogQuery, categoryFilter, selectedSurface])

  useEffect(() => {
    if (catalogPage > pageCount) setCatalogPage(pageCount)
  }, [catalogPage, pageCount])

  const groupedCatalogAgents = useMemo(() => AGENT_CATEGORY_ORDER
    .map((category) => ({
      category,
      agents: visibleCatalogAgents.filter((agent) => agent.category === category)
    }))
    .filter((group) => group.agents.length > 0), [visibleCatalogAgents])

  const categoryCounts = useMemo(() => new Map<AgentCatalogFilter, number>([
    ['base', catalogAgents.filter((agent) => agent.baseAgent).length],
    ...AGENT_CATEGORY_ORDER.map((category): [AgentCatalogFilter, number] => [
      category,
      catalogAgents.filter((agent) => agent.category === category).length
    ])
  ]), [catalogAgents])

  const selectedCatalogAgent = visibleCatalogAgents.find((agent) => agent.profile.id === selectedProfileId)
    ?? visibleCatalogAgents[0]
    ?? null
  const configuredCount = catalogAgents.filter(({ profile }) => Boolean(
    profile.model || profile.providerId || profile.reasoningEffort
  )).length

  const toggleCategory = useCallback((category: AgentCategory): void => {
    setCollapsedCategories((current) => {
      const next = new Set(current)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }, [])

  const selectCategory = useCallback((category: AgentCategoryFilter): void => {
    setCategoryFilter(category)
    if (category === 'all' || category === 'base') return
    setCollapsedCategories((current) => {
      if (!current.has(category)) return current
      const next = new Set(current)
      next.delete(category)
      return next
    })
  }, [])

  const selectCatalogAgent = useCallback((agent: CatalogAgent): void => {
    setSelectedProfileId(agent.profile.id)
    setCollapsedCategories((current) => {
      if (!current.has(agent.category)) return current
      const next = new Set(current)
      next.delete(agent.category)
      return next
    })
  }, [])

  return <SubagentSettingsContent context={{
    variant, className, t, tSettings, settingsTab, setSettingsTab, subagents, patchSubagents,
    dialog, setDialog, selectedSurface, setSelectedSurface, catalogQuery, setCatalogQuery,
    categoryFilter, catalogAgents, selectCategory, categoryCounts, groupedCatalogAgents,
    normalizedQuery, collapsedCategories, toggleCategory, composerModelGroups, setCategoryModels,
    setCategoryReasoning, resetCategoryConfiguration, selectedCatalogAgent, selectCatalogAgent,
    filteredCatalogAgents, catalogPage, pageCount, setCatalogPage, setProfileModel,
    setProfileReasoning, toggleSurface, toggleEnabled, removeProfile, compactionSlot,
    persistCompactionSlot, codeReviewSlot, codeReviewReasoning, persistRoleSlot,
    persistRoleReasoning, planSlot, titleSlot, titleReasoning, summarySlot, summaryReasoning,
    smallModel, saveDialog, isBuiltin, extensionAgentsStatus, enabledExtensionAgentCount,
    setExtensionAgentsEnabled, delegatable, panelSurface, configuredCount, extensionAgentIds, systemRolesOpen,
    setSystemRolesOpen
  }} />
}
