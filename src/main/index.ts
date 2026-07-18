import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  powerSaveBlocker,
  protocol,
  session,
  systemPreferences,
  Tray,
  type ContextMenuParams,
  type MenuItemConstructorOptions
} from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  JsonSettingsStore,
  devServerHintUrl
} from './settings-store'
import kunLogoPng from '../asset/img/kun.png?url'
import kunMacLogoPng from '../asset/img/kun_mac.png?url'
import kunTrayPng from '../asset/img/kun_tray.png?url'
import { createAppIcon, pickTrayIcon, prepareTrayIcon } from './app-icon'
import { buildTrayMenuTemplate, parseTrayThreads, type TrayThreadSummary } from './tray-session-menu'
import { configureLinuxWaylandImeSwitches } from './app-command-line'
import {
  clearDevelopmentRendererHttpCache,
  configureDevelopmentRendererHttpCache,
  reloadRenderer
} from './dev-renderer-cache'
import { configureAppIdentity } from './app-identity'
import { shouldStartHidden, syncLoginItemSettings } from './desktop-behavior'
import { resolveLogDirectory, resolveNamedPreloadPath, resolvePreloadPath } from './main-paths'
import { runLegacyKunDataMigration } from './legacy-data-migration'
import { LegacyProviderSettingsMigrationCoordinator } from './legacy-provider-settings-migration'
import {
  applyKunRuntimePatch,
  kunSettingsEnvelope,
  getActiveAgentApiKey,
  getKunRuntimeSettings,
  mergeKunRuntimeSettings,
  mergeClawSettings,
  mergeWorkflowSettings,
  mergeAppBehaviorSettings,
  mergeModelProviderSettings,
  mergeDesignSettings,
  mergeScheduleSettings,
  mergeWriteSettings,
  mergeTerminalSettings,
  MIN_KUN_LOCAL_PORT,
  normalizeAppSettings,
  normalizeAppBehaviorSettings,
  normalizeCheckpointCleanupSettings,
  normalizeKeyboardShortcuts,
  resolveKunRuntimeSettings,
  resolveTerminalColorMode,
  type AppBehaviorConfigV1,
  type AppSettingsPatch,
  type AppSettingsV1,
  type WindowCloseAction
} from '../shared/app-settings'
import { parseRuntimeErrorBody, runtimeErrorToError, type RuntimeErrorCode } from '../shared/runtime-error'
import type { GuiUpdateState } from '../shared/gui-update'
import type { TrayActionPayload } from '../shared/kun-gui-api'
import { isAllowedDevPreviewUrl } from '../shared/dev-preview-url'
import { isAuthorizedPrototypeFileUrl } from './services/prototype-embed-registry'
import { fetchUpstreamModelIds } from './upstream-models'
import {
  kunRuntimeAdapter,
  getRuntimeBaseUrlForSettings,
  runtimeAuthHeaders,
  runtimeRequestViaHost,
  type RuntimeRequestInit
} from './runtime/kun-adapter'
import { waitForRuntimeTurnsIdle } from './runtime/managed-runtime-idle'
import {
  resolveKunDataDir,
  setKunUnexpectedExitHandler,
  syncGuiManagedKunConfig,
  waitForKunStartupSettled,
  type KunUnexpectedExitInfo
} from './kun-process'
import { expandHomePath } from './settings-store'
import { KunRuntimeSupervisor, type KunRuntimeStatus } from './kun-runtime-supervisor'
import { configureLogger, logError, logInfo, logWarn, pruneOnStartup } from './logger'
import { cleanupUnusedGitCheckpointsIfDue } from './services/git-checkpoint-service'
import { resolveMainWindowCloseDecision } from './window-close-behavior'
import {
  MAIN_WINDOW_RENDERER_RECOVERY_DELAY_MS,
  MAIN_WINDOW_RENDERER_RECOVERY_MAX_ATTEMPTS,
  MAIN_WINDOW_RENDERER_RECOVERY_WINDOW_MS,
  MainWindowRendererRecoveryBudget,
  shouldRecoverMainFrameLoad,
  shouldRecoverRendererProcess
} from './main-window-renderer-recovery'
import { createClawRuntime, type ClawRuntime } from './claw-runtime'
import { createScheduleRuntime, type ScheduleRuntime } from './schedule-runtime'
import { createWorkflowRuntime, type WorkflowRuntime } from './workflow-runtime'
import { runClawScheduleMcpServerFromArgv } from './claw-schedule-mcp-server'
import {
  resolveKunMcpJsonPath,
  syncClawScheduleMcpConfig,
  type ClawScheduleMcpLaunchConfig
} from './claw-schedule-mcp-config'
import {
  runtimeProcessConfigChanged,
  runtimeSettingsApplyMode,
  stableSettingsStringify
} from './runtime-settings-apply-mode'
import { registerAppIpcHandlers } from './ipc/register-app-ipc-handlers'
import { DataMigrationController } from './data-migration/data-migration-controller'
import {
  configureManagedWeixinBridgeUrlResolver,
  pollFeishuInstall,
  pollWeixinInstall,
  startFeishuInstallQrcode,
  startWeixinInstallQrcode
} from './claw-platform-install'
import { registerRuntimeSseIpc } from './runtime-sse-ipc'
import { registerTerminalPtyIpc } from './terminal/terminal-pty-ipc'
import {
  configureWeixinBridgeRuntimeContextProvider,
  ensureWeixinBridgeRpcUrl,
  getWeixinBridgeAccountUserId,
  sendWeixinBridgeMessage,
  stopWeixinBridgeRuntime
} from './weixin-bridge-runtime'
import { webhookUrl } from './claw-runtime-helpers'
import { createTelegramRuntime, type TelegramRuntime, verifyTelegramBotToken } from './telegram-runtime'
import { shutdownLocalWhisperService } from './services/local-whisper-service'
import { KunRuntimeHealthMonitor } from './runtime/kun-runtime-health-monitor'
import {
  buildManagedRuntimeHotApplyBody,
  classifyManagedRuntimeHotApplyResponse
} from './runtime/kun-runtime-config-service'
import { ManagedRuntimeShutdownCoordinator } from './runtime/managed-runtime-shutdown-coordinator'
import {
  registerKunExtensionProtocol,
} from './extensions/extension-resource-protocol'
import {
  ExtensionMediaProtocolRegistry,
  registerKunExtensionPlatformSchemesAsPrivileged
} from './extensions/extension-media-protocol'
import { ExtensionDescriptorResolver } from './extensions/extension-descriptor-resolver'
import { ExtensionViewSessionRegistry } from './extensions/extension-view-sessions'
import { ExtensionExternalBrowserManager } from './extensions/extension-external-browser'
import { ExtensionViewProtocolRegistry } from './extensions/extension-view-protocol-registry'
import { installWebviewSecurityGuards } from './extensions/extension-webview-security'
import {
  ExtensionConsentTokenService,
  ProtectedExtensionActionService
} from './extensions/extension-consent-service'
import { localizeProtectedExtensionPrompt } from './extensions/protected-extension-prompt'
import { ProtectedCredentialSurfaceController } from './extensions/protected-credential-surface'
import { ExtensionContentScriptController } from './extensions/extension-content-script-controller'
import { createExtensionWorkbenchEnvironment } from './extensions/extension-workbench-environment'
import {
  registerExtensionIpcHandlers,
  startExtensionNotificationPump,
  startExtensionSecretRevealConsentPump,
  type RegisterExtensionIpcHandlersOptions
} from './ipc/register-extension-ipc-handlers'

const __dirname = dirname(fileURLToPath(import.meta.url))
registerKunExtensionPlatformSchemesAsPrivileged(protocol)
// 品牌升级为 Kun 后仍保留旧 AppUserModelId:它必须和 electron-builder
// 的 appId 一致才能让 Windows 通知 / 任务栏分组在升级前后连续,而
// appId 因为 NSIS 升级 GUID 与 macOS 更新签名校验的原因永远不改。
const APP_USER_MODEL_ID = 'com.xingyuzhong.deepseekgui'
const startupTraceEnabled =
  process.env.KUN_STARTUP_TRACE === '1' || process.env.DEEPSEEK_GUI_STARTUP_TRACE === '1'
const startupTraceStart = Date.now()

function traceStartup(label: string, detail?: unknown): void {
  if (!startupTraceEnabled) return
  const elapsed = String(Date.now() - startupTraceStart).padStart(6, ' ')
  if (detail === undefined) {
    console.info(`[startup +${elapsed}ms] ${label}`)
  } else {
    console.info(`[startup +${elapsed}ms] ${label}`, detail)
  }
}

function shouldStartWeixinBridgeRuntime(settings: AppSettingsV1): boolean {
  return settings.claw.enabled &&
    settings.claw.im.enabled &&
    settings.claw.channels.some((channel) => channel.enabled && channel.provider === 'weixin')
}

function syncWeixinBridgeRuntime(settings: AppSettingsV1): void {
  if (!shouldStartWeixinBridgeRuntime(settings)) return
  void ensureWeixinBridgeRpcUrl().catch((error) => {
    logWarn('weixin-bridge', 'Failed to start managed WeChat bridge.', {
      message: error instanceof Error ? error.message : String(error)
    })
  })
}

const runningClawScheduleMcpServer =
  process.argv.includes('--gui-schedule-mcp-server') || process.argv.includes('--claw-schedule-mcp-server')

function getClawScheduleMcpLaunchConfig(): ClawScheduleMcpLaunchConfig {
  return {
    appPath: app.getAppPath(),
    execPath: process.execPath,
    isPackaged: app.isPackaged
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function runtimeFailure(code: string, message: string, status = 0, details?: unknown) {
  return {
    ok: false as const,
    status,
    body: JSON.stringify({ code, message, ...(details !== undefined ? { details } : {}) })
  }
}

function resolveConfiguredApiKey(settings: AppSettingsV1): string {
  const fromSettings = getActiveAgentApiKey(settings)
  const fromEnv = process.env.DEEPSEEK_API_KEY?.trim() ?? ''
  return fromSettings || fromEnv
}

function runtimeJsonError(code: string, message: string): Error {
  return runtimeErrorToError({ code: code as RuntimeErrorCode, message })
}

traceStartup('main module evaluated')

if (runningClawScheduleMcpServer && process.platform === 'darwin') {
  app.dock?.hide()
}

// 在最早的阶段把 app 名称、AppUserModelId 都设好。
// Windows 任务栏 / 系统托盘 / 通知中心看到的应用名都来自这里;
// 设得太晚的话 BrowserWindow title、托盘、IPC 启动时拿到的还是旧的。
// 抽到 app-identity.ts 是为了让测试可以直接 import,不被 main 的
// whenReady 副作用污染。
configureAppIdentity()

// 紧跟在身份设置之后、requestSingleInstanceLock() 之前做旧数据迁移:
// 单实例锁文件就放在 userData 里,必须先把目录定下来。rename 失败
// (典型场景:老版本还在运行)时退回旧目录,功能不受影响,下次再迁。
const legacyMigration = runLegacyKunDataMigration({
  userDataPath: app.getPath('userData'),
  homeDir: homedir(),
  log: (message, detail) => console.warn(`[kun-gui] ${message}`, detail ?? '')
})
if (legacyMigration.userData.usedLegacyFallback) {
  app.setPath('userData', legacyMigration.userData.userDataPath)
}
traceStartup('legacy data migration checked', {
  userDataPath: legacyMigration.userData.userDataPath,
  migratedUserData: legacyMigration.userData.migrated,
  usedLegacyFallback: legacyMigration.userData.usedLegacyFallback,
  settingsRewritten: legacyMigration.settingsRewritten
})

configureLinuxWaylandImeSwitches()
configureDevelopmentRendererHttpCache(app.commandLine, devServerHintUrl())

if (!runningClawScheduleMcpServer && process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID)
}

let mainWindow: BrowserWindow | null = null
let store: JsonSettingsStore
let logDir = ''
let clawRuntime: ClawRuntime | null = null
let scheduleRuntime: ScheduleRuntime | null = null
let telegramRuntime: TelegramRuntime | null = null
let workflowRuntime: WorkflowRuntime | null = null
let appBehavior: AppBehaviorConfigV1 = normalizeAppBehaviorSettings()
let tray: Tray | null = null
let trayMenu: Menu | null = null
let trayMenuOpenPromise: Promise<void> | null = null
let closeWindowPromptOpen = false
let checkpointCleanupTimer: ReturnType<typeof setInterval> | null = null
const extensionViewSessions = new ExtensionViewSessionRegistry()
const extensionExternalBrowsers = new ExtensionExternalBrowserManager(extensionViewSessions)
let protectedCredentialSurface: ProtectedCredentialSurfaceController | null = null
let bindExtensionMainWindow: ((window: BrowserWindow) => void) | undefined

type GuiUpdaterModule = typeof import('./gui-updater')

let guiUpdaterModulePromise: Promise<GuiUpdaterModule> | null = null
let guiUpdaterInitialized = false

function emitClawChannelActivity(payload: { channelId: string; threadId: string }): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('claw:channel-activity', payload)
}

function stopCheckpointCleanupTimer(): void {
  if (checkpointCleanupTimer) {
    clearInterval(checkpointCleanupTimer)
    checkpointCleanupTimer = null
  }
}

function isAppQuitInProgress(): boolean {
  return runtimeShutdown.isQuitInProgress
}

function setUpdateInstallQuitting(active: boolean): void {
  runtimeShutdown.setUpdateInstallQuit(active)
}

async function runCheckpointCleanupIfDue(settings: AppSettingsV1): Promise<void> {
  if (!settings.checkpointCleanup.enabled) return
  const runtime = resolveKunRuntimeSettings(settings)
  const dataDir = resolveKunDataDir(runtime)
  const intervalDays = settings.checkpointCleanup.intervalDays
  const checkpointsRoot = settings.checkpointCleanup.directory?.trim()
    ? expandHomePath(settings.checkpointCleanup.directory.trim())
    : undefined
  try {
    const cleanup = await cleanupUnusedGitCheckpointsIfDue({
      dataDir,
      intervalDays,
      ...(checkpointsRoot ? { checkpointsRoot } : {})
    })
    if (!cleanup.due) return
    const { result } = cleanup
    console.info(
      `[kun-gui] git checkpoint cleanup scanned=${result.scanned} deleted=${result.deleted} kept=${result.kept} failed=${result.failed}`
    )
    if (result.failed > 0) {
      logWarn('git-checkpoint-cleanup', 'failed to delete some unused checkpoints', {
        failed: result.failed,
        failedIds: result.failedIds
      })
    }
  } catch (error) {
    logWarn('git-checkpoint-cleanup', 'failed to clean unused checkpoints', {
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

function syncCheckpointCleanupTimer(settings: AppSettingsV1): void {
  stopCheckpointCleanupTimer()
  if (!settings.checkpointCleanup.enabled) return
  const intervalMs = settings.checkpointCleanup.intervalDays * 24 * 60 * 60 * 1_000
  const run = (): void => {
    void runCheckpointCleanupIfDue(settings)
  }
  run()
  checkpointCleanupTimer = setInterval(run, intervalMs)
  checkpointCleanupTimer.unref?.()
}

const runtimeShutdown = new ManagedRuntimeShutdownCoordinator(async () => {
  await scheduleRuntime?.stop()
  await workflowRuntime?.stop()
  await Promise.all([
    clawRuntime?.stop(),
    telegramRuntime?.stop()
  ])
  await stopWeixinBridgeRuntime()
  await shutdownLocalWhisperService()
  await kunRuntimeAdapter.stopAndWait()
})

function stopManagedRuntimesForQuit(): Promise<void> {
  return runtimeShutdown.stopForQuit()
}

function stopManagedRuntimes(): Promise<void> {
  return runtimeShutdown.stop()
}

async function loadGuiUpdaterModule(): Promise<GuiUpdaterModule> {
  if (!guiUpdaterModulePromise) {
    guiUpdaterModulePromise = import('./gui-updater')
      .then((module) => {
        if (!guiUpdaterInitialized) {
          module.initializeGuiUpdater(
            () => mainWindow,
            async () => (await store.load()).guiUpdate.channel,
            stopManagedRuntimesForQuit,
            async () => (await store.load()).locale,
            setUpdateInstallQuitting
          )
          guiUpdaterInitialized = true
        }
        return module
      })
      .catch((error) => {
        guiUpdaterModulePromise = null
        throw error
      })
  }
  return guiUpdaterModulePromise
}

async function readGuiUpdateState(): Promise<GuiUpdateState> {
  if (!guiUpdaterModulePromise) return { status: 'idle' }
  try {
    const module = await loadGuiUpdaterModule()
    return module.getGuiUpdateState()
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
      code: 'unknown'
    }
  }
}


function installDevPreviewWebviewGuards(options: {
  viewProtocols: ExtensionViewProtocolRegistry
}): void {
  installWebviewSecurityGuards({
    app,
    sessions: extensionViewSessions,
    extensionPreloadPath: resolveNamedPreloadPath(__dirname, 'extension-view'),
    assertExtensionPartitionPrepared: (record) => options.viewProtocols.assertPrepared(record),
    isPreparedExtensionNavigation: (contents, url) =>
      options.viewProtocols.isPreparedInitialNavigation(contents.session.protocol, url),
    isTrustedWorkbench: (contents) => Boolean(
      mainWindow && !mainWindow.isDestroyed() && contents.id === mainWindow.webContents.id
    ),
    isAllowedDevPreviewUrl,
    isAuthorizedPrototypeFileUrl,
    onDenied: ({ code }) => {
      logWarn('extension-webview', 'Denied extension Webview operation.', { code })
    }
  })
}


const appIconSource = process.platform === 'win32' ? kunMacLogoPng : kunLogoPng
const appIcon = createAppIcon(appIconSource)
const trayIcon = createAppIcon(kunTrayPng)
traceStartup('app icon loaded', { source: appIconSource.startsWith('data:') ? 'data-url' : 'path' })
const gotSingleInstanceLock = runningClawScheduleMcpServer || app.requestSingleInstanceLock()
traceStartup('single instance lock checked', {
  gotSingleInstanceLock,
  skippedForClawScheduleMcpServer: runningClawScheduleMcpServer
})

function windowCloseLabels(locale: AppSettingsV1['locale']): {
  title: string
  message: string
  detail: string
  minimizeToTray: string
  quit: string
  cancel: string
  remember: string
} {
  if (locale === 'zh') {
    return {
      title: '关闭窗口',
      message: '关闭窗口时要怎么处理？',
      detail: '选择最小化到托盘时，Kun 会继续在后台运行；选择退出应用会结束后台服务。',
      minimizeToTray: '最小化到托盘',
      quit: '退出应用',
      cancel: '取消',
      remember: '记住我的选择，不再询问'
    }
  }
  return {
    title: 'Close window',
    message: 'What should Kun do when this window closes?',
    detail: 'Minimize to tray keeps Kun running in the background. Quit app stops the background service.',
    minimizeToTray: 'Minimize to tray',
    quit: 'Quit app',
    cancel: 'Cancel',
    remember: 'Remember my choice and do not ask again'
  }
}

function revealMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function dispatchTrayAction(action: TrayActionPayload): void {
  revealMainWindow()
  const window = mainWindow
  if (!window || window.isDestroyed()) return
  const send = (): void => {
    if (!window.isDestroyed()) window.webContents.send('tray:action', action)
  }
  if (window.webContents.isLoadingMainFrame()) {
    window.webContents.once('did-finish-load', send)
  } else {
    send()
  }
}

function showRendererContextMenu(window: BrowserWindow, params: ContextMenuParams): void {
  const template: MenuItemConstructorOptions[] = []
  const hasSelection = params.selectionText.trim().length > 0
  if (params.isEditable) {
    template.push(
      { role: 'undo', enabled: params.editFlags.canUndo },
      { role: 'redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy || hasSelection },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll }
    )
  } else if (hasSelection) {
    template.push(
      { role: 'copy', enabled: true },
      { type: 'separator' },
      { role: 'selectAll' }
    )
  }
  if (!app.isPackaged) {
    if (template.length > 0) template.push({ type: 'separator' })
    template.push({
      label: 'Inspect Element',
      click: () => window.webContents.inspectElement(params.x, params.y)
    })
  }
  if (template.length === 0) return
  Menu.buildFromTemplate(template).popup({ window, x: params.x, y: params.y })
}

function quitFromTray(): void {
  runtimeShutdown.requestQuit()
  app.quit()
}

function createTrayMenu(settings: AppSettingsV1, threads: TrayThreadSummary[]): Menu {
  return Menu.buildFromTemplate(buildTrayMenuTemplate({
    locale: settings.locale,
    threads,
    actions: {
      openThread: (threadId) => dispatchTrayAction({ type: 'open-thread', threadId }),
      newChat: () => dispatchTrayAction({ type: 'new-chat' }),
      openApp: revealMainWindow,
      quit: quitFromTray
    }
  }))
}

async function loadTrayThreads(settings: AppSettingsV1): Promise<TrayThreadSummary[]> {
  try {
    const response = await fetch(`${getRuntimeBaseUrlForSettings(settings)}/v1/threads?limit=20`, {
      headers: runtimeAuthHeaders(settings),
      signal: AbortSignal.timeout(1_000)
    })
    return response.ok ? parseTrayThreads(await response.text()) : []
  } catch (error) {
    logWarn('tray', 'Failed to load tray sessions.', {
      message: error instanceof Error ? error.message : String(error)
    })
    return []
  }
}

function showTrayMenu(): void {
  if (!tray || trayMenuOpenPromise) return
  const currentTray = tray
  trayMenuOpenPromise = (async () => {
    const settings = await store.load()
    const threads = await loadTrayThreads(settings)
    if (currentTray.isDestroyed()) return
    trayMenu = createTrayMenu(settings, threads)
    currentTray.popUpContextMenu(trayMenu)
  })().finally(() => {
    trayMenuOpenPromise = null
  })
}

function syncTray(settings: AppSettingsV1): void {
  appBehavior = settings.appBehavior
  if (appBehavior.closeAction === 'quit') {
    if (tray) {
      tray.destroy()
      tray = null
      trayMenu = null
    }
    return
  }

  if (!tray) {
    // Tray 优先用专门的托盘图(在 16x16/24x24 任务栏尺寸下更清晰的剪影);
    // 托盘图加载失败时回退到主应用图,这样不会看到 electron 默认占位。
    const traySource = prepareTrayIcon(pickTrayIcon(trayIcon, appIcon))
    tray = new Tray(traySource.isEmpty() ? nativeImage.createEmpty() : traySource)
    tray.on('click', showTrayMenu)
    tray.on('double-click', revealMainWindow)
    tray.on('right-click', showTrayMenu)
  }

  tray.setToolTip('Kun')
  trayMenu = createTrayMenu(settings, [])
  tray.setContextMenu(null)
}

async function saveWindowCloseActionPreference(closeAction: WindowCloseAction): Promise<void> {
  const saved = await store.patch({ appBehavior: { closeAction } })
  syncLoginItemSettings(saved)
  syncTray(saved)
}

async function promptWindowCloseAction(window: BrowserWindow): Promise<void> {
  if (closeWindowPromptOpen || window.isDestroyed()) return
  closeWindowPromptOpen = true
  try {
    const settings = await store.load()
    const labels = windowCloseLabels(settings.locale)
    const result = await dialog.showMessageBox(window, {
      type: 'question',
      title: labels.title,
      message: labels.message,
      detail: labels.detail,
      buttons: [labels.minimizeToTray, labels.quit, labels.cancel],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      checkboxLabel: labels.remember,
      checkboxChecked: false
    })
    if (result.response === 0) {
      if (result.checkboxChecked) {
        await saveWindowCloseActionPreference('tray')
      }
      window.hide()
      return
    }
    if (result.response === 1) {
      if (result.checkboxChecked) {
        await saveWindowCloseActionPreference('quit')
      }
      runtimeShutdown.requestQuit()
      app.quit()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[kun-gui] failed to handle close-window prompt:', error)
    logWarn('desktop-behavior', 'Failed to handle close-window prompt.', { message })
  } finally {
    closeWindowPromptOpen = false
  }
}

function handleMainWindowClose(window: BrowserWindow, event: Electron.Event): void {
  const decision = resolveMainWindowCloseDecision({
    closeAction: appBehavior.closeAction,
    isQuitting: runtimeShutdown.isQuitRequested,
    isUpdateInstallQuitting: runtimeShutdown.isUpdateInstallQuit
  })
  if (decision === 'allow') return

  event.preventDefault()
  if (decision === 'hide-to-tray') {
    window.hide()
    return
  }
  void promptWindowCloseAction(window)
}

function normalizeNotificationText(raw: string | undefined, fallback: string, maxLength: number): string {
  const value = typeof raw === 'string' && raw.trim() ? raw.trim() : fallback
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

type TurnCompleteNotificationPayload = {
  threadId?: string
  title?: string
  body?: string
}

async function showTurnCompleteNotification(
  payload: TurnCompleteNotificationPayload
): Promise<{ ok: true; shown: boolean; reason?: string } | { ok: false; message: string }> {
  const settings = await store.load()
  if (!settings.notifications.turnComplete) {
    return { ok: true, shown: false, reason: 'disabled' }
  }
  if (!Notification.isSupported()) {
    return { ok: true, shown: false, reason: 'unsupported' }
  }

  const title = normalizeNotificationText(payload.title, 'Kun', 80)
  const body = normalizeNotificationText(payload.body, 'Conversation complete.', 180)

  try {
    const notification = new Notification({
      title,
      body,
      icon: appIcon.isEmpty() ? undefined : appIcon
    })
    notification.on('click', () => {
      revealMainWindow()
    })
    notification.show()
    return { ok: true, shown: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logError('notification', 'Failed to show turn completion notification', {
      message,
      threadId: payload.threadId
    })
    return { ok: false, message }
  }
}

async function probeThreadApi(settings: AppSettingsV1): Promise<
  | { ok: true }
  | { ok: false; error: string; message: string }
> {
  const base = getRuntimeBaseUrlForSettings(settings)
  const headers = runtimeAuthHeaders(settings)
  headers.set('Accept', 'application/json')

  try {
    const res = await fetch(`${base}/v1/threads?limit=1`, {
      headers,
      signal: AbortSignal.timeout(2_000)
    })
    if (res.ok) return { ok: true }
    const info = parseRuntimeErrorBody(
      await res.text(),
      'The local runtime returned an unexpected error.'
    )
    if (res.status === 401 && /bearer token required/i.test(info.message)) {
      return {
        ok: false,
        error: 'runtime_auth_required',
        message: 'The local runtime requires a bearer token for thread APIs.'
      }
    }
    return {
      ok: false,
      error: info.code === 'unknown' ? 'runtime_request_failed' : info.code,
      message: info.message
    }
  } catch (e) {
    return {
      ok: false,
      error: 'fetch_failed',
      message: e instanceof Error ? e.message : String(e)
    }
  }
}

const kunRuntimeHealthMonitor = new KunRuntimeHealthMonitor<AppSettingsV1>({
  runtimeBaseUrl: getRuntimeBaseUrlForSettings,
  runtimeHeaders: runtimeAuthHeaders,
  warn: (source, message) => logWarn(source, message)
})

async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * How long a managed child that failed the initial health probe gets to prove
 * it is merely busy (e.g. a long synchronous step) rather than hung, before the
 * ensure path force-restarts it in place. Generous on purpose: killing a
 * slow-but-alive runtime would cost the user their in-flight turn (#621).
 */
const RUNTIME_HUNG_CONFIRM_MS = 10_000
const runtimeSupervisor = new KunRuntimeSupervisor<AppSettingsV1>({
  deps: {
    loadSettings: () => store.load(),
    canAutoRestart: (settings) => Boolean(
      resolveConfiguredApiKey(settings) && getKunRuntimeSettings(settings).autoStart
    ),
    ensureRuntime: (settings) => ensureRuntime(settings),
    restartRuntime: (settings) => restartRuntime(settings),
    checkHealth: (settings, timeoutMs) => kunRuntimeHealthMonitor.waitForHealthy(settings, timeoutMs),
    isChildRunning: () => kunRuntimeAdapter.isChildRunning(),
    isStopped: () => runtimeShutdown.isStoppedForQuit || isAppQuitInProgress(),
    publish: (full) => {
      logWarn('runtime-status', `${full.state} (${full.source})${full.message ? `: ${full.message}` : ''}`)
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('runtime:status', full)
      }
    },
    warn: (source, message, details) => logWarn(source, message, details),
    error: (source, message, details) => logError(source, message, details)
  }
})

function publishRuntimeStatus(status: Omit<KunRuntimeStatus, 'at'>): void {
  runtimeSupervisor.publish(status)
}

/** Record a healthy runtime: reset the crash budget and watchdog, announce recovery. */
function noteRuntimeHealthy(source: string): void {
  runtimeSupervisor.noteHealthy(source)
}

function handleUnexpectedKunExit(info: KunUnexpectedExitInfo): void {
  runtimeSupervisor.handleUnexpectedExit(info)
}

function startRuntimeWatchdog(): void {
  runtimeSupervisor.startWatchdog()
}

function stopRuntimeWatchdog(): void {
  runtimeSupervisor.stopWatchdog()
}

function queueRuntimeSettingsApply(prev: AppSettingsV1, next: AppSettingsV1): void {
  // Always update the prev/next anchor so a later task diffs against
  // the settings that were actually applied last, not against the
  // original `prev` captured when this call was queued.
  const anchor = runtimeSupervisor.latestOr(prev)
  runtimeSupervisor.noteLatest(next)
  const applyMode = runtimeSettingsApplyMode(anchor, next)
  if (applyMode === 'none') return

  runtimeSupervisor.enqueueSettingsApply(
    async () => {
      const current = runtimeSupervisor.latestOr(next)
      const currentMode = runtimeSettingsApplyMode(anchor, current)
      if (currentMode === 'restart') {
        await restartManagedRuntimeForSettingsChange(anchor, current)
      } else if (currentMode === 'hot') {
        const result = await applyManagedRuntimeSettingsHot(current, 'settings-apply')
        if (result === 'restart_required') {
          await restartManagedRuntimeForSettingsChange(anchor, current, true)
        }
      }
    },
    (error: unknown) => {
      logWarn('settings-apply', 'Failed to apply Kun runtime settings in background', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  )
}

function queueRuntimeMcpConfigApply(settings: AppSettingsV1): void {
  runtimeSupervisor.noteLatest(settings)
  runtimeSupervisor.enqueueSettingsApply(
    async () => {
      const current = runtimeSupervisor.latestOr(settings)
      const result = await applyManagedRuntimeSettingsHot(current, 'mcp-config')
      if (result === 'restart_required') {
        await restartManagedRuntimeForMcpConfigChange(current)
      }
    },
    (error: unknown) => {
      logWarn('mcp-config', 'Failed to apply Kun MCP config change in background', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  )
}

async function waitForQueuedRuntimeSettingsApply(): Promise<void> {
  await runtimeSupervisor.waitForSettingsApply()
}

/**
 * Build a stable fingerprint of the settings that affect the
 * Kun runtime so that `ensureRuntime` can debounce on real
 * state instead of on a single in-flight promise. Without this,
 * a fresh call that arrives while a failing ensure is still pending
 * would re-throw the old error.
 */
function runtimeFingerprint(settings: AppSettingsV1): string {
  return stableSettingsStringify(resolveKunRuntimeSettings(settings))
}

async function ensureRuntime(settings: AppSettingsV1): Promise<AppSettingsV1> {
  try {
    if (await runtimeSupervisor.waitForRestart()) {
      return store.load()
    }
  } catch {
    /* fall through to a normal ensure so callers see the latest state */
  }
  const fingerprint = runtimeFingerprint(settings)
  return runtimeSupervisor.ensure(fingerprint, () => ensureRuntimeOnce(settings))
}

async function ensureRuntimeOnce(settings: AppSettingsV1): Promise<AppSettingsV1> {
  await waitForQueuedRuntimeSettingsApply()
  return ensureKunRuntime(settings)
}

async function resolveManagedKunLaunchSettings(
  settings: AppSettingsV1,
  source: string
): Promise<AppSettingsV1> {
  const tokenResult = await ensureManagedKunRuntimeToken(settings, source)
  const launchSettings = tokenResult.settings
  const runtime = getKunRuntimeSettings(launchSettings)
  const resolved = await kunRuntimeAdapter.resolveAvailablePort(runtime.port)
  if (!resolved.changed) return launchSettings

  const next = await store.patch({ agents: { kun: { port: resolved.port } } })
  runtimeSupervisor.noteLatest(next)
  logWarn(source, `Kun port ${runtime.port} is unavailable; using ${resolved.port} for the managed runtime`, {
    previousPort: runtime.port,
    port: resolved.port,
    message: resolved.message
  })
  return next
}

function generateKunRuntimeToken(): string {
  return randomBytes(32).toString('base64url')
}

async function ensureManagedKunRuntimeToken(
  settings: AppSettingsV1,
  source: string
): Promise<{ settings: AppSettingsV1; generated: boolean }> {
  const runtime = getKunRuntimeSettings(settings)
  if (runtime.runtimeToken.trim()) {
    return { settings, generated: false }
  }

  const next = await store.patch({
    agents: { kun: { runtimeToken: generateKunRuntimeToken() } }
  })
  runtimeSupervisor.noteLatest(next)
  logWarn(source, 'Generated a runtime token for the managed Kun runtime because none was configured.')
  return { settings: next, generated: true }
}

async function ensureKunRuntime(settings: AppSettingsV1): Promise<AppSettingsV1> {
  const tokenResult = await ensureManagedKunRuntimeToken(settings, 'runtime-start')
  const currentSettings = tokenResult.settings
  if (tokenResult.generated && kunRuntimeAdapter.isChildRunning()) {
    logWarn('runtime-start', 'Restarting managed Kun to apply the generated runtime token.')
    await kunRuntimeAdapter.stopAndWait()
  }

  const runtime = getKunRuntimeSettings(currentSettings)
  const hasApiKey = Boolean(resolveConfiguredApiKey(currentSettings))

  const healthy = await kunRuntimeHealthMonitor.waitForHealthy(currentSettings, 2_000)
  if (healthy) {
    const threadApi = await probeThreadApi(currentSettings)
    if (threadApi.ok) {
      noteRuntimeHealthy('ensure')
      return currentSettings
    }
    throw runtimeJsonError(threadApi.error, threadApi.message)
  }

  if (!hasApiKey) {
    throw runtimeJsonError(
      'missing_api_key',
      'DeepSeek API Key is required before the GUI can start Kun.'
    )
  }
  if (!runtime.autoStart) {
    throw runtimeJsonError(
      'runtime_offline',
      'Kun is offline. Enable automatic startup in Settings, or start `kun serve` manually.'
    )
  }

  // A managed child that is alive but failed the probe is hung (blocked event
  // loop) or merely busy — not absent. The launch path below cannot recover it
  // on its own: resolveAvailablePort skips our own child when reclaiming the
  // port (isCurrentKunChildPid) and startKunChild early-returns while
  // isChildRunning() stays true, so it would pick a fresh port, never spawn,
  // and fail every request until the ~90s watchdog finally force-restarts
  // (KunAgent/Kun#621). Stop the hung child here so the relaunch spawns a fresh
  // process on the SAME port instead.
  if (kunRuntimeAdapter.isChildRunning()) {
    // Never tear down a child still inside its (deliberately generous) startup
    // window — interrupting a slow-but-healthy boot is the #544 restart storm.
    await waitForKunStartupSettled()
    if (kunRuntimeAdapter.isChildRunning()) {
      // Give a merely-busy runtime a real chance to answer before judging it
      // hung, so one long synchronous step does not cost the user their turn.
      const recovered = await kunRuntimeHealthMonitor.waitForHealthy(currentSettings, RUNTIME_HUNG_CONFIRM_MS)
      if (recovered) {
        const threadApi = await probeThreadApi(currentSettings)
        if (threadApi.ok) {
          noteRuntimeHealthy('ensure')
          return currentSettings
        }
        throw runtimeJsonError(threadApi.error, threadApi.message)
      }
      logWarn(
        'runtime-start',
        `managed Kun child stopped responding on port ${runtime.port}; restarting it in place`
      )
      await kunRuntimeAdapter.stopAndWait()
    }
  }

  const launchSettings = await resolveManagedKunLaunchSettings(currentSettings, 'runtime-start')
  const adapter = kunRuntimeAdapter
  try {
    await adapter.ensureRunning(launchSettings)
  } catch (e) {
    console.error('[kun-gui] failed to start kun:', e)
    throw e
  }
  const started = await kunRuntimeHealthMonitor.waitForHealthy(launchSettings, 20_000)
  if (!started) {
    throw runtimeJsonError(
      'runtime_unhealthy',
      'Kun did not become healthy after launch.'
    )
  }

  const threadApi = await probeThreadApi(launchSettings)
  if (!threadApi.ok) {
    throw runtimeJsonError(threadApi.error, threadApi.message)
  }
  noteRuntimeHealthy('ensure')
  return launchSettings
}

async function restartRuntime(settings: AppSettingsV1): Promise<void> {
  return runtimeSupervisor.restart(() => restartRuntimeOnce(settings))
}

async function restartRuntimeOnce(settings: AppSettingsV1): Promise<void> {
  await waitForQueuedRuntimeSettingsApply()
  // Don't tear down a child that is still completing its startup; wait for it
  // to settle so a restart trigger that races a boot doesn't reset the clock
  // (#544). Resolves immediately when nothing is launching.
  await waitForKunStartupSettled()
  const runtime = getKunRuntimeSettings(settings)

  if (!resolveConfiguredApiKey(settings)) {
    throw runtimeJsonError(
      'missing_api_key',
      'DeepSeek API Key is required before the GUI can start Kun.'
    )
  }
  if (!runtime.autoStart) {
    throw runtimeJsonError(
      'runtime_offline',
      'Kun is offline. Enable automatic startup in Settings, or start `kun serve` manually.'
    )
  }

  const adapter = kunRuntimeAdapter
  await adapter.stopAndWait()
  const launchSettings = await resolveManagedKunLaunchSettings(settings, 'runtime-restart')

  try {
    await adapter.ensureRunning(launchSettings)
  } catch (e) {
    console.error('[kun-gui] failed to restart kun:', e)
    throw e
  }

  const healthy = await kunRuntimeHealthMonitor.waitForHealthy(launchSettings, 20_000)
  if (!healthy) {
    throw runtimeJsonError(
      'runtime_unhealthy',
      'Kun did not become healthy after restart.'
    )
  }

  const threadApi = await probeThreadApi(launchSettings)
  if (!threadApi.ok) {
    throw runtimeJsonError(threadApi.error, threadApi.message)
  }
  noteRuntimeHealthy('restart')
}

function createWindow(options: { suppressInitialShow?: boolean } = {}): void {
  traceStartup('createWindow:start')
  const preloadPath = resolvePreloadPath(__dirname)
  const usesDesktopTitleBar = process.platform === 'win32' || process.platform === 'linux'
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    icon: appIcon.isEmpty() ? undefined : appIcon,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : usesDesktopTitleBar ? 'hidden' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 31, y: 22 } : undefined,
    autoHideMenuBar: usesDesktopTitleBar,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      webviewTag: true,
      // Pass the home dir to the sandboxed preload (it can't require node:os).
      additionalArguments: [`--kun-home-dir=${homedir()}`]
    }
  })
  mainWindow = window
  bindExtensionMainWindow?.(window)
  if (usesDesktopTitleBar) {
    window.setMenu(null)
    window.setMenuBarVisibility(false)
  }
  const recoveryBudget = new MainWindowRendererRecoveryBudget()
  let recoveryTimer: ReturnType<typeof setTimeout> | null = null
  let rendererProcessId = 0
  const scheduleRendererRecovery = (trigger: string, detail: unknown): void => {
    if (
      recoveryTimer ||
      isAppQuitInProgress() ||
      window.isDestroyed() ||
      window.webContents.isDestroyed()
    ) return

    const attempt = recoveryBudget.reserve()
    if (attempt === null) {
      logError('renderer', 'Automatic main-window recovery stopped after repeated failures.', {
        trigger,
        detail,
        maxAttempts: MAIN_WINDOW_RENDERER_RECOVERY_MAX_ATTEMPTS,
        windowMs: MAIN_WINDOW_RENDERER_RECOVERY_WINDOW_MS
      })
      return
    }

    logWarn('renderer', 'Scheduling a main-window reload after renderer failure.', {
      trigger,
      detail,
      attempt,
      maxAttempts: MAIN_WINDOW_RENDERER_RECOVERY_MAX_ATTEMPTS
    })
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null
      if (
        isAppQuitInProgress() ||
        window.isDestroyed() ||
        window.webContents.isDestroyed()
      ) return
      logWarn('renderer', 'Reloading the main window after renderer failure.', {
        trigger,
        attempt
      })
      reloadRenderer(window.webContents, devServerHintUrl())
    }, MAIN_WINDOW_RENDERER_RECOVERY_DELAY_MS)
    recoveryTimer.unref?.()
  }

  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[kun-gui] failed to load preload ${preloadPath}:`, error)
    logError('preload', 'Failed to load preload script', { preloadPath, message })
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    if (isAppQuitInProgress() || !shouldRecoverRendererProcess(details.reason)) return
    const detail = {
      reason: details.reason,
      exitCode: details.exitCode,
      rendererProcessId
    }
    console.error('[kun-gui] main renderer process exited unexpectedly:', detail)
    logError('renderer', 'Main renderer process exited unexpectedly.', detail)
    scheduleRendererRecovery('render-process-gone', detail)
  })
  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame, frameProcessId) => {
      if (
        isAppQuitInProgress() ||
        !shouldRecoverMainFrameLoad(errorCode, isMainFrame)
      ) return
      const detail = {
        errorCode,
        errorDescription,
        validatedURL,
        frameProcessId
      }
      console.error('[kun-gui] main renderer failed to load:', detail)
      logError('renderer', 'Main renderer failed to load.', detail)
      scheduleRendererRecovery('did-fail-load', detail)
    }
  )
  window.webContents.on('unresponsive', () => {
    if (isAppQuitInProgress()) return
    logWarn('renderer', 'Main renderer became unresponsive.', { rendererProcessId })
  })
  window.webContents.on('responsive', () => {
    logInfo('renderer', `Main renderer became responsive again (pid=${rendererProcessId}).`)
  })
  window.webContents.on('context-menu', (event, params) => {
    event.preventDefault()
    if (window.isDestroyed()) return
    showRendererContextMenu(window, params)
  })
  const showWindow = (): void => {
    if (options.suppressInitialShow) return
    if (window.isDestroyed() || window.isVisible()) return
    window.show()
  }
  window.on('close', (event) => {
    if (window.isDestroyed()) return
    handleMainWindowClose(window, event)
  })
  window.on('closed', () => {
    if (recoveryTimer) {
      clearTimeout(recoveryTimer)
      recoveryTimer = null
    }
    if (mainWindow === window) mainWindow = null
  })
  const devUrl = devServerHintUrl()
  traceStartup('createWindow:load', { devUrl: devUrl ?? 'file' })
  if (devUrl) {
    void window.loadURL(devUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  window.once('ready-to-show', () => {
    traceStartup('window:ready-to-show')
    showWindow()
  })
  window.webContents.on('did-finish-load', () => {
    traceStartup('window:did-finish-load')
    rendererProcessId = window.webContents.getOSProcessId()
    if (runtimeSupervisor.lastStatus && !window.isDestroyed()) {
      window.webContents.send('runtime:status', runtimeSupervisor.lastStatus)
    }
    showWindow()
  })
  setTimeout(() => {
    traceStartup('window:fallback-show-timeout')
    showWindow()
  }, 1500)
}

/**
 * Reject runtime-affecting values that would persist a config kun can
 * never boot with. Runs before the settings patch is written to disk.
 */
function validateRuntimeSettingsForApply(next: AppSettingsV1): string | null {
  const runtime = resolveKunRuntimeSettings(next)
  if (!Number.isInteger(runtime.port) || runtime.port < MIN_KUN_LOCAL_PORT || runtime.port > 65_535) {
    return `Kun port must be an integer between ${MIN_KUN_LOCAL_PORT} and 65535 (got ${String(runtime.port)})`
  }
  const baseUrl = (runtime.baseUrl ?? '').trim()
  if (baseUrl) {
    try {
      const parsed = new URL(baseUrl)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return `model base URL must use http(s): ${baseUrl}`
      }
    } catch {
      return `model base URL is not a valid URL: ${baseUrl}`
    }
  }
  return null
}

function preserveRuntimeTokenForFullSettingsSnapshot(
  prev: AppSettingsV1,
  partial: AppSettingsPatch
): AppSettingsPatch {
  const incomingKun = partial.agents?.kun
  if (!incomingKun || !isFullSettingsSnapshotPatch(partial)) return partial
  if (typeof incomingKun.runtimeToken !== 'string' || incomingKun.runtimeToken.trim()) return partial

  const currentToken = getKunRuntimeSettings(prev).runtimeToken.trim()
  if (!currentToken) return partial

  return {
    ...partial,
    agents: {
      ...partial.agents,
      kun: {
        ...incomingKun,
        runtimeToken: currentToken
      }
    }
  }
}

function isFullSettingsSnapshotPatch(partial: AppSettingsPatch): boolean {
  return partial.version !== undefined &&
    partial.provider !== undefined &&
    partial.agents?.kun !== undefined &&
    partial.log !== undefined &&
    partial.checkpointCleanup !== undefined &&
    partial.notifications !== undefined &&
    partial.appBehavior !== undefined &&
    partial.keyboardShortcuts !== undefined &&
    partial.write !== undefined &&
    partial.claw !== undefined &&
    partial.schedule !== undefined &&
    partial.workflow !== undefined &&
    partial.terminal !== undefined &&
    partial.guiUpdate !== undefined
}

type ManagedRuntimeHotApplyResult = 'applied' | 'skipped' | 'restart_required'

async function applyManagedRuntimeSettingsHot(
  settings: AppSettingsV1,
  source: string
): Promise<ManagedRuntimeHotApplyResult> {
  await waitForKunStartupSettled()
  const adapter = kunRuntimeAdapter
  if (!adapter.isChildRunning()) return 'skipped'

  const runtime = resolveKunRuntimeSettings(settings)
  const dataDir = resolveKunDataDir(runtime)
  const config = await syncGuiManagedKunConfig(dataDir, runtime, {
    scheduleMcp: {
      settings,
      launch: getClawScheduleMcpLaunchConfig()
    }
  })
  const body = buildManagedRuntimeHotApplyBody(settings, config)

  const headers = runtimeAuthHeaders(settings)
  headers.set('content-type', 'application/json')
  try {
    const response = await fetch(
      `${getRuntimeBaseUrlForSettings(settings)}/v1/runtime/config/apply`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      }
    )
    const text = await response.text()
    const outcome = classifyManagedRuntimeHotApplyResponse(response.status, response.ok, text)
    if (outcome.result === 'applied') {
      noteRuntimeHealthy(source)
      return 'applied'
    }
    if (outcome.result === 'restart_required') {
      logWarn(source, `Kun hot config apply requested restart: ${outcome.message}`)
      return 'restart_required'
    }
    throw new Error(outcome.message)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logWarn(source, `Kun hot config apply failed; falling back to restart: ${message}`)
    return 'restart_required'
  }
}

async function restartManagedRuntimeForSettingsChange(
  prev: AppSettingsV1,
  next: AppSettingsV1,
  force = false
): Promise<void> {
  if (!force && !runtimeProcessConfigChanged(prev, next)) return

  // Let any in-flight boot launch finish (or fail) before we read liveness
  // and stop the child. Killing a kun that is still inside its startup window
  // throws away the boot's progress and restarts the clock — the #544 restart
  // storm. Once it settles, the child is either healthy (graceful restart
  // below) or already gone (`wasRunning` is false and we return).
  await waitForKunStartupSettled()

  const runtime = resolveKunRuntimeSettings(next)
  const adapter = kunRuntimeAdapter
  const wasRunning = adapter.isChildRunning()

  if (!wasRunning) return

  // Decide BEFORE stopping the child. Stranding a healthy runtime is exactly
  // issue #329: a partial/transient save (e.g. the active providerId moved to
  // a profile whose key lives elsewhere) can momentarily resolve to "no API
  // key" even though the user clearly has one configured. If the runtime we
  // are about to restart was healthy and the previous settings had a usable
  // key, don't kill it on the strength of a key check the new settings fail —
  // leave it running on its current config; the next save with a resolvable
  // key restarts cleanly.
  const nextHasApiKey = Boolean(resolveConfiguredApiKey(next))
  if (!nextHasApiKey && Boolean(resolveConfiguredApiKey(prev))) {
    logWarn(
      'settings-apply',
      'Skipping Kun restart: the new settings resolve to no API key but the running runtime had one — leaving the healthy runtime in place.'
    )
    return
  }

  await waitForManagedRuntimeReadyBeforeStop(prev, 'settings-apply')
  await adapter.stopAndWait()
  if (!nextHasApiKey || !runtime.autoStart) {
    publishRuntimeStatus({
      state: 'stopped',
      source: 'settings-apply',
      message: 'Kun was stopped: the new settings have no API key or auto-start is disabled.'
    })
    return
  }

  publishRuntimeStatus({ state: 'restarting', source: 'settings-apply' })
  try {
    const launchSettings = await resolveManagedKunLaunchSettings(next, 'settings-apply')
    await adapter.ensureRunning(launchSettings)
    const healthy = await kunRuntimeHealthMonitor.waitForHealthy(launchSettings, 20_000)
    if (!healthy) {
      throw new Error('Kun did not become healthy after the settings change')
    }
    noteRuntimeHealthy('settings-apply')
    publishRuntimeStatus({ state: 'running', source: 'settings-apply' })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logWarn('settings-apply', `Kun restart failed after settings change: ${message}`)
    await rollbackRuntimeSettingsAfterFailedApply(prev, message)
  }
}

/**
 * A settings change took the runtime down and the new config cannot
 * boot. Restore the previous runtime/provider settings on disk (so the
 * next app launch is not bricked either) and bring kun back up on the
 * last-known-good configuration.
 */
async function rollbackRuntimeSettingsAfterFailedApply(
  prev: AppSettingsV1,
  failureMessage: string
): Promise<void> {
  const adapter = kunRuntimeAdapter
  let base: AppSettingsV1 = prev
  try {
    base = await store.patch({
      agents: { kun: getKunRuntimeSettings(prev) },
      provider: prev.provider
    })
    runtimeSupervisor.noteLatest(base)
  } catch (error) {
    logWarn('settings-apply', 'failed to restore previous runtime settings on disk', {
      message: error instanceof Error ? error.message : String(error)
    })
  }
  if (!resolveConfiguredApiKey(base) || !getKunRuntimeSettings(base).autoStart) {
    publishRuntimeStatus({
      state: 'stopped',
      source: 'settings-apply',
      rolledBack: true,
      message: `The new settings failed to apply (${failureMessage}); previous settings were restored but auto-start is unavailable.`
    })
    return
  }
  try {
    const launchSettings = await resolveManagedKunLaunchSettings(base, 'settings-apply-rollback')
    await adapter.ensureRunning(launchSettings)
    const healthy = await kunRuntimeHealthMonitor.waitForHealthy(launchSettings, 20_000)
    if (!healthy) {
      throw new Error('previous configuration did not become healthy')
    }
    noteRuntimeHealthy('settings-apply-rollback')
    publishRuntimeStatus({
      state: 'running',
      source: 'settings-apply',
      rolledBack: true,
      message: `The new settings failed to apply (${failureMessage}); Kun is running on the previous settings again.`
    })
  } catch (error) {
    publishRuntimeStatus({
      state: 'failed',
      source: 'settings-apply',
      rolledBack: true,
      message: `The new settings failed to apply (${failureMessage}) and restoring the previous settings also failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    })
  }
}

async function restartManagedRuntimeForMcpConfigChange(settings: AppSettingsV1): Promise<void> {
  // See restartManagedRuntimeForSettingsChange: never interrupt an in-flight
  // boot launch (#544 restart storm).
  await waitForKunStartupSettled()

  const runtime = resolveKunRuntimeSettings(settings)
  const adapter = kunRuntimeAdapter
  const wasRunning = adapter.isChildRunning()

  if (!wasRunning) return
  await waitForManagedRuntimeReadyBeforeStop(settings, 'mcp-config')
  await adapter.stopAndWait()
  if (!resolveConfiguredApiKey(settings) || !runtime.autoStart) return

  publishRuntimeStatus({ state: 'restarting', source: 'mcp-config' })
  try {
    const launchSettings = await resolveManagedKunLaunchSettings(settings, 'mcp-config')
    await adapter.ensureRunning(launchSettings)
    const healthy = await kunRuntimeHealthMonitor.waitForHealthy(launchSettings, 20_000)
    if (!healthy) {
      throw new Error('Kun did not become healthy after the MCP config change')
    }
    noteRuntimeHealthy('mcp-config')
    publishRuntimeStatus({ state: 'running', source: 'mcp-config' })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logWarn('mcp-config', `Kun restart failed after MCP config change: ${message}`)
    publishRuntimeStatus({
      state: 'failed',
      source: 'mcp-config',
      message: `Kun failed to restart after the MCP config change: ${message}. Check the MCP config file, then retry.`
    })
  }
}

async function waitForManagedRuntimeReadyBeforeStop(
  settings: AppSettingsV1,
  source: string
): Promise<void> {
  const healthy = await kunRuntimeHealthMonitor.waitForHealthy(settings, 20_000)
  if (!healthy) {
    logWarn(source, 'Kun did not become healthy before a managed restart; stopping it anyway')
    return
  }
  const idle = await waitForRuntimeTurnsIdle({ settings })
  if (idle === 'timeout') {
    logWarn(source, 'Kun still has running turns after waiting; stopping it anyway')
  } else if (idle === 'unavailable') {
    logWarn(source, 'Could not verify Kun turn idleness before a managed restart; stopping it anyway')
  }
}

async function runtimeRequest(
  settings: AppSettingsV1,
  pathAndQuery: string,
  init: RuntimeRequestInit
): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    return await runtimeRequestViaHost(settings, pathAndQuery, init, ensureRuntime)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logError('runtime-request', `HTTP request to ${pathAndQuery} failed`, { message })
    const parsed = parseRuntimeErrorBody(message, message)
    if (parsed.code !== 'unknown' || parsed.message !== message) {
      return runtimeFailure(parsed.code, parsed.message, 0, parsed.details)
    }
    return runtimeFailure('fetch_failed', message)
  }
}

if (runningClawScheduleMcpServer) {
  void runClawScheduleMcpServerFromArgv(process.argv).catch((error) => {
    console.error('[claw-schedule-mcp] server failed:', error)
    process.exit(1)
  })
} else {
app.whenReady().then(async () => {
  traceStartup('app.whenReady:start')
  if (!gotSingleInstanceLock) return

  try {
    const cleared = await clearDevelopmentRendererHttpCache(
      session.defaultSession,
      devServerHintUrl()
    )
    if (cleared) traceStartup('development renderer HTTP cache cleared')
  } catch (error) {
    console.warn('[kun-gui] failed to clear the development renderer HTTP cache:', error)
  }

  if (process.platform === 'darwin') {
    const macDockIcon = createAppIcon(kunMacLogoPng)
    app.dock?.setIcon(macDockIcon.isEmpty() ? appIcon : macDockIcon)
  }

  store = new JsonSettingsStore(app.getPath('userData'), {
    credentialMigration: new LegacyProviderSettingsMigrationCoordinator()
  })
  traceStartup('settings load:start')
  const initial = await store.load()
  traceStartup('settings load:done')
  const extensionDescriptors = new ExtensionDescriptorResolver(async (path, method, body) => {
    const settings = await store.load()
    return runtimeRequest(settings, path, { method, body })
  })
  const registerExtensionProtocol = (targetProtocol: typeof protocol): void => {
    registerKunExtensionProtocol({
      protocol: targetProtocol,
      resolveDescriptor: (extensionId) => extensionDescriptors.resolveResourceDescriptor(extensionId),
      onDenied: ({ extensionId, code }) => {
        logWarn('extension-protocol', 'Denied extension resource request.', { extensionId, code })
      }
    })
  }
  registerExtensionProtocol(protocol)

  const extensionProtocolForPartition = (partition: string) => session.fromPartition(partition).protocol
  const extensionMediaProtocols = new ExtensionMediaProtocolRegistry({
    sessions: extensionViewSessions,
    protocolForPartition: extensionProtocolForPartition,
    onDenied: ({ extensionId, sessionId, code }) => {
      logWarn('extension-media-protocol', 'Denied isolated View media request.', {
        extensionId,
        sessionId,
        code
      })
    }
  })
  const extensionViewProtocols = new ExtensionViewProtocolRegistry(
    extensionProtocolForPartition,
    ({ extensionId, code, sessionId }) => {
      logWarn('extension-protocol', 'Denied isolated View resource request.', {
        extensionId,
        code,
        sessionId
      })
    },
    extensionMediaProtocols
  )

  traceStartup('install webview guards:start')
  installDevPreviewWebviewGuards({
    viewProtocols: extensionViewProtocols
  })
  traceStartup('install webview guards:done')
  const extensionConsentTokens = new ExtensionConsentTokenService()
  protectedCredentialSurface = new ProtectedCredentialSurfaceController(
    resolveNamedPreloadPath(__dirname, 'extension-protected-surface')
  )
  protectedCredentialSurface.register()
  const protectedExtensionActions = new ProtectedExtensionActionService(
    extensionConsentTokens,
    async (binding, copy) => {
      const settings = await store.load()
      const prompt = localizeProtectedExtensionPrompt(binding, copy, settings.locale)
      const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
      return protectedCredentialSurface!.promptConsent(parent ?? null, {
        ...prompt,
        extensionValue: `${binding.extensionId} ${binding.extensionVersion}`,
        operationValue: binding.operationKind,
        ...(binding.workspaceRoot ? { workspaceValue: binding.workspaceRoot } : {})
      })
    }
  )
  const extensionContentScripts = new ExtensionContentScriptController(extensionDescriptors, {
    onDiagnostic: (diagnostic) => {
      logWarn('extension-content-script', diagnostic.message, {
        code: diagnostic.code,
        extensionId: diagnostic.extensionId,
        extensionVersion: diagnostic.extensionVersion,
        contributionId: diagnostic.contributionId,
        workspaceScope: diagnostic.workspaceScope,
        at: diagnostic.at
      })
    }
  })
  setKunUnexpectedExitHandler(handleUnexpectedKunExit)
  appBehavior = initial.appBehavior
  syncLoginItemSettings(initial)
  syncTray(initial)
  await syncClawScheduleMcpConfig(initial, getClawScheduleMcpLaunchConfig()).catch((error) => {
    console.error('[claw-schedule-mcp] failed to sync config on startup:', error)
  })

  logDir = resolveLogDirectory(app)
  configureLogger({
    dir: logDir,
    enabled: initial.log.enabled,
    retentionDays: initial.log.retentionDays
  })
  traceStartup('logger configured')
  syncCheckpointCleanupTimer(initial)
  scheduleRuntime = createScheduleRuntime({ store, runtimeRequest, logError, powerSaveBlocker })
  scheduleRuntime.sync(initial)
  workflowRuntime = createWorkflowRuntime({ store, runtimeRequest, logError, powerSaveBlocker })
  workflowRuntime.sync(initial)
  // Telegram runtime is created first so ClawRuntime can reference it via deps.
  // The onInbound callback closes over the module-level clawRuntime, which is
  // assigned on the next line — by the time an update arrives the reference is set.
  telegramRuntime = createTelegramRuntime({
    store,
    logError,
    onInbound: (payload) => clawRuntime?.handleTelegramUpdate(payload)
  })
  clawRuntime = createClawRuntime({
    store,
    runtimeRequest,
    logError,
    notifyChannelActivity: emitClawChannelActivity,
    sendWeixinBridgeMessage,
    resolveWeixinAccountUserId: getWeixinBridgeAccountUserId,
    telegramRuntime,
    createScheduledTaskFromText: (text, options) =>
      scheduleRuntime?.createScheduledTaskFromText(text, options) ?? Promise.resolve({ kind: 'noop' })
  })
  clawRuntime.sync(initial)
  // ClawRuntime.sync delegates Telegram reconciliation to telegramRuntime.sync,
  // so the long-poll loops start as part of the call above. The explicit sync
  // here is a no-op when settings are unchanged, kept for clarity.
  telegramRuntime.sync(initial)
  configureWeixinBridgeRuntimeContextProvider(async () => {
    const settings = await store.load()
    const channel = settings.claw.channels.find((item) => item.enabled && item.provider === 'weixin')
    return {
      webhookUrl: webhookUrl(settings),
      webhookSecret: settings.claw.im.secret,
      channelId: channel?.id ?? ''
    }
  })
  configureManagedWeixinBridgeUrlResolver(ensureWeixinBridgeRpcUrl)
  syncWeixinBridgeRuntime(initial)

  traceStartup('ipc registration:start')
  let publishExtensionWorkbenchEnvironmentChanged = async (): Promise<void> => undefined
  const requestExtensionWorkbenchEnvironmentPublish = (): void => {
    void publishExtensionWorkbenchEnvironmentChanged().catch((error) => {
      logWarn('extension-workbench', 'Failed to publish extension workbench environment.', {
        message: error instanceof Error ? error.message : String(error)
      })
    })
  }
  const applySettingsPatch = async (partial: AppSettingsPatch): Promise<AppSettingsV1> => {
    const prev = await store.load()
    const effectivePartial = preserveRuntimeTokenForFullSettingsSnapshot(prev, partial)
    const { agents: agentsPatch, provider: providerPatch, ...restPatch } = effectivePartial
    const next = normalizeAppSettings({
      ...applyKunRuntimePatch(prev, agentsPatch?.kun),
      ...restPatch,
      provider: mergeModelProviderSettings(prev.provider, providerPatch),
      log: { ...prev.log, ...(effectivePartial.log ?? {}) },
      checkpointCleanup: normalizeCheckpointCleanupSettings({
        ...prev.checkpointCleanup,
        ...(effectivePartial.checkpointCleanup ?? {})
      }),
      notifications: { ...prev.notifications, ...(effectivePartial.notifications ?? {}) },
      appBehavior: mergeAppBehaviorSettings(prev.appBehavior, effectivePartial.appBehavior),
      keyboardShortcuts: normalizeKeyboardShortcuts({
        bindings: {
          ...prev.keyboardShortcuts.bindings,
          ...(effectivePartial.keyboardShortcuts?.bindings ?? {})
        }
      }),
      write: mergeWriteSettings(prev.write, effectivePartial.write),
      claw: mergeClawSettings(prev.claw, effectivePartial.claw),
      schedule: mergeScheduleSettings(prev.schedule, effectivePartial.schedule),
      workflow: mergeWorkflowSettings(prev.workflow, effectivePartial.workflow),
      design: mergeDesignSettings(prev.design, effectivePartial.design),
      terminal: mergeTerminalSettings(prev.terminal, effectivePartial.terminal),
      guiUpdate: { ...prev.guiUpdate, ...(effectivePartial.guiUpdate ?? {}) }
    })
    if (prev.log.enabled !== next.log.enabled || prev.log.retentionDays !== next.log.retentionDays) {
      configureLogger({ enabled: next.log.enabled, retentionDays: next.log.retentionDays })
    }
    const runtimeValidationError = validateRuntimeSettingsForApply(next)
    if (runtimeValidationError) {
      throw new Error(`Invalid runtime settings: ${runtimeValidationError}`)
    }
    const saved = await store.patch(effectivePartial)
    await syncClawScheduleMcpConfig(saved, getClawScheduleMcpLaunchConfig()).catch((error) => {
      console.error('[claw-schedule-mcp] failed to sync config after settings change:', error)
    })
    if (prev.guiUpdate.channel !== saved.guiUpdate.channel && guiUpdaterModulePromise) {
      void guiUpdaterModulePromise.then((module) => module.setGuiUpdateChannel(saved.guiUpdate.channel))
    }
    queueRuntimeSettingsApply(prev, saved)
    try {
      scheduleRuntime?.sync(saved)
      workflowRuntime?.sync(saved)
      clawRuntime?.sync(saved)
    } catch (error) {
      logError('settings-apply', 'failed to sync schedule/claw runtimes after settings change', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
    syncWeixinBridgeRuntime(saved)
    syncLoginItemSettings(saved)
    syncTray(saved)
    syncCheckpointCleanupTimer(saved)
    requestExtensionWorkbenchEnvironmentPublish()
    return saved
  }

  const fetchModels = async () => {
    const settings = await store.load()
    const key = resolveConfiguredApiKey(settings)
    return fetchUpstreamModelIds(settings, key)
  }

  const saveSettingsPatch = async (partial: AppSettingsPatch): Promise<AppSettingsV1> => {
    const saved = await store.patch(preserveRuntimeTokenForFullSettingsSnapshot(await store.load(), partial))
    requestExtensionWorkbenchEnvironmentPublish()
    return saved
  }

  registerAppIpcHandlers({
    store,
    getMainWindow: () => mainWindow,
    applySettingsPatch,
    saveSettingsPatch,
    runtimeRequest: async (path, method, body, headers) => {
      const settings = await store.load()
      return runtimeRequest(settings, path, { method, body, headers })
    },
    restartRuntime: async () => {
      const settings = await store.load()
      await restartRuntime(settings)
    },
    fetchUpstreamModels: fetchModels,
    getClawRuntime: () => clawRuntime,
    getScheduleRuntime: () => scheduleRuntime,
    getWorkflowRuntime: () => workflowRuntime,
    startFeishuInstallQrcode,
    pollFeishuInstall,
    startWeixinInstallQrcode,
    pollWeixinInstall,
    resolveKunConfigPath: resolveKunMcpJsonPath,
    onKunMcpConfigWritten: async () => {
      const settings = await store.load()
      queueRuntimeMcpConfigApply(settings)
    },
    onKunProjectConfigChanged: async () => {
      const settings = await store.load()
      queueRuntimeMcpConfigApply(settings)
    },
    showTurnCompleteNotification,
    getAppVersion: () => app.getVersion(),
    readGuiUpdateState,
    loadGuiUpdaterModule,
    resolveLogDirectory: () => resolveLogDirectory(app),
    logError
  })
  const dataMigrationController = new DataMigrationController({
    userDataPath: app.getPath('userData'),
    store,
    getMainWindow: () => mainWindow,
    runtimeFetch: async (path, init = {}) => {
      const settings = await store.load()
      const ensured = await ensureRuntime(settings)
      const requestSettings = ensured ?? settings
      const headers = runtimeAuthHeaders(requestSettings)
      new Headers(init.headers).forEach((value, key) => headers.set(key, value))
      const normalizedPath = path.startsWith('/') ? path : `/${path}`
      return fetch(`${getRuntimeBaseUrlForSettings(requestSettings)}${normalizedPath}`, {
        ...init,
        headers
      } as RequestInit)
    },
    sourceInstallationId: `installation_${createHash('sha256').update(app.getPath('userData')).digest('hex').slice(0, 24)}`,
    sourceAppVersion: app.getVersion(),
    sourceRuntimeVersion: app.getVersion(),
    featureEnabled: process.env.KUN_DATA_MIGRATION_ENABLED === '1' ||
      (process.env.KUN_DATA_MIGRATION_ENABLED !== '0' && !app.isPackaged)
  })
  dataMigrationController.registerIpc()
  const extensionIpcOptions: RegisterExtensionIpcHandlersOptions = {
    getMainWindow: () => mainWindow,
    runtimeRequest: async (path, method, body, headers) => {
      const settings = await store.load()
      return runtimeRequest(settings, path, { method, body, headers })
    },
    descriptors: extensionDescriptors,
    viewSessions: extensionViewSessions,
    viewProtocols: extensionViewProtocols,
    externalBrowsers: extensionExternalBrowsers,
    mediaProtocols: extensionMediaProtocols,
    protectedActions: protectedExtensionActions,
    credentialSurface: protectedCredentialSurface,
    contentScripts: extensionContentScripts,
    getWorkbenchEnvironment: async () => {
      const settings = await store.load()
      let reducedMotion = false
      try {
        reducedMotion = systemPreferences.getAnimationSettings().prefersReducedMotion
      } catch {
        // Some Linux desktop environments do not expose animation settings.
      }
      return createExtensionWorkbenchEnvironment({
        themePreference: settings.theme,
        systemDark: nativeTheme.shouldUseDarkColors,
        highContrast: nativeTheme.shouldUseHighContrastColors,
        zoomFactor: mainWindow && !mainWindow.isDestroyed()
          ? mainWindow.webContents.getZoomFactor()
          : 1,
        reducedMotion,
        locale: settings.locale
      })
    },
    logError
  }
  const extensionIpcRegistration = registerExtensionIpcHandlers(extensionIpcOptions)
  publishExtensionWorkbenchEnvironmentChanged = () =>
    extensionIpcRegistration.publishWorkbenchEnvironmentChanged()
  const onNativeThemeUpdated = (): void => {
    requestExtensionWorkbenchEnvironmentPublish()
  }
  const onWorkbenchZoomChanged = (): void => {
    requestExtensionWorkbenchEnvironmentPublish()
  }
  bindExtensionMainWindow = (window) => {
    extensionIpcRegistration.bindMainWindow(window)
    window.webContents.on('zoom-changed', onWorkbenchZoomChanged)
  }
  nativeTheme.on('updated', onNativeThemeUpdated)
  requestExtensionWorkbenchEnvironmentPublish()
  const stopSecretRevealConsentPump = startExtensionSecretRevealConsentPump(
    extensionIpcOptions
  )
  const stopExtensionNotificationPump = startExtensionNotificationPump(
    extensionIpcOptions
  )
  app.once('before-quit', () => {
    stopSecretRevealConsentPump()
    stopExtensionNotificationPump()
    extensionIpcRegistration.dispose()
    extensionExternalBrowsers.destroy()
    bindExtensionMainWindow = undefined
    nativeTheme.removeListener('updated', onNativeThemeUpdated)
    mainWindow?.webContents.removeListener('zoom-changed', onWorkbenchZoomChanged)
  })

  void loadGuiUpdaterModule().catch((error) => {
    console.warn('[kun-gui updater] failed to initialize on startup:', error)
  })

  registerRuntimeSseIpc({ ipcMain, store, ensureRuntime, logError })

  registerTerminalPtyIpc({
    ipcMain,
    getMainWindow: () => mainWindow,
    logError,
    getTerminalColorMode: async () => resolveTerminalColorMode(await store.load())
  })
  traceStartup('ipc registration:done')

  createWindow({ suppressInitialShow: shouldStartHidden(initial) })
  traceStartup('createWindow:returned')
  void loadGuiUpdaterModule()
    .then((module) => module.showPostUpdateReleaseNotes())
    .catch((error) => {
      console.warn('[kun-gui updater] failed to show post-update release notes:', error)
    })

  void pruneOnStartup().catch((err) => {
    console.warn('[kun-gui] prune logs:', err)
  })

  if (resolveConfiguredApiKey(initial)) {
    setTimeout(() => {
      void kunRuntimeAdapter.resolveExecutable(initial).catch((err) => {
        console.warn('[kun-gui] prewarm Kun binary:', err)
      })
    }, 1500)
  }

  app.on('second-instance', () => {
    revealMainWindow()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else revealMainWindow()
  })
}).catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[kun-gui] startup failed:', error)
  dialog.showErrorBox('Kun failed to start', message)
  app.quit()
})
}

app.on('window-all-closed', () => {
  void stopManagedRuntimes().catch((error) => {
    console.warn('[kun-gui] failed to stop Kun runtime:', error)
  })
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  runtimeShutdown.requestQuit()
  protectedCredentialSurface?.dispose()
  stopRuntimeWatchdog()
  stopCheckpointCleanupTimer()
  if (runtimeShutdown.isStoppedForQuit) return
  event.preventDefault()
  void stopManagedRuntimesForQuit()
    .catch((error) => {
      console.warn('[kun-gui] failed to stop Kun runtime:', error)
    })
    .finally(() => {
      app.quit()
    })
})
