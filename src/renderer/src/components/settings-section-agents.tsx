import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import type {
  AppSettingsV1,
  KunToolPermissionMode,
  ModelProviderProfileV1
} from '@shared/app-settings'
import {
  DEFAULT_MODEL_PROVIDER_ID,
  DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL,
  DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
  DEFAULT_WRITE_INLINE_COMPLETION_MODEL,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS,
  DEFAULT_KUN_DATA_DIR,
  MIN_KUN_LOCAL_PORT,
  WRITE_INLINE_COMPLETION_MODEL_IDS,
  defaultModelProviderSettings,
  isKunRuntimeInsecure,
  kunToolPermissionModeFromSettings,
  kunToolPermissionModeSettings
} from '@shared/app-settings'
import type { GuiUpdateChannel } from '@shared/gui-update'
import type {
  ComputerUsePermissionKind,
  ComputerUsePermissions,
  ComputerUsePermissionState,
  SkillRootListItem
} from '@shared/kun-gui-api'
import {
  Ban,
  Check,
  Eye,
  FolderOpen,
  FolderPen,
  Hand,
  Loader2,
  LockKeyholeOpen,
  RefreshCw,
  Settings,
  ShieldQuestion,
  Trash2
} from 'lucide-react'
import { GuiUpdateControl } from './settings-gui-update'
import { McpServersEditor } from './mcp/McpServersEditor'
import { parseMcpConfigText, type McpFormServer } from './mcp/mcp-config-form'
import {
  AdvancedSettingsDisclosure,
  InlineNoticeView,
  ModelSelect,
  SecretInput,
  SectionJumpButton,
  SettingsCard,
  SettingRow,
  Toggle
} from './settings-controls'
import { formatCompactNumber } from '../hooks/use-thread-usage'
import { parseUsageResponse } from '../hooks/usage-response'

export { modelProvidersSettingsPatch } from './settings-section-providers'

const TOOL_PERMISSION_OPTIONS: Array<{
  value: KunToolPermissionMode
  labelKey: string
  descriptionKey: string
  Icon: typeof Hand
  iconClass: string
}> = [
  {
    value: 'always-ask',
    labelKey: 'toolPermissionAlwaysAsk',
    descriptionKey: 'toolPermissionAlwaysAskDesc',
    Icon: Hand,
    iconClass: 'border-sky-400/30 bg-sky-500/10 text-sky-700 dark:text-sky-200'
  },
  {
    value: 'read-only',
    labelKey: 'toolPermissionReadOnly',
    descriptionKey: 'toolPermissionReadOnlyDesc',
    Icon: Eye,
    iconClass: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  },
  {
    value: 'sensitive-ask',
    labelKey: 'toolPermissionSensitiveAsk',
    descriptionKey: 'toolPermissionSensitiveAskDesc',
    Icon: ShieldQuestion,
    iconClass: 'border-amber-400/35 bg-amber-500/10 text-amber-700 dark:text-amber-200'
  },
  {
    value: 'workspace-write',
    labelKey: 'toolPermissionWorkspaceWrite',
    descriptionKey: 'toolPermissionWorkspaceWriteDesc',
    Icon: FolderPen,
    iconClass: 'border-indigo-400/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-200'
  },
  {
    value: 'bypass',
    labelKey: 'toolPermissionBypass',
    descriptionKey: 'toolPermissionBypassDesc',
    Icon: LockKeyholeOpen,
    iconClass: 'border-orange-400/35 bg-orange-500/10 text-orange-700 dark:text-orange-200'
  }
]

function statusPill(status: string | undefined): string {
  if (status === 'available') return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  if (status === 'disabled') return 'border-ds-border-muted bg-ds-card text-ds-faint'
  return 'border-red-300/50 bg-red-500/10 text-red-700 dark:text-red-200'
}

function skillRootShortLabel(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts.slice(-2).join('/') || path
}

function compactList(values: unknown, empty: string): string {
  if (!Array.isArray(values) || values.length === 0) return empty
  return values
    .map((value) => typeof value === 'string' ? value : JSON.stringify(value))
    .slice(0, 4)
    .join(', ')
}

type SkillPermissionSummary = {
  enabledRoots: number
  disabledRoots: number
  workspaceRoots: number
  globalRoots: number
  disabledSkillIds: number
}

function summarizeSkillPermissionSources(
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

type McpPermissionSummary = {
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

function summarizeMcpPermissionSources(text: string): McpPermissionSummary {
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

type TokenEconomySavingsSummary = {
  tokens: number
}

type TokenEconomySavingsState = {
  loading: boolean
  loaded: boolean
  summary: TokenEconomySavingsSummary | null
}

const EMPTY_TOKEN_ECONOMY_SAVINGS_STATE: TokenEconomySavingsState = {
  loading: false,
  loaded: false,
  summary: null
}

type ModelContextProfileSummary = {
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

function modelContextProfileSummary(input: {
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

async function loadTokenEconomySavingsSummary(): Promise<TokenEconomySavingsSummary | null> {
  if (typeof window === 'undefined' || typeof window.kunGui?.runtimeRequest !== 'function') return null
  const response = await window.kunGui.runtimeRequest('/v1/usage?group_by=thread', 'GET')
  if (!response.ok || !response.body.trim()) return null
  const parsed = parseUsageResponse<{ totals?: Record<string, unknown> }>(response.body, 'token economy usage')
  const totals = parsed.totals ?? {}
  const tokens = usageNumber(totals.token_economy_savings_tokens)
  if (tokens <= 0) return null
  return { tokens }
}

export function AgentsSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    tCommon,
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
    scrollToAgentSection,
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
    runtimeInfo,
    toolDiagnostics,
    memoryRecords,
    runtimeDiagnosticsBusy,
    runtimeDiagnosticsNotice,
    refreshKunDiagnostics,
    disableMemoryRecord,
    deleteMemoryRecord,
    pickClawWorkspace,
    resetClawWorkspaceToDefault,
    clawWorkspacePickerError,
    splitSettingsList,
    listSettingsText
  } = ctx
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
  const contextCompaction = kun.contextCompaction ?? {
    defaultSoftThreshold: 16000,
    defaultHardThreshold: 24000,
    summaryMode: 'model',
    summaryTimeoutMs: 15000,
    summaryMaxTokens: 1200,
    summaryInputMaxBytes: 98304
  }
  const modelContext = modelContextProfileSummary({
    model: kun.model,
    fallbackSoftThreshold: contextCompaction.defaultSoftThreshold,
    fallbackHardThreshold: contextCompaction.defaultHardThreshold
  })
  const runtimeTuning = kun.runtimeTuning ?? {
    streamIdleTimeoutMs: 45000,
    toolStorm: {
      enabled: true,
      windowSize: 8,
      threshold: 3
    },
    toolArgumentRepair: {
      maxStringBytes: 524288
    }
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
  const updateRuntimeTuning = (patch: Record<string, unknown>): void => {
    updateKun({
      runtimeTuning: {
        ...runtimeTuning,
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
  const updateComputerUse = (patch: Record<string, unknown>): void => {
    updateKun({
      computerUse: {
        ...computerUse,
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
  const selectKunProvider = (providerId: string): void => {
    const nextProvider = modelProviders.find((item) => item.id === providerId) ?? activeProvider
    const nextModel = nextProvider?.models.includes(kun.model)
      ? kun.model
      : nextProvider?.models[0] ?? kun.model
    updateKun({ providerId, model: nextModel, apiKey: '', baseUrl: '' })
  }
  const toolPermissionMode = kunToolPermissionModeFromSettings(kun)

  return (
            <>
              <div className="mb-6 flex flex-wrap gap-2">
                <SectionJumpButton label={t('agentsQuickBase')} onClick={() => scrollToAgentSection('agents')} />
                <SectionJumpButton label={t('agentsQuickSkill')} onClick={() => scrollToAgentSection('skill')} />
                <SectionJumpButton label={t('agentsQuickMcp')} onClick={() => scrollToAgentSection('mcp')} />
                <SectionJumpButton
                  label={t('agentsQuickPermissions')}
                  onClick={() => scrollToAgentSection('permissions')}
                />
              </div>

              <div ref={agentsSectionRef}>
                <SettingsCard title={t('agents')}>
                  <SettingRow
                    title={t('autoStart')}
                    description={t('autoStartDesc')}
                    control={
                      <Toggle
                        checked={kun.autoStart}
                        onChange={(v) => updateKun({ autoStart: v })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('kunProvider')}
                    description={t('kunProviderSelectDesc')}
                    control={
                      <select
                        className={selectControlClass}
                        value={activeProvider?.id ?? DEFAULT_MODEL_PROVIDER_ID}
                        onChange={(e) => selectKunProvider(e.target.value)}
                      >
                        {modelProviders.map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                    }
                  />
                  <SettingRow
                    title={t('kunModel')}
                    description={t('kunModelDesc')}
                    control={
                      <ModelSelect
                        value={kun.model}
                        options={activeProviderModels}
                        optionLabel={(model) =>
                          model === activeProviderModels[0]
                            ? t('modelSelectDefaultSuffix', { model })
                            : model}
                        allowCustom
                        customLabel={t('modelSelectCustomOption')}
                        customPlaceholder={t('modelSelectCustomPlaceholder')}
                        selectClassName={selectControlClass}
                        onChange={(model) => {
                          const next = model.trim()
                          updateKun({ model: next || (activeProviderModels[0] ?? kun.model) })
                        }}
                      />
                    }
                  />
                  <SettingRow
                    title={t('codePromptPrefix')}
                    description={t('codePromptPrefixDesc')}
                    wideControl
                    control={
                      <textarea
                        value={form?.codePromptPrefix ?? ''}
                        onChange={(e) => update({ codePromptPrefix: e.target.value })}
                        placeholder={t('codePromptPrefixPlaceholder')}
                        className="min-h-[110px] w-full resize-y rounded-xl border border-ds-border bg-ds-main/60 px-3 py-3 text-[14px] leading-6 text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/25"
                      />
                    }
                  />
                  <div className="px-3 py-4">
                    <AdvancedSettingsDisclosure
                      title={t('kunAssistantAdvanced')}
                      description={t('kunAssistantAdvancedDesc')}
                    >
                      <div className="divide-y divide-ds-border-muted">
                  <SettingRow
                    title={t('port')}
                    description={t('portDesc')}
                    control={
                      <div>
                        <input
                          type="number"
                          min={MIN_KUN_LOCAL_PORT}
                          max={65535}
                          className={`w-28 rounded-xl border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:outline-none focus:ring-1 ${
                            portError
                              ? 'border-red-400 focus:ring-red-300'
                              : 'border-ds-border focus:border-accent/40 focus:ring-accent/30'
                          }`}
                          value={kun.port}
                          onChange={(e) => updateKun({ port: Number(e.target.value) })}
                        />
                        {portError ? (
                          <p className="mt-1 text-[12px] text-red-700 dark:text-red-300">{portError}</p>
                        ) : null}
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('kunBinary')}
                    description={t('kunBinaryDesc')}
                    control={
                      <input
                        className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                        placeholder={t('kunBinaryPlaceholder')}
                        value={compactHomePath(kun.binaryPath)}
                        onChange={(e) => updateKun({ binaryPath: expandHomePath(e.target.value) })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('kunDataDir')}
                    description={t('kunDataDirDesc')}
                    control={
                      <input
                        className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                        placeholder={DEFAULT_KUN_DATA_DIR}
                        value={compactHomePath(kun.dataDir)}
                        onChange={(e) => updateKun({ dataDir: expandHomePath(e.target.value) })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('runtimeToken')}
                    description={t('runtimeTokenDesc')}
                    control={
                      <SecretInput
                        value={kun.runtimeToken}
                        onChange={(value) => updateKun({ runtimeToken: value })}
                        visible={showRuntimeToken}
                        onToggleVisibility={() => setShowRuntimeToken((value: boolean) => !value)}
                        showLabel={t('showSecret')}
                        hideLabel={t('hideSecret')}
                        className="md:max-w-md"
                      />
                    }
                  />
                  <SettingRow
                    title={t('kunInsecure')}
                    description={
                      kun.runtimeToken.trim()
                        ? t('kunInsecureDesc')
                        : t('kunInsecureForcedDesc')
                    }
                    control={
                      <Toggle
                        checked={isKunRuntimeInsecure(kun)}
                        disabled={!kun.runtimeToken.trim()}
                        onChange={(v) => updateKun({ insecure: v })}
                      />
                    }
                  />
                      </div>
                    </AdvancedSettingsDisclosure>
                  </div>
                  <SettingRow
                    title={t('kunTokenEconomy')}
                    description={t('kunTokenEconomyDesc')}
                    control={
                      <div className="flex min-w-0 flex-col items-start gap-2 sm:items-end">
                        <Toggle
                          checked={tokenEconomy.enabled}
                          onChange={(enabled) => updateTokenEconomy({ enabled })}
                        />
                        {tokenEconomy.enabled ? (
                          <div className="max-w-full rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1.5 text-[12px] font-medium leading-5 text-emerald-700 dark:text-emerald-200">
                            {tokenEconomySavings ? (
                              <span>
                                {t('kunTokenEconomySavings', {
                                  tokens: formatCompactNumber(tokenEconomySavings.tokens)
                                })}
                              </span>
                            ) : tokenEconomySavingsState.loading ? (
                              <span>{t('kunTokenEconomySavingsLoading')}</span>
                            ) : (
                              <span>{t('kunTokenEconomySavingsEmpty')}</span>
                            )}
                          </div>
                        ) : null}
                      </div>
                    }
                  />
                </SettingsCard>
              </div>

              <div className="mt-6" ref={permissionsSectionRef}>
                <SettingsCard title={t('permissions')}>
                  <div className="px-3 py-4">
                    <InlineNoticeView notice={{ tone: 'info', message: t('permissionsBehaviorHint') }} />
                  </div>
                  <SettingRow
                    title={t('toolPermissionMode')}
                    description={t('toolPermissionModeDesc')}
                    wideControl
                    control={
                      <div
                        role="radiogroup"
                        aria-label={t('toolPermissionMode')}
                        className="grid gap-2 sm:grid-cols-2"
                      >
                        {TOOL_PERMISSION_OPTIONS.map((option) => {
                          const selected = toolPermissionMode === option.value
                          const PermissionIcon = option.Icon
                          return (
                            <button
                              key={option.value}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => updateKun(kunToolPermissionModeSettings(option.value))}
                              className={`min-h-[72px] rounded-lg border px-3 py-2.5 text-left transition ${
                                selected
                                  ? 'border-accent/55 bg-accent/10 text-ds-ink'
                                  : 'border-ds-border-muted bg-ds-card/70 text-ds-ink hover:bg-ds-hover/70'
                              }`}
                            >
                              <span className="flex items-start gap-2">
                                <span
                                  className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${option.iconClass}`}
                                >
                                  <PermissionIcon className="h-4 w-4" strokeWidth={1.9} />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-[13px] font-semibold">{t(option.labelKey)}</span>
                                  <span className="mt-1 block text-[12px] leading-snug text-ds-muted">
                                    {t(option.descriptionKey)}
                                  </span>
                                </span>
                                {selected ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={2} /> : null}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    }
                  />
                </SettingsCard>
              </div>


              <div className="mt-6">
                <SettingsCard title={t('computerUseTitle')}>
                  <div className="space-y-4 px-3 py-4">
                    <InlineNoticeView notice={{ tone: 'info', message: t('computerUseHint') }} />
                    <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-amber-700 dark:text-amber-200">
                      <div className="font-semibold">{t('computerUseModelQualityTitle')}</div>
                      <div className="mt-1">{t('computerUseModelQualityBody')}</div>
                    </div>
                  </div>
                  <SettingRow
                    title={t('computerUseEnable')}
                    description={t('computerUseEnableDesc')}
                    control={
                      <Toggle
                        checked={computerUse.enabled}
                        onChange={(enabled) => updateComputerUse({ enabled })}
                      />
                    }
                  />
                  {computerUse.enabled ? (
                    <>
                      <SettingRow
                        title={t('computerUseMode')}
                        description={t('computerUseModeDesc')}
                        control={
                          <select
                            className={selectControlClass}
                            value={computerUse.mode}
                            onChange={(e) => updateComputerUse({ mode: e.target.value })}
                          >
                            <option value="auto">{t('computerUseModeAuto')}</option>
                            <option value="always">{t('computerUseModeAlways')}</option>
                            <option value="off">{t('computerUseModeOff')}</option>
                          </select>
                        }
                      />
                      <ComputerUsePermissionRow t={t} />
                    </>
                  ) : null}
                </SettingsCard>
              </div>

              <div className="mt-6">
                <SettingsCard title={t('designQualityTitle')}>
                  <div className="px-3 py-4">
                    <InlineNoticeView notice={{ tone: 'info', message: t('designQualityHint') }} />
                  </div>
                  <SettingRow
                    title={t('designQualityEnable')}
                    description={t('designQualityEnableDesc')}
                    control={
                      <Toggle
                        checked={quality.enabled}
                        onChange={(enabled) => updateQuality({ enabled })}
                      />
                    }
                  />
                  {quality.enabled ? (
                    <SettingRow
                      title={t('designQualityStrictness')}
                      description={t('designQualityStrictnessDesc')}
                      control={
                        <select
                          className={selectControlClass}
                          value={quality.strictness}
                          onChange={(e) => updateQuality({ strictness: e.target.value })}
                        >
                          <option value="relaxed">{t('designQualityStrictnessRelaxed')}</option>
                          <option value="standard">{t('designQualityStrictnessStandard')}</option>
                          <option value="strict">{t('designQualityStrictnessStrict')}</option>
                        </select>
                      }
                    />
                  ) : null}
                </SettingsCard>
              </div>

              <div ref={skillSectionRef} className="mt-6">
                <SettingsCard title={t('skill')}>
                  <SettingRow
                    title={t('skillsDetectedDirs')}
                    description={t('skillsDetectedDirsDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-2">
                        {skillRootsLoading && skillRoots.length === 0 ? (
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-3 text-[13px] text-ds-faint">
                            {t('loading')}
                          </div>
                        ) : skillRoots.length === 0 ? (
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-3 text-[13px] text-ds-faint">
                            {t('skillsDetectedDirsEmpty')}
                          </div>
                        ) : (
                          skillRoots.map((root: SkillRootListItem) => (
                            <div
                              key={`${root.id}:${root.path}`}
                              className={`flex items-start justify-between gap-3 rounded-xl border px-3 py-2.5 shadow-sm ${
                                root.enabled ? 'border-ds-border bg-ds-card' : 'border-ds-border-muted bg-ds-main/40'
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-[13px] font-medium text-ds-ink">
                                    {root.labelKey ? tCommon(root.labelKey) : skillRootShortLabel(root.path)}
                                  </span>
                                  <span className="rounded-md border border-ds-border-muted bg-ds-main/50 px-1.5 py-0.5 text-[11px] font-medium text-ds-muted">
                                    {root.scope === 'project' ? t('skillsScopeProject') : t('skillsScopeGlobal')}
                                  </span>
                                  {root.exists ? (
                                    <span className="rounded-md border border-emerald-400/25 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-200">
                                      {t('skillsDirSkillCount', { count: root.skillCount })}
                                    </span>
                                  ) : (
                                    <span className="rounded-md border border-ds-border-muted bg-ds-main/50 px-1.5 py-0.5 text-[11px] font-medium text-ds-faint">
                                      {t('skillsDirNotFound')}
                                    </span>
                                  )}
                                </div>
                                <code className="mt-1 block break-all font-mono text-[12px] text-ds-muted">
                                  {compactHomePath(root.path)}
                                </code>
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                                <button
                                  type="button"
                                  onClick={() => void openSkillRoot(root.path)}
                                  className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                                  aria-label={t('skillsOpenRoot')}
                                  title={t('skillsOpenRoot')}
                                >
                                  <FolderOpen className="h-4 w-4" strokeWidth={1.8} />
                                </button>
                                <Toggle checked={root.enabled} onChange={(value) => toggleSkillRoot(root, value)} />
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('skillsPermissionSources')}
                    description={t('skillsPermissionSourcesDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-2">
                        <div className="grid gap-2 text-[12.5px] text-ds-muted sm:grid-cols-5">
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('skillsPermissionEnabledRoots')}: <span className="font-mono text-ds-ink">{skillPermissionSummary.enabledRoots}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('skillsPermissionDisabledRoots')}: <span className="font-mono text-ds-ink">{skillPermissionSummary.disabledRoots}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('skillsPermissionWorkspaceRoots')}: <span className="font-mono text-ds-ink">{skillPermissionSummary.workspaceRoots}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('skillsPermissionGlobalRoots')}: <span className="font-mono text-ds-ink">{skillPermissionSummary.globalRoots}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('skillsPermissionDisabledIds')}: <span className="font-mono text-ds-ink">{skillPermissionSummary.disabledSkillIds}</span>
                          </div>
                        </div>
                        <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-amber-700 dark:text-amber-200">
                          {t('skillsPermissionRuntimeNote')}
                        </div>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('skillsScanDirs')}
                    description={t('skillsScanDirsDesc')}
                    wideControl
                    control={
                      <textarea
                        value={compactHomePathList(form.claw.skills.extraDirs)}
                        onChange={(event) =>
                          update({
                            claw: {
                              skills: {
                                extraDirs: expandHomePathList(splitSettingsList(event.target.value))
                              }
                            }
                          })
                        }
                        spellCheck={false}
                        placeholder={'~/.agents/skills'}
                        className="min-h-24 w-full rounded-2xl border border-ds-border bg-ds-card px-4 py-3 font-mono text-[13px] leading-6 text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                      />
                    }
                  />
                  <SettingRow
                    title={t('skillsActions')}
                    description={t('skillsActionsDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openPlugins()}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
                          >
                            <Settings className="h-4 w-4" />
                            {t('skillsOpenPlugins')}
                          </button>
                        </div>
                        {skillNotice ? <InlineNoticeView notice={skillNotice} /> : null}
                      </div>
                    }
                  />
                </SettingsCard>
              </div>

              <div ref={mcpSectionRef} className="mt-6">
                <SettingsCard title={t('mcp')}>
                  <SettingRow
                    title={t('mcpSearchEnabled')}
                    description={t('mcpSearchEnabledDesc')}
                    control={
                      <Toggle
                        checked={mcpSearch.enabled}
                        onChange={(v) => updateMcpSearch({ enabled: v })}
                      />
                    }
                  />
                  <div className="px-3 py-4">
                    <AdvancedSettingsDisclosure
                      title={t('mcpAdvanced')}
                      description={t('mcpAdvancedDesc')}
                    >
                      <div className="divide-y divide-ds-border-muted">
                  <SettingRow
                    title={t('mcpSearchMode')}
                    description={t('mcpSearchModeDesc')}
                    control={
                      <select
                        className={selectControlClass}
                        value={mcpSearch.mode}
                        disabled={!mcpSearch.enabled}
                        onChange={(e) => updateMcpSearch({ mode: e.target.value })}
                      >
                        <option value="auto">{t('mcpSearchModeAuto')}</option>
                        <option value="search">{t('mcpSearchModeSearch')}</option>
                        <option value="direct">{t('mcpSearchModeDirect')}</option>
                      </select>
                    }
                  />
                  <SettingRow
                    title={t('mcpSearchLimits')}
                    description={t('mcpSearchLimitsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-4">
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('mcpSearchAutoThreshold')}
                          <input
                            type="number"
                            min={1}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={mcpSearch.autoThresholdToolCount}
                            disabled={!mcpSearch.enabled}
                            onChange={(e) => updateMcpSearch({ autoThresholdToolCount: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('mcpSearchTopKDefault')}
                          <input
                            type="number"
                            min={1}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={mcpSearch.topKDefault}
                            disabled={!mcpSearch.enabled}
                            onChange={(e) => updateMcpSearch({ topKDefault: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('mcpSearchTopKMax')}
                          <input
                            type="number"
                            min={1}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={mcpSearch.topKMax}
                            disabled={!mcpSearch.enabled}
                            onChange={(e) => updateMcpSearch({ topKMax: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('mcpSearchMinScore')}
                          <input
                            type="number"
                            min={0}
                            max={1}
                            step={0.01}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={mcpSearch.minScore}
                            disabled={!mcpSearch.enabled}
                            onChange={(e) => updateMcpSearch({ minScore: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('mcpSearchDiagnostics')}
                    description={t('mcpSearchDiagnosticsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-2 text-[12.5px] text-ds-muted sm:grid-cols-3">
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('mcpSearchStatus')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.mcpSearch?.active ? t('mcpSearchActive') : t('mcpSearchInactive')}</span>
                        </div>
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('mcpSearchIndexed')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.mcpSearch?.indexedToolCount ?? runtimeInfo?.capabilities?.mcp?.search?.indexedToolCount ?? 0}</span>
                        </div>
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('mcpSearchAdvertised')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.mcpSearch?.advertisedToolCount ?? runtimeInfo?.capabilities?.mcp?.search?.advertisedToolCount ?? 0}</span>
                        </div>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('mcpPermissionSources')}
                    description={t('mcpPermissionSourcesDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-2">
                        <div className="grid gap-2 text-[12.5px] text-ds-muted sm:grid-cols-4">
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionEnabledServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.enabledServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionDisabledServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.disabledServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionUserServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.userScopeServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionWorkspaceServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.workspaceScopeServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionVisibleServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.workspaceVisibleServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionLocalServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.localServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionRemoteServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.remoteServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionEnvServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.envServers}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('mcpPermissionHeaderServers')}: <span className="font-mono text-ds-ink">{mcpPermissionSummary.headerServers}</span>
                          </div>
                        </div>
                        {mcpPermissionSummary.parseError ? (
                          <div className="rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-[12px] leading-5 text-red-700 dark:text-red-200">
                            {t('mcpPermissionParseError')}
                          </div>
                        ) : (
                          <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-amber-700 dark:text-amber-200">
                            {t('mcpPermissionRuntimeNote')}
                          </div>
                        )}
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('configFilePath')}
                    description={t('mcpPathDesc')}
                    control={
                      <div className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-muted shadow-sm">
                        <code className="block break-all rounded-lg bg-ds-main/70 px-2 py-1 font-mono text-[12px] text-ds-ink">
                          {compactHomePath(mcpConfigPath)}
                        </code>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('mcpEditor')}
                    description={t('mcpEditorDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-3">
                        <div className="rounded-xl border border-ds-border bg-ds-main/50 px-3 py-2 text-[12px] leading-5 text-ds-muted">
                          {mcpConfigExists ? t('mcpFileStatusReady') : t('mcpFileStatusMissing')}
                        </div>
                        <McpServersEditor
                          value={mcpConfigText}
                          onChange={setMcpConfigText}
                          disabled={mcpLoading}
                          rawMode={mcpRawMode}
                          onToggleRawMode={setMcpRawMode}
                          loadingPlaceholder={mcpLoading ? t('loading') : ''}
                        />
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('mcpActions')}
                    description={t('mcpRuntimeHint')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void saveMcpConfig()}
                            disabled={mcpBusy || mcpLoading}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            {mcpBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                            ) : null}
                            {t('mcpSave')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void loadMcpConfig()}
                            disabled={mcpBusy || mcpLoading}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${mcpLoading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
                            {t('mcpReload')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void openMcpConfigDir()}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                          >
                            <FolderOpen className="h-4 w-4" />
                            {t('mcpOpenDir')}
                          </button>
                        </div>
                        {mcpNotice ? <InlineNoticeView notice={mcpNotice} /> : null}
                      </div>
                    }
                  />
                      </div>
                    </AdvancedSettingsDisclosure>
                  </div>
                </SettingsCard>
              </div>


              <div className="mt-6">
                <SettingsCard title={t('kunAdvanced')}>
                  <div className="px-3 py-4">
                    <AdvancedSettingsDisclosure
                      title={t('kunAdvancedDetails')}
                      description={t('kunAdvancedDetailsDesc')}
                    >
                      <div className="divide-y divide-ds-border-muted">
                  <SettingRow
                    title={t('kunTokenEconomyOptions')}
                    description={t('kunTokenEconomyOptionsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted">
                          <span>{t('kunCompressToolDescriptions')}</span>
                          <Toggle
                            checked={tokenEconomy.compressToolDescriptions}
                            disabled={!tokenEconomy.enabled}
                            onChange={(compressToolDescriptions) =>
                              updateTokenEconomy({ compressToolDescriptions })}
                          />
                        </label>
                        <label className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted">
                          <span>{t('kunCompressToolResults')}</span>
                          <Toggle
                            checked={tokenEconomy.compressToolResults}
                            disabled={!tokenEconomy.enabled}
                            onChange={(compressToolResults) =>
                              updateTokenEconomy({ compressToolResults })}
                          />
                        </label>
                        <label className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted">
                          <span>{t('kunConciseResponses')}</span>
                          <Toggle
                            checked={tokenEconomy.conciseResponses}
                            disabled={!tokenEconomy.enabled}
                            onChange={(conciseResponses) =>
                              updateTokenEconomy({ conciseResponses })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('kunHistoryHygiene')}
                    description={t('kunHistoryHygieneDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunHistoryMaxResultLines')}
                          <input
                            type="number"
                            min={1}
                            max={100000}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxToolResultLines}
                            onChange={(e) => updateHistoryHygiene({ maxToolResultLines: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunHistoryMaxResultBytes')}
                          <input
                            type="number"
                            min={512}
                            max={8388608}
                            step={1024}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxToolResultBytes}
                            onChange={(e) => updateHistoryHygiene({ maxToolResultBytes: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunHistoryMaxResultTokens')}
                          <input
                            type="number"
                            min={128}
                            max={256000}
                            step={128}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxToolResultTokens}
                            onChange={(e) => updateHistoryHygiene({ maxToolResultTokens: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunHistoryMaxArgumentBytes')}
                          <input
                            type="number"
                            min={512}
                            max={8388608}
                            step={1024}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxToolArgumentStringBytes}
                            onChange={(e) =>
                              updateHistoryHygiene({ maxToolArgumentStringBytes: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunHistoryMaxArgumentTokens')}
                          <input
                            type="number"
                            min={128}
                            max={64000}
                            step={128}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxToolArgumentStringTokens}
                            onChange={(e) =>
                              updateHistoryHygiene({ maxToolArgumentStringTokens: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunHistoryMaxArrayItems')}
                          <input
                            type="number"
                            min={1}
                            max={10000}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxArrayItems}
                            onChange={(e) => updateHistoryHygiene({ maxArrayItems: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('kunModelContextProfile')}
                    description={t('kunModelContextProfileDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-4">
                        <div className="min-w-0 rounded-xl border border-ds-border-muted bg-ds-card px-3 py-2">
                          <div className="text-[11px] font-medium uppercase text-ds-faint">
                            {t('kunModelContextModel')}
                          </div>
                          <div className="mt-1 truncate text-[13px] font-semibold text-ds-ink">
                            {modelContext.modelLabel}
                          </div>
                          <div className="mt-1 text-[11px] leading-4 text-ds-muted">
                            {t(modelContext.sourceLabelKey)}
                          </div>
                        </div>
                        <div className="min-w-0 rounded-xl border border-ds-border-muted bg-ds-card px-3 py-2">
                          <div className="text-[11px] font-medium uppercase text-ds-faint">
                            {t('kunModelContextWindow')}
                          </div>
                          <div className="mt-1 truncate text-[13px] font-semibold text-ds-ink">
                            {modelContext.contextWindowLabel}
                          </div>
                        </div>
                        <div className="min-w-0 rounded-xl border border-ds-border-muted bg-ds-card px-3 py-2">
                          <div className="text-[11px] font-medium uppercase text-ds-faint">
                            {t('kunModelContextSoft')}
                          </div>
                          <div className="mt-1 truncate text-[13px] font-semibold text-ds-ink">
                            {modelContext.softThresholdLabel}
                          </div>
                        </div>
                        <div className="min-w-0 rounded-xl border border-ds-border-muted bg-ds-card px-3 py-2">
                          <div className="text-[11px] font-medium uppercase text-ds-faint">
                            {t('kunModelContextHard')}
                          </div>
                          <div className="mt-1 truncate text-[13px] font-semibold text-ds-ink">
                            {modelContext.hardThresholdLabel}
                          </div>
                        </div>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('kunStorageBackend')}
                    description={t('kunStorageBackendDesc')}
                    control={
                      <select
                        className={selectControlClass}
                        value={storage.backend}
                        onChange={(e) => updateStorage({ backend: e.target.value })}
                      >
                        <option value="hybrid">{t('kunStorageHybrid')}</option>
                        <option value="file">{t('kunStorageFile')}</option>
                      </select>
                    }
                  />
                  <SettingRow
                    title={t('kunStorageSqlitePath')}
                    description={t('kunStorageSqlitePathDesc')}
                    control={
                      <input
                        className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                        value={compactHomePath(storage.sqlitePath)}
                        disabled={storage.backend !== 'hybrid'}
                        placeholder={t('kunStorageSqlitePathPlaceholder')}
                        onChange={(e) => updateStorage({ sqlitePath: expandHomePath(e.target.value) })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('kunCompactionThresholds')}
                    description={t('kunCompactionThresholdsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunCompactionSoftThreshold')}
                          <input
                            type="number"
                            min={1024}
                            step={1024}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={contextCompaction.defaultSoftThreshold}
                            onChange={(e) => updateContextCompaction({ defaultSoftThreshold: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunCompactionHardThreshold')}
                          <input
                            type="number"
                            min={1024}
                            step={1024}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={contextCompaction.defaultHardThreshold}
                            onChange={(e) => updateContextCompaction({ defaultHardThreshold: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('kunCompactionSummary')}
                    description={t('kunCompactionSummaryDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunCompactionSummaryTimeout')}
                          <input
                            type="number"
                            min={1000}
                            max={120000}
                            step={1000}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={contextCompaction.summaryTimeoutMs}
                            onChange={(e) => updateContextCompaction({ summaryTimeoutMs: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunCompactionSummaryMaxTokens')}
                          <input
                            type="number"
                            min={64}
                            max={16000}
                            step={64}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={contextCompaction.summaryMaxTokens}
                            onChange={(e) => updateContextCompaction({ summaryMaxTokens: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunCompactionSummaryInputBytes')}
                          <input
                            type="number"
                            min={1024}
                            max={8388608}
                            step={1024}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={contextCompaction.summaryInputMaxBytes}
                            onChange={(e) => updateContextCompaction({ summaryInputMaxBytes: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('kunStreamIdleTimeout')}
                    description={t('kunStreamIdleTimeoutDesc')}
                    control={
                      <input
                        type="number"
                        min={0}
                        max={3600000}
                        step={1000}
                        className="w-40 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                        value={runtimeTuning.streamIdleTimeoutMs}
                        onChange={(e) =>
                          updateRuntimeTuning({ streamIdleTimeoutMs: Number(e.target.value) })
                        }
                      />
                    }
                  />
                  <SettingRow
                    title={t('kunToolStorm')}
                    description={t('kunToolStormDesc')}
                    control={
                      <Toggle
                        checked={runtimeTuning.toolStorm.enabled}
                        onChange={(enabled) => updateToolStorm({ enabled })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('kunToolStormLimits')}
                    description={t('kunToolStormLimitsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunToolStormWindowSize')}
                          <input
                            type="number"
                            min={1}
                            max={128}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={runtimeTuning.toolStorm.windowSize}
                            disabled={!runtimeTuning.toolStorm.enabled}
                            onChange={(e) => updateToolStorm({ windowSize: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunToolStormThreshold')}
                          <input
                            type="number"
                            min={2}
                            max={128}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={runtimeTuning.toolStorm.threshold}
                            disabled={!runtimeTuning.toolStorm.enabled}
                            onChange={(e) => updateToolStorm({ threshold: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('kunToolArgumentRepair')}
                    description={t('kunToolArgumentRepairDesc')}
                    control={
                      <input
                        type="number"
                        min={1024}
                        max={16777216}
                        step={1024}
                        className="w-40 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                        value={runtimeTuning.toolArgumentRepair.maxStringBytes}
                        onChange={(e) => updateToolArgumentRepair({ maxStringBytes: Number(e.target.value) })}
                      />
                    }
                  />
                      </div>
                    </AdvancedSettingsDisclosure>
                  </div>
                </SettingsCard>
              </div>

              <div className="mt-6">
                <SettingsCard title={t('kunDiagnostics')}>
                  <div className="px-3 py-4">
                    <AdvancedSettingsDisclosure
                      title={t('kunDiagnosticsAdvanced')}
                      description={t('kunDiagnosticsAdvancedDesc')}
                    >
                      <div className="divide-y divide-ds-border-muted">
                  <SettingRow
                    title={t('kunRuntimeCapabilities')}
                    description={t('kunRuntimeCapabilitiesDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-3">
                        <div className="flex flex-wrap gap-2">
                          {[
                            ['MCP', runtimeInfo?.capabilities?.mcp?.status],
                            ['Web', runtimeInfo?.capabilities?.web?.status],
                            ['Skills', runtimeInfo?.capabilities?.skills?.status],
                            ['Subagents', runtimeInfo?.capabilities?.subagents?.status],
                            ['Images', runtimeInfo?.capabilities?.attachments?.status],
                            ['Memory', runtimeInfo?.capabilities?.memory?.status]
                          ].map(([label, status]) => (
                            <span
                              key={label}
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${statusPill(status as string | undefined)}`}
                            >
                              {label}
                              <span className="font-mono text-[11px] opacity-75">{status || 'unknown'}</span>
                            </span>
                          ))}
                        </div>
                        <div className="grid gap-2 text-[12.5px] text-ds-muted sm:grid-cols-2">
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('kunRuntimeModel')}: <span className="font-mono text-ds-ink">{runtimeInfo?.capabilities?.model?.id ?? 'unknown'}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('kunRuntimePid')}: <span className="font-mono text-ds-ink">{runtimeInfo?.pid ?? 'unknown'}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            MCP: <span className="font-mono text-ds-ink">{runtimeInfo?.capabilities?.mcp?.connectedServers ?? 0}/{runtimeInfo?.capabilities?.mcp?.configuredServers ?? 0}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            Web: <span className="font-mono text-ds-ink">{runtimeInfo?.capabilities?.web?.provider ?? 'none'}</span>
                          </div>
                          {runtimeInfo?.capabilities?.subagents?.enabled ? (
                            <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                              Subagents: <span className="font-mono text-ds-ink">
                                {runtimeInfo?.capabilities?.subagents?.maxParallel ?? 0}∥ · {runtimeInfo?.capabilities?.subagents?.maxChildRuns ?? 0} max
                                {runtimeInfo?.capabilities?.subagents?.defaultToolPolicy ? ` · ${runtimeInfo.capabilities.subagents.defaultToolPolicy}` : ''}
                                {runtimeInfo?.capabilities?.subagents?.profiles?.length ? ` · ${runtimeInfo.capabilities.subagents.profiles.length} profile(s)` : ''}
                              </span>
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void refreshKunDiagnostics()}
                            disabled={runtimeDiagnosticsBusy}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${runtimeDiagnosticsBusy ? 'animate-spin' : ''}`} strokeWidth={1.75} />
                            {t('kunDiagnosticsRefresh')}
                          </button>
                          {runtimeDiagnosticsNotice ? <InlineNoticeView notice={runtimeDiagnosticsNotice} /> : null}
                        </div>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('kunToolDiagnostics')}
                    description={t('kunToolDiagnosticsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-2 text-[12.5px] text-ds-muted sm:grid-cols-2">
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('kunDiagnosticsProviders')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.providers?.length ?? 0}</span>
                        </div>
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('kunDiagnosticsMcpServers')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.mcpServers?.length ?? 0}</span>
                        </div>
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('kunDiagnosticsSkills')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.skills?.skills?.length ?? 0}</span>
                        </div>
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('kunDiagnosticsAttachments')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.attachments?.count ?? 0}</span>
                        </div>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('kunMemoryRecords')}
                    description={t('kunMemoryRecordsDesc')}
                    wideControl
                    control={
                      <div className="flex flex-col gap-2">
                        {memoryRecords.length === 0 ? (
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-3 text-[13px] text-ds-faint">
                            {t('kunMemoryEmpty')}
                          </div>
                        ) : (
                          memoryRecords.slice(0, 8).map((memory: any) => (
                            <div key={memory.id} className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                              <div className="flex min-w-0 items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-[13px] font-semibold text-ds-ink">{memory.content}</div>
                                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-ds-faint">
                                    <span className="font-mono">{memory.scope}</span>
                                    <span className="font-mono">{memory.id}</span>
                                    {memory.disabledAt ? <span>{t('kunMemoryDisabled')}</span> : null}
                                    {memory.tags?.length ? <span>{compactList(memory.tags, '')}</span> : null}
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={Boolean(memory.disabledAt)}
                                    onClick={() => void disableMemoryRecord(memory.id)}
                                    className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45"
                                    aria-label={t('kunMemoryDisable')}
                                    title={t('kunMemoryDisable')}
                                  >
                                    <Ban className="h-3.5 w-3.5" strokeWidth={1.8} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void deleteMemoryRecord(memory.id)}
                                    className="rounded-lg p-1.5 text-ds-muted transition hover:bg-red-500/10 hover:text-red-600"
                                    aria-label={t('kunMemoryDelete')}
                                    title={t('kunMemoryDelete')}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    }
                  />
                      </div>
                    </AdvancedSettingsDisclosure>
                  </div>
                </SettingsCard>
              </div>
            </>
  )
}

function permissionBadgeClass(state: ComputerUsePermissionState): string {
  if (state === 'granted') {
    return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  }
  if (state === 'denied') {
    return 'border-rose-400/25 bg-rose-500/10 text-rose-700 dark:text-rose-200'
  }
  return 'border-ds-border-muted bg-ds-card text-ds-faint'
}

function ComputerUsePermissionRow({ t }: { t: (key: string) => string }): ReactElement | null {
  const [permissions, setPermissions] = useState<ComputerUsePermissions | null>(null)

  const refresh = (): void => {
    void window.kunGui?.getComputerUsePermissions?.().then(setPermissions).catch(() => undefined)
  }
  useEffect(() => {
    refresh()
  }, [])

  // Non-macOS hosts have no OS permission gate; nothing useful to show.
  if (permissions && !permissions.needsPermission) return null

  const request = (kind: ComputerUsePermissionKind): void => {
    void window.kunGui
      ?.requestComputerUsePermission?.(kind)
      .then(setPermissions)
      .catch(() => undefined)
  }

  const badge = (label: string, state: ComputerUsePermissionState): ReactNode => (
    <span className={`rounded-lg border px-2 py-0.5 text-[12px] font-medium ${permissionBadgeClass(state)}`}>
      {label}: {t(`computerUsePermission_${state}`)}
    </span>
  )

  return (
    <SettingRow
      title={t('computerUsePermissions')}
      description={t('computerUsePermissionsDesc')}
      control={
        <div className="flex min-w-0 flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap gap-2">
            {permissions?.accessibilityNeedsRestart ? (
              <span className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[12px] font-medium text-amber-700 dark:text-amber-200">
                {t('computerUseAccessibility')}: {t('computerUsePermissionNeedsRestart')}
              </span>
            ) : (
              badge(t('computerUseAccessibility'), permissions?.accessibility ?? 'unknown')
            )}
            {badge(t('computerUseScreenRecording'), permissions?.screenRecording ?? 'unknown')}
          </div>
          {permissions?.accessibilityNeedsRestart ? (
            <p className="max-w-full text-[12px] leading-5 text-amber-700 dark:text-amber-200">
              {t('computerUseRestartHint')}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-ds-border-muted bg-ds-card px-2.5 py-1 text-[12px] font-medium text-ds-text hover:bg-ds-card-hover"
              onClick={() => request('accessibility')}
            >
              {t('computerUseGrantAccessibility')}
            </button>
            <button
              type="button"
              className="rounded-lg border border-ds-border-muted bg-ds-card px-2.5 py-1 text-[12px] font-medium text-ds-text hover:bg-ds-card-hover"
              onClick={() => request('screenRecording')}
            >
              {t('computerUseGrantScreenRecording')}
            </button>
            <button
              type="button"
              className="rounded-lg border border-ds-border-muted bg-ds-card px-2.5 py-1 text-[12px] font-medium text-ds-text hover:bg-ds-card-hover"
              onClick={refresh}
            >
              {t('computerUseRecheck')}
            </button>
          </div>
        </div>
      }
    />
  )
}
