import {
  DEFAULT_GUI_UPDATE_CHANNEL,
  CHECKPOINT_CLEANUP_INTERVAL_DAYS,
  DEFAULT_CHECKPOINT_CLEANUP_ENABLED,
  DEFAULT_CHECKPOINT_CLEANUP_INTERVAL_DAYS,
  DEFAULT_CURSOR_SPOTLIGHT_COLOR,
  DEFAULT_LOG_RETENTION_DAYS,
  normalizeGuiUpdateChannel,
  normalizeChatContentMaxWidth,
  normalizeUiFontScale,
  type AppBehaviorConfigV1,
  type AppSettingsV1,
  type CheckpointCleanupConfigV1,
  type CheckpointCleanupIntervalDays,
  type ClawSettingsPatchV1,
  type DesignSettingsPatchV1,
  type GuiUpdateConfigV1,
  type NotificationConfigV1,
  type ScheduleSettingsPatchV1,
  WINDOW_CLOSE_ACTIONS,
  type WindowCloseAction,
  type WorkflowSettingsPatchV1,
  type WriteSettingsPatchV1
} from './app-settings-types'
import { normalizeKeyboardShortcuts, type KeyboardShortcutsConfigV1 } from './keyboard-shortcuts'
import {
  defaultKunRuntimeSettings,
  getKunRuntimeSettings,
  kunSettingsEnvelope,
  mergeKunRuntimeSettings,
  migrateLegacyAppSettings
} from './app-settings-kun'
import {
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
  const runtime = getKunRuntimeSettings(maybeSettings)
  const rawKun = maybeSettings.agents?.kun
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
  return {
    ...migrated,
    version: 1,
    locale: maybeSettings.locale === 'zh' ? 'zh' : 'en',
    theme:
      maybeSettings.theme === 'light' || maybeSettings.theme === 'dark' || maybeSettings.theme === 'system'
        ? maybeSettings.theme
        : 'system',
    uiFontScale: normalizeUiFontScale(maybeSettings.uiFontScale),
    chatContentMaxWidthPx: normalizeChatContentMaxWidth(maybeSettings.chatContentMaxWidthPx),
    cursorSpotlight: maybeSettings.cursorSpotlight !== false,
    cursorSpotlightColor: normalizeCursorSpotlightColor(maybeSettings.cursorSpotlightColor),
    provider: providerSettings,
    agents: kunSettingsEnvelope(mergeKunRuntimeSettings(defaultKunRuntimeSettings(), {
      ...runtime,
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
  return {
    enabled: typeof settings?.enabled === 'boolean' ? settings.enabled : DEFAULT_CHECKPOINT_CLEANUP_ENABLED,
    intervalDays: CHECKPOINT_CLEANUP_INTERVAL_DAYS.includes(intervalDays)
      ? intervalDays
      : DEFAULT_CHECKPOINT_CLEANUP_INTERVAL_DAYS
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
  const dataDir = typeof raw.agents.kun.dataDir === 'string'
    ? raw.agents.kun.dataDir.replace(/\\/g, '/').toLowerCase()
    : ''
  return dataDir === '~/.deepseekgui/coreagent' || dataDir.endsWith('/.deepseekgui/coreagent')
}
