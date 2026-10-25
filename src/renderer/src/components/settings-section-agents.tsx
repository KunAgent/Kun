import type {
  KunBrowserUseSettingsV1,
  ModelProviderProfileV1
} from '@shared/app-settings'
import {
  DEFAULT_MODEL_PROVIDER_ID,
  DEFAULT_TOOL_OUTPUT_MAX_BYTES,
  DEFAULT_TOOL_OUTPUT_MAX_LINES,
  defaultKunGraphSettings,
  kunToolPermissionModeFromSettings
} from '@shared/app-settings'
import {
  defaultKunBrowserUseSettings,
  defaultKunContextCompactionSettings
} from '@shared/app-settings-kun-defaults'
import { defaultModelProviderSettings } from '@shared/app-settings-provider-core'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { AgentSettingsPanel } from './settings-navigation'
import { AgentsAssistantSettingsPanel } from './settings-section-agents-assistant'
import { AgentsCollaborationSettingsPanel } from './settings-section-agents-collaboration'
import { AgentsHarnessesSettingsPanel } from './settings-section-agents-harnesses'
import { AgentsPermissionsSettingsPanel } from './settings-section-agents-permissions'
import { AgentsProjectSettingsPanel } from './settings-section-agents-project'
import { AgentsRuntimeSettingsPanel } from './settings-section-agents-runtime'
import { AgentsToolsSettingsPanels } from './settings-section-agents-tools'
import {
  EMPTY_TOKEN_ECONOMY_SAVINGS_STATE,
  loadTokenEconomySavingsSummary,
  modelContextProfileSummary,
  summarizeMcpPermissionSources,
  summarizeSkillPermissionSources,
  type TokenEconomySavingsState
} from './settings-section-agents-utils'

export { LaboratorySettingsSection } from './settings-section-laboratory'
export { modelProvidersSettingsPatch } from './settings-section-providers'

/** Kun's own Agent settings. Each settings page shows one panel; there are no tabs here. */
export function AgentsSettingsSection({
  ctx,
  panel = 'assistant'
}: {
  ctx: Record<string, any>
  panel?: AgentSettingsPanel
}): ReactElement {
  const {
    t,
    tCommon,
    openStorageSettings,
    form,
    kun,
    update,
    updateKun,
    showRuntimeToken,
    setShowRuntimeToken,
    portError,
    selectControlClass,
    openOnboardingPreview,
    pickWorkspace,
    resetWorkspaceToDefault,
    workspacePickerError,
    guiUpdateInfo,
    checkingGuiUpdate,
    downloadingGuiUpdate,
    installingGuiUpdate,
    guiUpdateDownloaded,
    guiUpdateProgress,
    guiUpdateError,
    checkGuiUpdate,
    downloadGuiUpdate,
    installGuiUpdate,
    logPath,
    logDirOpenError,
    setLogDirOpenError,
    compactHomePath,
    expandHomePath,
    compactHomePathList,
    expandHomePathList,
    pickWriteWorkspace,
    resetWriteWorkspaceToDefault,
    writeWorkspacePickerError,
    writeInlineBaseUrlInherited,
    effectiveWriteInlineBaseUrl,
    writeInlineModelInherited,
    effectiveWriteInlineModel,
    setWriteDebugModalOpen,
    loadWriteDebugEntries,
    agentsSectionRef,
    skillSectionRef,
    mcpSectionRef,
    permissionsSectionRef,
    skillRoots,
    skillRootsLoading,
    toggleSkillRoot,
    skillNotice,
    openSkillRoot,
    openPlugins,
    mcpConfigPath,
    mcpConfigExists,
    mcpConfigText,
    setMcpConfigText,
    mcpLoading,
    mcpBusy,
    mcpNotice,
    saveMcpConfig,
    loadMcpConfig,
    openMcpConfigDir,
    activeProjectWorkspaceRoot,
    projectConfig,
    projectConfigText,
    setProjectConfigText,
    projectConfigLoading,
    projectConfigBusy,
    projectConfigNotice,
    loadProjectConfig,
    saveProjectConfig,
    setProjectConfigTrust,
    openProjectConfigDir,
    runtimeInfo,
    toolDiagnostics,
    memoryRecords,
    runtimeDiagnosticsBusy,
    runtimeDiagnosticsNotice,
    refreshKunDiagnostics,
    disableMemoryRecord,
    restoreMemoryRecord,
    deleteMemoryRecord,
    pickClawWorkspace,
    resetClawWorkspaceToDefault,
    clawWorkspacePickerError,
    splitSettingsList,
    listSettingsText
  } = ctx
  const productionManagedDataDir = typeof window !== 'undefined' &&
    window.kunGui?.appEnvironment?.flavor === 'production'
  const windowsStorageManagement = productionManagedDataDir && window.kunGui?.platform === 'win32'
  const mcpSearch = kun.mcpSearch ?? {
    enabled: false,
    mode: 'auto',
    autoThresholdToolCount: 24,
    topKDefault: 5,
    topKMax: 10,
    minScore: 0.15
  }
  const tokenEconomyDefaults = {
    enabled: false,
    compressToolDescriptions: true,
    compressToolResults: true,
    conciseResponses: true,
    historyHygiene: {
      maxToolResultLines: 320,
      maxToolResultBytes: 32768,
      maxToolResultTokens: 8000,
      maxToolArgumentStringBytes: 8192,
      maxToolArgumentStringTokens: 2000,
      maxArrayItems: 80
    }
  }
  const tokenEconomy = {
    ...tokenEconomyDefaults,
    ...(kun.tokenEconomy ?? {}),
    enabled: kun.tokenEconomy?.enabled ?? kun.tokenEconomyMode ?? false,
    historyHygiene: {
      ...tokenEconomyDefaults.historyHygiene,
      ...(kun.tokenEconomy?.historyHygiene ?? {})
    }
  }
  const [tokenEconomySavingsState, setTokenEconomySavingsState] =
    useState<TokenEconomySavingsState>(EMPTY_TOKEN_ECONOMY_SAVINGS_STATE)
  const [mcpRawMode, setMcpRawMode] = useState(false)
  const activePanel = panel
  const skillPermissionSummary = summarizeSkillPermissionSources(skillRoots, form.disabledSkillIds)
  const mcpPermissionSummary = useMemo(
    () => summarizeMcpPermissionSources(mcpConfigText),
    [mcpConfigText]
  )
  useEffect(() => {
    let cancelled = false
    if (!tokenEconomy.enabled) {
      setTokenEconomySavingsState(EMPTY_TOKEN_ECONOMY_SAVINGS_STATE)
      return
    }
    setTokenEconomySavingsState((current) => ({ ...current, loading: true }))
    void loadTokenEconomySavingsSummary()
      .then((summary) => {
        if (!cancelled) setTokenEconomySavingsState({ loading: false, loaded: true, summary })
      })
      .catch(() => {
        if (!cancelled) setTokenEconomySavingsState({ loading: false, loaded: true, summary: null })
      })
    return () => {
      cancelled = true
    }
  }, [tokenEconomy.enabled])
  const tokenEconomySavings = tokenEconomySavingsState.summary
  const storage = kun.storage ?? {
    backend: 'hybrid',
    sqlitePath: ''
  }
  const contextCompaction = kun.contextCompaction ?? defaultKunContextCompactionSettings()
  const fastContext = kun.fastContext ?? {
    enabled: true,
    model: '',
    providerId: '',
    fast: false
  }
  const graph = kun.graph ?? defaultKunGraphSettings()
  const modelContext = modelContextProfileSummary({
    model: kun.model,
    fallbackSoftThreshold: contextCompaction.defaultSoftThreshold,
    fallbackHardThreshold: contextCompaction.defaultHardThreshold
  })
  const runtimeTuning = kun.runtimeTuning ?? {
    maxConcurrentTurns: 256,
    maxWallTimeMs: 86400000,
    streamIdleTimeoutMs: 450000,
    toolStorm: {
      enabled: true
    },
    toolArgumentRepair: {
      maxStringBytes: 524288
    }
  }
  const toolOutputLimits = kun.toolOutputLimits ?? {
    maxLines: DEFAULT_TOOL_OUTPUT_MAX_LINES,
    maxBytes: DEFAULT_TOOL_OUTPUT_MAX_BYTES
  }
  const updateMcpSearch = (patch: Record<string, unknown>): void => {
    updateKun({
      mcpSearch: {
        ...mcpSearch,
        ...patch
      }
    })
  }
  const updateTokenEconomy = (patch: Record<string, unknown>): void => {
    const enabled = typeof patch.enabled === 'boolean' ? patch.enabled : tokenEconomy.enabled
    updateKun({
      tokenEconomyMode: enabled,
      tokenEconomy: {
        ...tokenEconomy,
        ...patch,
        enabled
      }
    })
  }
  const updateHistoryHygiene = (patch: Record<string, unknown>): void => {
    updateTokenEconomy({
      historyHygiene: {
        ...tokenEconomy.historyHygiene,
        ...patch
      }
    })
  }
  const updateStorage = (patch: Record<string, unknown>): void => {
    updateKun({
      storage: {
        ...storage,
        ...patch
      }
    })
  }
  const updateContextCompaction = (patch: Record<string, unknown>): void => {
    updateKun({
      contextCompaction: {
        ...contextCompaction,
        ...patch
      }
    })
  }
  const updateFastContext = (patch: Record<string, unknown>): void => {
    updateKun({
      fastContext: {
        ...fastContext,
        ...patch
      }
    })
  }
  const updateRuntimeTuning = (patch: Record<string, unknown>): void => {
    updateKun({
      runtimeTuning: {
        ...runtimeTuning,
        ...patch
      }
    })
  }
  const updateToolOutputLimits = (patch: Record<string, unknown>): void => {
    updateKun({
      toolOutputLimits: {
        ...toolOutputLimits,
        ...patch
      }
    })
  }
  const updateToolStorm = (patch: Record<string, unknown>): void => {
    updateRuntimeTuning({
      toolStorm: {
        ...runtimeTuning.toolStorm,
        ...patch
      }
    })
  }
  const updateToolArgumentRepair = (patch: Record<string, unknown>): void => {
    updateRuntimeTuning({
      toolArgumentRepair: {
        ...runtimeTuning.toolArgumentRepair,
        ...patch
      }
    })
  }
  const provider = form.provider ?? defaultModelProviderSettings()
  const modelProviders = provider.providers as ModelProviderProfileV1[]
  const computerUse = kun.computerUse ?? {
    enabled: false,
    mode: 'auto' as const,
    maxImageDimension: 1280,
    maxActionsPerTurn: 40
  }
  const browserUse = kun.browserUse ?? defaultKunBrowserUseSettings()
  const instructions = kun.instructions ?? {
    enabled: true
  }
  const updateInstructions = (patch: Record<string, unknown>): void => {
    updateKun({
      instructions: {
        ...instructions,
        ...patch
      }
    })
  }
  const updateComputerUse = (patch: Record<string, unknown>): void => {
    updateKun({
      computerUse: {
        ...computerUse,
        ...patch
      }
    })
  }
  const updateBrowserUse = (patch: Partial<KunBrowserUseSettingsV1>): void => {
    updateKun({
      browserUse: {
        ...browserUse,
        ...patch
      }
    })
  }
  const quality = kun.quality ?? {
    enabled: true,
    strictness: 'standard' as const,
    ignoreRules: [],
    ignoreFiles: [],
    maxFindings: 12
  }
  const updateQuality = (patch: Record<string, unknown>): void => {
    updateKun({
      quality: {
        ...quality,
        ...patch
      }
    })
  }
  const activeProviderId = kun.providerId?.trim() || DEFAULT_MODEL_PROVIDER_ID
  const activeProvider = modelProviders.find((item) => item.id === activeProviderId) ?? modelProviders[0]
  const activeProviderModels = activeProvider?.models ?? []
  const promptOptimization = {
    enabled: true,
    providerId: '',
    model: '',
    prompt: '',
    timeoutMs: 60000,
    ...(kun.promptOptimization ?? {})
  }
  const promptOptimizationProviderId = promptOptimization.providerId?.trim() || activeProviderId
  const promptOptimizationProvider =
    modelProviders.find((item) => item.id === promptOptimizationProviderId) ?? activeProvider
  const promptOptimizationModels = promptOptimizationProvider?.models ?? []
  const promptOptimizationDefaultModel = (() => {
    const providerId = promptOptimizationProvider?.id ?? promptOptimizationProviderId
    const smallModel = kun.smallModel?.trim() ?? ''
    const smallProviderId = kun.smallModelProviderId?.trim() || activeProviderId
    if (smallModel && smallProviderId === providerId) return smallModel
    const mainModel = kun.model?.trim() ?? ''
    if (mainModel && activeProviderId === providerId) return mainModel
    return promptOptimizationModels[0] ?? mainModel
  })()
  const updatePromptOptimization = (patch: Record<string, unknown>): void => {
    updateKun({
      promptOptimization: {
        ...promptOptimization,
        ...patch
      }
    })
  }
  const selectKunProvider = (providerId: string): void => {
    const nextProvider = modelProviders.find((item) => item.id === providerId) ?? activeProvider
    const nextModel = nextProvider?.models.includes(kun.model)
      ? kun.model
      : nextProvider?.models[0] ?? kun.model
    updateKun({ providerId, model: nextModel, apiKey: '', baseUrl: '' })
  }
  const toolPermissionMode = kunToolPermissionModeFromSettings(kun)
  const approvalReview = kun.approvalReview ?? { mode: 'inherit' as const }
  const view = {
    ...ctx,
    productionManagedDataDir, windowsStorageManagement, mcpSearch, tokenEconomy,
    tokenEconomySavingsState, mcpRawMode, setMcpRawMode, activePanel, skillPermissionSummary, mcpPermissionSummary,
    tokenEconomySavings, storage, contextCompaction, fastContext, modelContext, runtimeTuning, toolOutputLimits,
    updateMcpSearch, updateTokenEconomy, updateHistoryHygiene, updateStorage, updateContextCompaction, updateFastContext,
    updateRuntimeTuning, updateToolOutputLimits, updateToolStorm, updateToolArgumentRepair, provider,
    modelProviders, instructions, updateInstructions, quality, updateQuality, activeProvider,
    activeProviderModels, promptOptimization, promptOptimizationModels, promptOptimizationDefaultModel,
    updatePromptOptimization, selectKunProvider, toolPermissionMode, approvalReview
  }

  if (panel === 'assistant') return <AgentsAssistantSettingsPanel view={view} />
  if (panel === 'permissions') return <AgentsPermissionsSettingsPanel view={view} />
  if (panel === 'project') return <AgentsProjectSettingsPanel view={view} />
  if (panel === 'skills' || panel === 'tools') return <AgentsToolsSettingsPanels view={view} />
  if (panel === 'runtime') return <AgentsRuntimeSettingsPanel view={view} />
  if (panel === 'harnesses') return <AgentsHarnessesSettingsPanel view={view} />
  return (
    <AgentsCollaborationSettingsPanel view={{
      t, kun, modelProviders, activePanel,
      beforeSave: ctx.beforeAdeCollaborationSave,
      onSaved: ctx.onAdeCollaborationSaved,
      onDraftChange: ctx.onAdeCollaborationDraftChange
    }} />
  )
}
