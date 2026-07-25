import {
  isAppLocale,
  DEFAULT_CHECKPOINT_CLEANUP_INTERVAL_DAYS,
  DEFAULT_LOG_RETENTION_DAYS,
  DEFAULT_GUI_UPDATE_CHANNEL,
  DEFAULT_GIT_BRANCH_PREFIX,
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
  normalizeGitBranchPrefix,
  normalizeKeyboardShortcuts,
  normalizeModelProviderSettings,
  normalizeScheduleSettings,
  normalizeWorkflowSettings,
  normalizeWriteSettings,
  normalizeTerminalSettings,
  normalizeChatContentMaxWidth,
  normalizeComposerSendKey,
  normalizeUiFontScale,
  type AppSettingsPatch,
  type AppSettingsV1
} from '@shared/app-settings'
import type { GuiUpdateInfo } from '@shared/gui-update'

type RendererSettingsShape = AppSettingsPatch
type SettingsPatch = AppSettingsPatch
const SETTINGS_DIFF_NO_CHANGE = Symbol('settings-diff-no-change')

// Optional model/reasoning slots are normalized out of the in-memory snapshot
// when the user selects "follow default" / "off". A structural diff cannot
// express that deletion by omission, because omission means "leave unchanged"
// to the main-process patch merger. Emit the same explicit clear values the
// settings controls use so persisted overrides are actually removed.
const SETTINGS_CLEAR_SENTINELS: Readonly<Record<string, string>> = {
  'agents.kun.smallModel': '',
  'agents.kun.smallModelProviderId': '',
  'agents.kun.titleModel': '',
  'agents.kun.titleProviderId': '',
  'agents.kun.summaryModel': '',
  'agents.kun.summaryProviderId': '',
  'agents.kun.codeReviewModel': '',
  'agents.kun.codeReviewProviderId': '',
  'agents.kun.titleReasoningEffort': 'off',
  'agents.kun.summaryReasoningEffort': 'off',
  'agents.kun.codeReviewReasoningEffort': 'off',
  'agents.kun.contextCompaction.summaryModel': '',
  'agents.kun.contextCompaction.summaryProviderId': ''
}

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

export function diffSettingsPatch(base: AppSettingsV1, next: AppSettingsV1): AppSettingsPatch {
  const diff = diffSettingsValue(base, next, [])
  return diff === SETTINGS_DIFF_NO_CHANGE ? {} : diff as AppSettingsPatch
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
    initialSetupCompleted: raw.initialSetupCompleted === true,
    locale: isAppLocale(raw.locale) ? raw.locale : 'en',
    theme,
    uiFontScale,
    chatContentMaxWidthPx,
    composerSendKey: normalizeComposerSendKey(raw.composerSendKey),
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
    gitBranchPrefix: normalizeGitBranchPrefix(raw.gitBranchPrefix ?? DEFAULT_GIT_BRANCH_PREFIX),
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

function diffSettingsValue(
  base: unknown,
  next: unknown,
  path: readonly string[]
): unknown | typeof SETTINGS_DIFF_NO_CHANGE {
  if (settingsValueEqual(base, next)) return SETTINGS_DIFF_NO_CHANGE
  if (isPlainSettingsRecord(base) && isPlainSettingsRecord(next)) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(next).sort()) {
      const childDiff = diffSettingsValue(base[key], next[key], [...path, key])
      if (childDiff !== SETTINGS_DIFF_NO_CHANGE) out[key] = childDiff
    }
    for (const key of Object.keys(base).sort()) {
      if (Object.prototype.hasOwnProperty.call(next, key)) continue
      const sentinel = SETTINGS_CLEAR_SENTINELS[[...path, key].join('.')]
      if (sentinel !== undefined) out[key] = sentinel
    }
    return Object.keys(out).length > 0 ? out : SETTINGS_DIFF_NO_CHANGE
  }
  return next
}

function settingsValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  return stableSettingsStringify(a) === stableSettingsStringify(b)
}

function stableSettingsStringify(value: unknown): string {
  return JSON.stringify(canonicalSettingsValue(value))
}

function canonicalSettingsValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalSettingsValue)
  if (!isPlainSettingsRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    out[key] = canonicalSettingsValue(value[key])
  }
  return out
}

function isPlainSettingsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
