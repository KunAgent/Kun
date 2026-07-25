import {
  DEFAULT_GUI_UPDATE_CHANNEL,
  CHECKPOINT_CLEANUP_INTERVAL_DAYS,
  DEFAULT_CHECKPOINT_CLEANUP_ENABLED,
  DEFAULT_CHECKPOINT_CLEANUP_INTERVAL_DAYS,
  DEFAULT_GIT_CHECKPOINT_CREATE_ENABLED,
  DEFAULT_CURSOR_SPOTLIGHT_COLOR,
  DEFAULT_GIT_BRANCH_PREFIX,
  DEFAULT_LOG_RETENTION_DAYS,
  normalizeGuiUpdateChannel,
  normalizeChatContentMaxWidth,
  normalizeComposerSendKey,
  normalizeUiFontScale,
  type AppBehaviorConfigV1,
  type AppSettingsV1,
  type CheckpointCleanupConfigV1,
  type CheckpointCleanupIntervalDays,
  type ClawSettingsPatchV1,
  type DesignSettingsPatchV1,
  type GuiUpdateConfigV1,
  type KunRuntimeSettingsV1,
  type ModelProviderProfileV1,
  type NotificationConfigV1,
  type ScheduleSettingsPatchV1,
  WINDOW_CLOSE_ACTIONS,
  type WindowCloseAction,
  type WorkflowSettingsPatchV1,
  type WriteSettingsPatchV1
} from './app-settings-types'
import { isAppLocale } from './app-locales'
import { normalizeKeyboardShortcuts, type KeyboardShortcutsConfigV1 } from './keyboard-shortcuts'
import {
  defaultKunRuntimeSettings,
  getKunRuntimeSettings,
  kunSettingsEnvelope,
  mergeKunRuntimeSettings,
  migrateKunContextCompactionDefaults,
  migrateLegacyAppSettings
} from './app-settings-kun'
import {
  activeModelProviderNeedsApiKey,
  defaultMiniMaxMediaGenerationKunPatch,
  normalizeModelProviderSettings
} from './app-settings-provider'
import { normalizeDeepseekBaseUrl } from './app-settings-normalizers'
import { normalizeClawSettings } from './app-settings-claw'
import { normalizeScheduleSettings } from './app-settings-schedule'
import { normalizeWorkflowSettings } from './app-settings-workflow'
import { normalizeWriteSettings } from './app-settings-write'
import { normalizeDesignSettings } from './app-settings-design'
import { normalizeTerminalSettings, type TerminalSettingsPatchV1 } from './app-settings-terminal'

export function normalizeAppSettings(settings: AppSettingsV1): AppSettingsV1 {
  const migrated = shouldMigrateLegacySettings(settings)
    ? migrateLegacyAppSettings(settings as Parameters<typeof migrateLegacyAppSettings>[0])
    : settings
  const maybeSettings = migrated as AppSettingsV1 & {
    appBehavior?: Partial<AppBehaviorConfigV1>
    keyboardShortcuts?: Partial<KeyboardShortcutsConfigV1>
    notifications?: Partial<NotificationConfigV1>
    provider?: Parameters<typeof normalizeModelProviderSettings>[0]
    checkpointCleanup?: Partial<CheckpointCleanupConfigV1>
    write?: WriteSettingsPatchV1
    claw?: ClawSettingsPatchV1
    schedule?: ScheduleSettingsPatchV1
    workflow?: WorkflowSettingsPatchV1
    design?: DesignSettingsPatchV1
    guiUpdate?: Partial<GuiUpdateConfigV1>
    terminal?: TerminalSettingsPatchV1
  }
  const providerSettings = normalizeModelProviderSettings(maybeSettings.provider)
  const rawKun = maybeSettings.agents?.kun
  const runtime = normalizeRuntimeModelProviderSelection(
    getKunRuntimeSettings(maybeSettings),
    providerSettings.providers,
    typeof rawKun?.model === 'string' && Boolean(rawKun.model.trim())
  )
  const contextCompaction = migrateKunContextCompactionDefaults(
    rawKun?.contextCompaction ?? runtime.contextCompaction
  )
  const rawMediaPatch: Parameters<typeof defaultMiniMaxMediaGenerationKunPatch>[0]['kunPatch'] = {
    ...(rawKun?.textToSpeech !== undefined ? { textToSpeech: rawKun.textToSpeech } : {}),
    ...(rawKun?.musicGeneration !== undefined ? { musicGeneration: rawKun.musicGeneration } : {}),
    ...(rawKun?.videoGeneration !== undefined ? { videoGeneration: rawKun.videoGeneration } : {})
  }
  const miniMaxMediaDefaults = defaultMiniMaxMediaGenerationKunPatch({
    providers: providerSettings.providers,
    currentKun: runtime,
    kunPatch: rawMediaPatch
  })
  // Before this field existed, having an active API key was the onboarding
  // completion signal. Keyless subscription/CLI providers are also complete
  // configurations, so use the same active-provider policy as the setup UI.
  const setupMigrationSettings = {
    ...maybeSettings,
    provider: providerSettings,
    agents: kunSettingsEnvelope(runtime)
  } as AppSettingsV1
  const initialSetupCompleted = typeof maybeSettings.initialSetupCompleted === 'boolean'
    ? maybeSettings.initialSetupCompleted
    : !activeModelProviderNeedsApiKey(setupMigrationSettings)
  return {
    version: 1,
    initialSetupCompleted,
    locale: isAppLocale(maybeSettings.locale) ? maybeSettings.locale : 'en',
    theme:
      maybeSettings.theme === 'light' || maybeSettings.theme === 'dark' || maybeSettings.theme === 'system'
        ? maybeSettings.theme
        : 'system',
    uiFontScale: normalizeUiFontScale(maybeSettings.uiFontScale),
    chatContentMaxWidthPx: normalizeChatContentMaxWidth(maybeSettings.chatContentMaxWidthPx),
    composerSendKey: normalizeComposerSendKey(maybeSettings.composerSendKey),
    cursorSpotlight: maybeSettings.cursorSpotlight !== false,
    cursorSpotlightColor: normalizeCursorSpotlightColor(maybeSettings.cursorSpotlightColor),
    provider: providerSettings,
    agents: kunSettingsEnvelope(mergeKunRuntimeSettings(defaultKunRuntimeSettings(), {
      ...runtime,
      contextCompaction,
      baseUrl: runtime.baseUrl.trim() ? normalizeDeepseekBaseUrl(runtime.baseUrl) : '',
      ...(miniMaxMediaDefaults ?? {})
    })),
    workspaceRoot: typeof maybeSettings.workspaceRoot === 'string' ? maybeSettings.workspaceRoot : '',
    conversationWorkspaceRoot:
      typeof maybeSettings.conversationWorkspaceRoot === 'string'
        ? maybeSettings.conversationWorkspaceRoot
        : '',
    log: {
      enabled: maybeSettings.log?.enabled !== false,
      retentionDays: typeof maybeSettings.log?.retentionDays === 'number'
        ? maybeSettings.log.retentionDays
        : DEFAULT_LOG_RETENTION_DAYS
    },
    checkpointCleanup: normalizeCheckpointCleanupSettings(maybeSettings.checkpointCleanup),
    gitBranchPrefix: normalizeGitBranchPrefix(maybeSettings.gitBranchPrefix),
    notifications: {
      turnComplete: maybeSettings.notifications?.turnComplete !== false
    },
    appBehavior: normalizeAppBehaviorSettings(maybeSettings.appBehavior),
    keyboardShortcuts: normalizeKeyboardShortcuts(maybeSettings.keyboardShortcuts),
    write: normalizeWriteSettings(maybeSettings.write),
    claw: normalizeClawSettings(maybeSettings.claw),
    schedule: normalizeScheduleSettings(maybeSettings.schedule),
    workflow: normalizeWorkflowSettings(maybeSettings.workflow),
    design: normalizeDesignSettings(maybeSettings.design),
    terminal: normalizeTerminalSettings(maybeSettings.terminal),
    guiUpdate: {
      channel: normalizeGuiUpdateChannel(
        maybeSettings.guiUpdate?.channel ?? DEFAULT_GUI_UPDATE_CHANNEL
      )
    },
    codePromptPrefix: typeof maybeSettings.codePromptPrefix === 'string' ? maybeSettings.codePromptPrefix : '',
    disabledSkillIds: normalizeDisabledSkillIds(maybeSettings.disabledSkillIds)
  }
}

function normalizeRuntimeModelProviderSelection(
  runtime: KunRuntimeSettingsV1,
  providers: readonly ModelProviderProfileV1[],
  preferModelOwner: boolean
): KunRuntimeSettingsV1 {
  if (providers.length === 0) return runtime
  const main = normalizeModelProviderPair(runtime.providerId, runtime.model, providers, preferModelOwner)
  const profiles = runtime.subagents?.profiles.map((profile) => {
    const model = profile.model?.trim() ?? ''
    const providerId = profile.providerId?.trim() ?? ''
    if (!model && !providerId) return profile
    const normalized = normalizeModelProviderPair(providerId, model, providers, Boolean(model))
    return {
      ...profile,
      model: normalized.model,
      providerId: normalized.providerId || providers[0].id
    }
  })
  return {
    ...runtime,
    ...main,
    ...(runtime.subagents && profiles
      ? { subagents: { ...runtime.subagents, profiles } }
      : {})
  }
}

function normalizeModelProviderPair(
  providerInput: string,
  modelInput: string,
  providers: readonly ModelProviderProfileV1[],
  preferModelOwner: boolean
): { providerId: string; model: string } {
  const providerId = providerInput.trim()
  const model = modelInput.trim()
  const selected = providerId
    ? providers.find((provider) => provider.id === providerId)
    : providers[0]
  if (selected && providerContainsModel(selected, model)) return { providerId, model }
  if (providerId && !selected) return { providerId, model }

  const matches = providers.filter((provider) => providerContainsModel(provider, model))
  if ((!providerId || preferModelOwner) && matches.length === 1) {
    return { providerId: matches[0].id, model }
  }

  const fallbackProvider = selected ?? providers[0]
  const fallbackModel = fallbackProvider.models.find((candidate) => candidate.trim())?.trim()
  if (!fallbackModel) return { providerId, model }
  return {
    providerId: providerId
      ? fallbackProvider.id
      : fallbackProvider === providers[0]
        ? ''
        : fallbackProvider.id,
    model: fallbackModel
  }
}

function providerContainsModel(provider: ModelProviderProfileV1, modelId: string): boolean {
  const model = modelId.trim().toLowerCase()
  if (!model) return false
  if (provider.models.some((candidate) => candidate.trim().toLowerCase() === model)) return true
  return Object.entries(provider.modelProfiles).some(([profileModel, profile]) =>
    profileModel.trim().toLowerCase() === model ||
    profile.aliases?.some((alias) => alias.trim().toLowerCase() === model) === true
  )
}

export function normalizeGitBranchPrefix(value: unknown): string {
  const normalized = typeof value === 'string'
    ? value.trim().replace(/\\/g, '/').replace(/^\/+/, '')
    : DEFAULT_GIT_BRANCH_PREFIX
  if (!normalized) return ''
  return normalized.endsWith('/') ? normalized : `${normalized}/`
}

export function applyGitBranchPrefix(branch: string, prefix: unknown): string {
  const normalizedBranch = branch.trim().replace(/^\/+/, '')
  const normalizedPrefix = normalizeGitBranchPrefix(prefix)
  if (!normalizedBranch || !normalizedPrefix || normalizedBranch.startsWith(normalizedPrefix)) {
    return normalizedBranch
  }
  return `${normalizedPrefix}${normalizedBranch}`
}

export function normalizeCheckpointCleanupIntervalDays(value: unknown): CheckpointCleanupIntervalDays {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_CHECKPOINT_CLEANUP_INTERVAL_DAYS
  if (parsed <= 1) return 1
  if (parsed <= 2) return 2
  if (parsed <= 3) return 3
  if (parsed <= 5) return 5
  return 10
}

export function normalizeCheckpointCleanupSettings(
  settings?: Partial<CheckpointCleanupConfigV1>
): CheckpointCleanupConfigV1 {
  const intervalDays = normalizeCheckpointCleanupIntervalDays(settings?.intervalDays)
  const directory = typeof settings?.directory === 'string' ? settings.directory.trim() : ''
  const maxPerThread = typeof settings?.maxPerThread === 'number' && Number.isFinite(settings.maxPerThread)
    ? Math.max(1, Math.min(100, Math.floor(settings.maxPerThread)))
    : undefined
  return {
    createEnabled:
      typeof settings?.createEnabled === 'boolean'
        ? settings.createEnabled
        : DEFAULT_GIT_CHECKPOINT_CREATE_ENABLED,
    enabled: typeof settings?.enabled === 'boolean' ? settings.enabled : DEFAULT_CHECKPOINT_CLEANUP_ENABLED,
    intervalDays: CHECKPOINT_CLEANUP_INTERVAL_DAYS.includes(intervalDays)
      ? intervalDays
      : DEFAULT_CHECKPOINT_CLEANUP_INTERVAL_DAYS,
    // Only include the optional storage overrides when explicitly set so
    // existing settings snapshots (which omit them) stay byte-for-byte equal.
    ...(directory ? { directory } : {}),
    ...(maxPerThread !== undefined ? { maxPerThread } : {})
  }
}

export function normalizeCursorSpotlightColor(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_CURSOR_SPOTLIGHT_COLOR
  const color = value.trim()
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : DEFAULT_CURSOR_SPOTLIGHT_COLOR
}

function normalizeDisabledSkillIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.trim().replace(/^\/?skill:/i, '').trim())
    .filter(Boolean))]
}

export function normalizeAppBehaviorSettings(
  settings?: Partial<AppBehaviorConfigV1>
): AppBehaviorConfigV1 {
  const openAtLogin = settings?.openAtLogin === true
  const closeAction = normalizeWindowCloseAction(settings?.closeAction)
    ?? (settings?.closeToTray === true ? 'tray' : 'ask')
  return {
    openAtLogin,
    startMinimized: openAtLogin && settings?.startMinimized === true,
    closeAction,
    closeToTray: closeAction === 'tray'
  }
}

export function normalizeWindowCloseAction(value: unknown): WindowCloseAction | null {
  return typeof value === 'string' && WINDOW_CLOSE_ACTIONS.includes(value as WindowCloseAction)
    ? value as WindowCloseAction
    : null
}

export function mergeAppBehaviorSettings(
  current: AppBehaviorConfigV1,
  patch?: Partial<AppBehaviorConfigV1>
): AppBehaviorConfigV1 {
  const translatedPatch: Partial<AppBehaviorConfigV1> | undefined =
    patch && patch.closeAction === undefined && patch.closeToTray !== undefined
      ? {
          ...patch,
          closeAction: patch.closeToTray ? 'tray' : 'quit'
        }
      : patch
  return normalizeAppBehaviorSettings({
    ...current,
    ...(translatedPatch ?? {})
  })
}

function shouldMigrateLegacySettings(settings: AppSettingsV1): boolean {
  const raw = settings as AppSettingsV1 & {
    agentProvider?: unknown
    deepseek?: unknown
    agents?: {
      kun?: Partial<ReturnType<typeof defaultKunRuntimeSettings>>
      codewhale?: unknown
      reasonix?: unknown
    }
  }
  if (!raw.agents?.kun) return true
  if ('agentProvider' in raw || 'deepseek' in raw) return true
  if (raw.agents.codewhale || raw.agents.reasonix) return true
  // Before credentials were centralized under provider profiles, otherwise
  // current-looking settings could already contain agents.kun but still keep
  // the API key/base URL in the legacy Runtime slots.
  if (
    (typeof raw.agents.kun.apiKey === 'string' && raw.agents.kun.apiKey.trim()) ||
    (typeof raw.agents.kun.baseUrl === 'string' && raw.agents.kun.baseUrl.trim())
  ) return true
  const dataDir = typeof raw.agents.kun.dataDir === 'string'
    ? raw.agents.kun.dataDir.replace(/\\/g, '/').toLowerCase()
    : ''
  return dataDir === '~/.deepseekgui/coreagent' || dataDir.endsWith('/.deepseekgui/coreagent')
}
