import {
  DEFAULT_CHECKPOINT_CLEANUP_INTERVAL_DAYS,
  DEFAULT_LOG_RETENTION_DAYS,
  DEFAULT_GUI_UPDATE_CHANNEL,
  MIN_KUN_LOCAL_PORT,
  defaultKunRuntimeSettings,
  applyKunRuntimePatch,
  getKunRuntimeSettings,
  kunSettingsEnvelope,
  mergeKunRuntimeSettings,
  mergeAppBehaviorSettings,
  mergeClawSettings,
  mergeDesignSettings,
  mergeModelProviderSettings,
  mergeScheduleSettings,
  mergeWorkflowSettings,
  mergeWriteSettings,
  mergeTerminalSettings,
  normalizeAppBehaviorSettings,
  normalizeClawSettings,
  normalizeDesignSettings,
  normalizeCheckpointCleanupSettings,
  normalizeCursorSpotlightColor,
  normalizeGuiUpdateChannel,
  normalizeKeyboardShortcuts,
  normalizeModelProviderSettings,
  normalizeScheduleSettings,
  normalizeWorkflowSettings,
  normalizeWriteSettings,
  normalizeTerminalSettings,
  normalizeChatContentMaxWidth,
  normalizeUiFontScale,
  type AppSettingsPatch,
  type AppSettingsV1
} from '@shared/app-settings'
import type { GuiUpdateInfo } from '@shared/gui-update'

type RendererSettingsShape = AppSettingsPatch
type SettingsPatch = AppSettingsPatch

export const DEFAULT_WORKSPACE_ROOT = '~/.kun/default_workspace'

export function splitSettingsList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function listSettingsText(values: string[]): string {
  return values.join('\n')
}

export function hasValidPort(settings: AppSettingsV1): boolean {
  const port = getKunRuntimeSettings(settings).port
  return Number.isFinite(port) && port >= MIN_KUN_LOCAL_PORT && port <= 65535
}

export function mergeSettings(current: AppSettingsV1, patch: SettingsPatch): AppSettingsV1 {
  const safeCurrent = coerceRendererSettings(current)
  const { agents: agentsPatch, provider: providerPatch, ...restPatch } = patch
  return {
    ...applyKunRuntimePatch(safeCurrent, agentsPatch?.kun),
    ...restPatch,
    provider: mergeModelProviderSettings(safeCurrent.provider, providerPatch),
    log: {
      ...safeCurrent.log,
      ...(patch.log ?? {})
    },
    checkpointCleanup: normalizeCheckpointCleanupSettings({
      ...safeCurrent.checkpointCleanup,
      ...(patch.checkpointCleanup ?? {})
    }),
    notifications: {
      ...safeCurrent.notifications,
      ...(patch.notifications ?? {})
    },
    appBehavior: mergeAppBehaviorSettings(safeCurrent.appBehavior, patch.appBehavior),
    keyboardShortcuts: normalizeKeyboardShortcuts({
      bindings: {
        ...safeCurrent.keyboardShortcuts.bindings,
        ...(patch.keyboardShortcuts?.bindings ?? {})
      }
    }),
    write: mergeWriteSettings(safeCurrent.write, patch.write),
    claw: mergeClawSettings(safeCurrent.claw, patch.claw),
    schedule: mergeScheduleSettings(safeCurrent.schedule, patch.schedule),
    workflow: mergeWorkflowSettings(safeCurrent.workflow, patch.workflow),
    design: mergeDesignSettings(safeCurrent.design, patch.design),
    terminal: mergeTerminalSettings(safeCurrent.terminal, patch.terminal),
    guiUpdate: {
      ...safeCurrent.guiUpdate,
      ...(patch.guiUpdate ?? {})
    }
  }
}

export function coerceRendererSettings(settings: AppSettingsV1): AppSettingsV1 {
  const raw = settings as RendererSettingsShape
  const theme =
    raw.theme === 'system' || raw.theme === 'light' || raw.theme === 'dark'
      ? raw.theme
      : 'system'
  const uiFontScale = normalizeUiFontScale(raw.uiFontScale)
  const chatContentMaxWidthPx = normalizeChatContentMaxWidth(raw.chatContentMaxWidthPx)
  return {
    version: 1,
    locale: raw.locale === 'zh' ? 'zh' : 'en',
    theme,
    uiFontScale,
    chatContentMaxWidthPx,
    cursorSpotlight: raw.cursorSpotlight !== false,
    cursorSpotlightColor: normalizeCursorSpotlightColor(raw.cursorSpotlightColor),
    provider: normalizeModelProviderSettings(raw.provider),
    agents: kunSettingsEnvelope(mergeKunRuntimeSettings(defaultKunRuntimeSettings(), getKunRuntimeSettings(settings))),
    workspaceRoot: typeof raw.workspaceRoot === 'string' ? raw.workspaceRoot : DEFAULT_WORKSPACE_ROOT,
    conversationWorkspaceRoot:
      typeof raw.conversationWorkspaceRoot === 'string' ? raw.conversationWorkspaceRoot : '',
    log: {
      enabled: raw.log?.enabled !== false,
      retentionDays: typeof raw.log?.retentionDays === 'number'
        ? raw.log.retentionDays
        : DEFAULT_LOG_RETENTION_DAYS
    },
    checkpointCleanup: normalizeCheckpointCleanupSettings(
      raw.checkpointCleanup ?? { intervalDays: DEFAULT_CHECKPOINT_CLEANUP_INTERVAL_DAYS }
    ),
    notifications: {
      turnComplete: raw.notifications?.turnComplete !== false
    },
    appBehavior: normalizeAppBehaviorSettings(raw.appBehavior),
    keyboardShortcuts: normalizeKeyboardShortcuts(raw.keyboardShortcuts),
    write: normalizeWriteSettings(raw.write),
    claw: normalizeClawSettings(raw.claw),
    schedule: normalizeScheduleSettings(raw.schedule),
    workflow: normalizeWorkflowSettings(raw.workflow),
    design: normalizeDesignSettings(raw.design),
    terminal: normalizeTerminalSettings(raw.terminal),
    guiUpdate: {
      channel: normalizeGuiUpdateChannel(raw.guiUpdate?.channel ?? DEFAULT_GUI_UPDATE_CHANNEL)
    },
    codePromptPrefix: typeof raw.codePromptPrefix === 'string' ? raw.codePromptPrefix : '',
    disabledSkillIds: normalizeDisabledSkillIds(raw.disabledSkillIds)
  }
}

function normalizeDisabledSkillIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.trim().replace(/^\/?skill:/i, '').trim())
    .filter(Boolean))]
}

export function guiUpdateFailureMessage(
  info: Extract<GuiUpdateInfo, { ok: false }>,
  t: (key: string, values?: Record<string, unknown>) => string
): string {
  switch (info.code) {
    case 'not_configured':
      return t('guiUpdateErrNotConfigured')
    case 'unsupported':
      return t('guiUpdateErrUnsupported')
    case 'download_failed':
      return t('guiUpdateErrDownloadFailed', { message: info.message.trim() })
    case 'install_failed':
      return t('guiUpdateErrInstallFailed', { message: info.message.trim() })
    case 'github_repo_not_found':
      return t('guiUpdateErrRepoNotFound', { repo: info.repo?.trim() || 'owner/repo' })
    case 'github_forbidden':
      return t('guiUpdateErrForbidden')
    case 'github_rate_limited':
      return t('guiUpdateErrRateLimit')
    case 'no_stable_version':
      return t('guiUpdateErrNoStableVersion', { repo: info.repo?.trim() || '—' })
    default:
      return info.message.trim() || t('guiUpdateCheckFailed')
  }
}
