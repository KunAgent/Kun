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
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
  type ContextMenuParams,
  type MenuItemConstructorOptions
} from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  JsonSettingsStore,
  devServerHintUrl
} from './settings-store'
import kunLogoPng from '../asset/img/kun.png?url'
import kunMacLogoPng from '../asset/img/kun_mac.png?url'
import kunTrayPng from '../asset/img/kun_tray.png?url'
import kunTrayMacPng from '../asset/img/kun_tray_mac.png?url'
import kunTrayMacRetinaPng from '../asset/img/kun_tray_mac@2x.png?url'
import {
  createAppIcon,
  createMultiScaleIcon,
  notificationIconOptions,
  pickTrayIcon,
  prepareTrayIcon
} from './app-icon'
import { buildTrayMenuTemplate, parseTrayThreads, type TrayThreadSummary } from './tray-session-menu'
import { requestRuntimeProviderQuotas } from './runtime-provider-quota'
import { registerTrayQuotaIpc } from './tray-quota-ipc'
import {
  resolveTrayQuotaAnchorBounds,
  resolveTrayQuotaPopoverPosition
} from './tray-quota-position'
import { TRAY_PROVIDER_QUOTA_CHANNELS } from '../shared/tray-provider-quota'
import { configureLinuxWaylandImeSwitches } from './app-command-line'
import {
  clearDevelopmentRendererHttpCache,
  configureDevelopmentRendererHttpCache,
  reloadRenderer
} from './dev-renderer-cache'
import {
  configureAppIdentity,
  configureDesktopSmokeAppDataPath,
  readPackagedAppFlavor
} from './app-identity'
import { shouldStartHidden, syncLoginItemSettings } from './desktop-behavior'
import { resolveLogDirectory, resolveNamedPreloadPath, resolvePreloadPath } from './main-paths'
import {
  HOME_DATA_MIGRATION_MAPPINGS,
  migrateLegacyHomeDataDirs,
  migrateLegacyUserDataDir,
  rewriteLegacyPathsInSettingsFile
} from './legacy-data-migration'
import {
  markCanonicalKunRuntimeMigrationRuntimeVerified,
  runCanonicalKunRuntimeDataMigration
} from './runtime-data-dir-migration'
import { assertNoActiveKunRuntimeUsingDataDir } from './runtime-data-dir-ownership'
import {
  LegacyProviderSettingsMigrationCoordinator,
  resolveSettingsDataDir
} from './legacy-provider-settings-migration'
import { resetUnreadableWindowsCredentials } from './credential-recovery'
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
import type {
  KunRuntimeSettingsSyncStatusPayload,
  TrayActionPayload,
  TurnCompleteNotificationPayload
} from '../shared/kun-gui-api'
import { isAllowedDevPreviewUrl } from '../shared/dev-preview-url'
import { isAuthorizedPrototypeFileUrl } from './services/prototype-embed-registry'
import { fetchUpstreamModelIds, modelListFromSharedConnections } from './upstream-models'
import {
  kunRuntimeAdapter,
  getRuntimeBaseUrlForSettings,
  getRuntimeAuthToken,
  runtimeAuthHeaders,
  runtimeRequestViaHost,
  type RuntimeRequestInit
} from './runtime/kun-adapter'
import { waitForRuntimeTurnsIdle } from './runtime/managed-runtime-idle'
import {
  isKunChildRunning,
  resolveKunDataDir,
  setKunUnexpectedExitHandler,
  syncGuiManagedKunConfig,
  waitForKunStartupSettled,
  ensureKunServiceManager,
  type KunUnexpectedExitInfo
} from './kun-process'
import { SETTINGS_FILE_NAME } from './settings-file-paths'
import {
  ManagerResourceLeaseClient,
  ManagerRevisionedDocumentClient,
  readManagerRuntime,
  requestManagerJson,
  type ServiceManagerConnection
} from '../../kun/src/manager/manager-client.js'
import { stopSharedRuntime } from '../../kun/src/cli/shared-runtime.js'
import { expandHomePath } from './settings-store'
import { KunRuntimeSupervisor, type KunRuntimeStatus } from './kun-runtime-supervisor'
import { managedKunHostCanAutoStart } from './managed-runtime-startup-policy'
import { configureLogger, logError, logInfo, logWarn, pruneOnStartup } from './logger'
import { NativeDialogCoordinator } from './native-dialog-coordinator'
import { cleanupUnusedGitCheckpointsIfDue } from './services/git-checkpoint-service'
import { resolveMainWindowCloseDecision } from './window-close-behavior'
import { turnCompleteNotificationDisabledReason } from './notification-preferences'
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
import { StorageRelocationController } from './storage-relocation/controller'
import { StorageRelocationEngine } from './storage-relocation/engine'
import { storageRelocationFeatureEnabled } from './storage-relocation/feature-policy'
import { storageRelocationControlRoot } from './storage-relocation/paths'
import {
  activeStorageRelocationRequiresRecovery,
  pendingStorageRelocationOperationId,
  storageRelocationMetadataIsInvalid
} from './storage-relocation/store'
import type {
  StorageRelocationActiveWork,
  StorageRelocationProgress
} from '../shared/storage-relocation'
import { runClawScheduleMcpServerFromArgv } from './claw-schedule-mcp-server'
import {
  resolveClawScheduleMcpCommand,
  resolveKunMcpJsonPath,
  syncClawScheduleMcpConfig,
  type ClawScheduleMcpLaunchConfig
} from './claw-schedule-mcp-config'
import {
  runtimeProcessConfigChanged,
  runtimeSettingsRollbackPatch,
  runtimeSettingsApplyMode,
  stableSettingsStringify
} from './runtime-settings-apply-mode'
import { registerAppIpcHandlers } from './ipc/register-app-ipc-handlers'
import { DataMigrationController } from './data-migration/data-migration-controller'
import { resolveDataMigrationFeatureEnabled } from './data-migration/feature-policy'
import {
  configureManagedWeixinBridgeUrlResolver,
  pollFeishuInstall,
  pollWeixinInstall,
  startFeishuInstallQrcode,
  startWeixinInstallQrcode
} from './claw-platform-install'
import { registerRuntimeSseIpc } from './runtime-sse-ipc'
import { registerTerminalPtyIpc, type TerminalPtyController } from './terminal/terminal-pty-ipc'
import { maybePromptCliInstall, registerCliInstallIpc } from './cli-install-service'
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
import { inspectPackagedInstallHealth } from './packaged-install-health'
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
import { WorkspacePreviewProtocolRegistry } from './services/workspace-preview-protocol'
import {
  configureBrowserUseHost,
  stopBrowserUseHost,
  updateBrowserUseHostSettings
} from './browser-use/browser-use-host'
import {
  configureComputerUseHost,
  stopComputerUseHost,
  updateComputerUseHostSettings
} from './computer-use/computer-use-host'
import { registerBrowserUseIpc } from './browser-use/register-browser-use-ipc'
import { browserUseCleanupForRuntimeRequest } from './browser-use/thread-lifecycle'
import {
  appWindowTitleForFlavor,
  createAppEnvironmentInfo,
  resolveAppFlavor
} from '../shared/app-environment'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Compare only the immutable renderer origin and entry document; query/hash are UI state. */
function isTrustedWorkbenchUrl(candidate: string, trustedRendererUrl: string): boolean {
  try {
    const actual = new URL(candidate)
    const expected = new URL(trustedRendererUrl)
    return actual.protocol === expected.protocol &&
      actual.username === expected.username &&
      actual.password === expected.password &&
      actual.host === expected.host &&
      normalizeWorkbenchPathname(actual.pathname) === normalizeWorkbenchPathname(expected.pathname)
  } catch {
    return false
  }
}

function normalizeWorkbenchPathname(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

function developmentRendererUrl(): string | undefined {
  return devServerHintUrl(app.isPackaged)
}

registerKunExtensionPlatformSchemesAsPrivileged(protocol)
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

const MAX_SHARED_CLIENT_STATE_ENTRIES = 64
const MAX_SHARED_CLIENT_STATE_VALUE_BYTES = 2 * 1024 * 1024

function parseSharedClientState(raw: string | null): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const entries: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'string') continue
      if (Buffer.byteLength(value, 'utf8') > MAX_SHARED_CLIENT_STATE_VALUE_BYTES) continue
      entries[key] = value
    }
    return entries
  } catch {
    return {}
  }
}

function parseSharedClientStateWrite(input: unknown): {
  expectedRevision: number
  entries: Record<string, string>
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('invalid shared client state write')
  }
  const source = input as { expectedRevision?: unknown; entries?: unknown }
  if (!Number.isSafeInteger(source.expectedRevision) || Number(source.expectedRevision) < 0) {
    throw new Error('invalid shared client state revision')
  }
  if (!source.entries || typeof source.entries !== 'object' || Array.isArray(source.entries)) {
    throw new Error('invalid shared client state entries')
  }
  const values = Object.entries(source.entries)
  if (values.length > MAX_SHARED_CLIENT_STATE_ENTRIES) throw new Error('too many shared client state entries')
  const entries: Record<string, string> = {}
  for (const [key, value] of values) {
    if (!/^kun\.[A-Za-z0-9._:-]{1,160}$/u.test(key) || typeof value !== 'string') {
      throw new Error('invalid shared client state entry')
    }
    if (Buffer.byteLength(value, 'utf8') > MAX_SHARED_CLIENT_STATE_VALUE_BYTES) {
      throw new Error('shared client state entry is too large')
    }
    entries[key] = value
  }
  return { expectedRevision: Number(source.expectedRevision), entries }
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
const appFlavor = resolveAppFlavor({
  argv: process.argv,
  env: process.env,
  packagedFlavor: app.isPackaged ? readPackagedAppFlavor(app.getAppPath()) : undefined
})
const desktopSmokeAppDataPath = configureDesktopSmokeAppDataPath()
const appIdentity = configureAppIdentity({
  flavor: appFlavor,
  appDataPath: desktopSmokeAppDataPath ?? app.getPath('appData')
})
process.env.KUN_APP_FLAVOR = appIdentity.flavor
process.env.KUN_RUNTIME_FLAVOR = appIdentity.runtimeFlavor
if (appIdentity.flavor === 'development') {
  process.title = appIdentity.appName
  app.commandLine.appendSwitch('kun-app-flavor', appIdentity.flavor)
}

// 紧跟在身份设置之后、requestSingleInstanceLock() 之前做旧数据迁移:
// 单实例锁文件就放在 userData 里,必须先把目录定下来。rename 失败
// (典型场景:老版本还在运行)时退回旧目录,功能不受影响,下次再迁。
const legacyUserDataMigration = appIdentity.flavor === 'production'
  ? migrateLegacyUserDataDir({
      userDataPath: app.getPath('userData'),
      log: (message, detail) => console.warn(`[kun-gui] ${message}`, detail ?? '')
    })
  : {
      userDataPath: app.getPath('userData'),
      migrated: false,
      usedLegacyFallback: false
    }
if (legacyUserDataMigration.usedLegacyFallback) {
  app.setPath('userData', legacyUserDataMigration.userDataPath)
}
const appEnvironment = createAppEnvironmentInfo({
  identity: appIdentity,
  profilePath: app.getPath('userData'),
  isPackaged: app.isPackaged
})
traceStartup('legacy userData migration checked', {
  appFlavor: appEnvironment.flavor,
  appName: appEnvironment.appName,
  userDataPath: legacyUserDataMigration.userDataPath,
  migratedUserData: legacyUserDataMigration.migrated,
  usedLegacyFallback: legacyUserDataMigration.usedLegacyFallback
})

configureLinuxWaylandImeSwitches()
configureDevelopmentRendererHttpCache(app.commandLine, developmentRendererUrl())

if (!runningClawScheduleMcpServer && process.platform === 'win32') {
  app.setAppUserModelId(appIdentity.appId)
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
let trayQuotaWindow: BrowserWindow | null = null
let trayQuotaWindowReady: Promise<void> | null = null
let trayQuotaToggleGeneration = 0
let disposeTrayQuotaIpc: (() => void) | null = null
let closeWindowPromptOpen = false
const nativeDialogCoordinator = new NativeDialogCoordinator()
let checkpointCleanupTimer: ReturnType<typeof setInterval> | null = null
const extensionViewSessions = new ExtensionViewSessionRegistry()
const extensionExternalBrowsers = new ExtensionExternalBrowserManager(extensionViewSessions)
let protectedCredentialSurface: ProtectedCredentialSurfaceController | null = null
let bindExtensionMainWindow: ((window: BrowserWindow) => void) | undefined
let shutdownDesktopResourceLeases: (() => Promise<void>) | null = null
let terminalPtyController: TerminalPtyController | null = null
let activeServiceManager: ServiceManagerConnection | null = null

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

async function runCheckpointCleanup(
  settings: AppSettingsV1,
  options: { force?: boolean; reason?: string } = {}
): Promise<void> {
  try {
    assertCanonicalRuntimeMigrationReady()
    const force = options.force === true
    const reason = options.reason ?? (force ? 'forced' : 'interval')
    // Startup / upgrade retention always runs. The settings toggle only gates the
    // periodic background timer so a previous "cleanup off" cannot leave gigabytes
    // of stale checkpoints behind after relaunch or app update.
    if (!force && !settings.checkpointCleanup.enabled) return
    const runtime = resolveKunRuntimeSettings(settings)
    const dataDir = resolveKunDataDir(runtime)
    const intervalDays = settings.checkpointCleanup.intervalDays
    const checkpointsRoot = settings.checkpointCleanup.directory?.trim()
      ? expandHomePath(settings.checkpointCleanup.directory.trim())
      : undefined
    const maxPerThread = settings.checkpointCleanup.maxPerThread
    const cleanup = await cleanupUnusedGitCheckpointsIfDue({
      dataDir,
      intervalDays,
      appVersion: app.getVersion(),
      ...(force ? { force: true } : {}),
      ...(checkpointsRoot ? { checkpointsRoot } : {}),
      ...(maxPerThread !== undefined ? { maxPerThread } : {})
    })
    if (!cleanup.due) return
    const { result } = cleanup
    console.info(
      `[kun-gui] git checkpoint cleanup reason=${reason} scanned=${result.scanned} deleted=${result.deleted} kept=${result.kept} failed=${result.failed}`
    )
    if (result.failed > 0) {
      logWarn('git-checkpoint-cleanup', 'failed to delete some unused checkpoints', {
        failed: result.failed,
        failedIds: result.failedIds,
        reason
      })
    }
  } catch (error) {
    logWarn('git-checkpoint-cleanup', 'failed to clean unused checkpoints', {
      message: error instanceof Error ? error.message : String(error),
      reason: options.reason ?? (options.force ? 'forced' : 'interval')
    })
  }
}

function syncCheckpointCleanupTimer(settings: AppSettingsV1): void {
  stopCheckpointCleanupTimer()
  if (!settings.checkpointCleanup.enabled) return
  const intervalMs = settings.checkpointCleanup.intervalDays * 24 * 60 * 60 * 1_000
  // Interval / version-upgrade passes only. The forced startup pass is scheduled
  // earlier in app.whenReady so retention does not wait on the interval gate.
  checkpointCleanupTimer = setInterval(() => {
    void runCheckpointCleanup(settings, { reason: 'interval' })
  }, intervalMs)
  checkpointCleanupTimer.unref?.()
}

const runtimeShutdown = new ManagedRuntimeShutdownCoordinator(async () => {
  terminalPtyController?.disposeAll()
  await shutdownDesktopResourceLeases?.()
  shutdownDesktopResourceLeases = null
  await scheduleRuntime?.stop()
  await workflowRuntime?.stop()
  await Promise.all([
    clawRuntime?.stop(),
    telegramRuntime?.stop()
  ])
  await stopWeixinBridgeRuntime()
  await shutdownLocalWhisperService()
  // The shared Kun service outlives ordinary GUI/TUI clients. Only an update
  // install must stop it so old application files can be replaced safely.
  if (runtimeShutdown.isUpdateInstallQuit || runtimeShutdown.isStorageRelocationQuit) {
    const settings = await store.load()
    await kunRuntimeAdapter.stopSharedAndWait(settings)
    if (runtimeShutdown.isUpdateInstallQuit) {
      await shutdownActiveServiceManagerForUpdate()
    }
    if (runtimeShutdown.isStorageRelocationQuit) {
      const dataDir = resolveKunDataDir(resolveKunRuntimeSettings(settings))
      await Promise.all([
        stopSharedRuntime(dataDir, fetch, { runtimeFlavor: 'production' }),
        stopSharedRuntime(dataDir, fetch, { runtimeFlavor: 'development' })
      ])
    }
  }
  await Promise.all([
    stopBrowserUseHost(),
    stopComputerUseHost()
  ])
})

function stopManagedRuntimesForQuit(): Promise<void> {
  return runtimeShutdown.stopForQuit()
}

function stopManagedRuntimes(): Promise<void> {
  return runtimeShutdown.stop()
}

function prepareManagedRuntimesForUpdate(): Promise<void> {
  return runtimeShutdown.prepareForUpdate()
}

function isPackagedExtensionDesktopSmoke(): boolean {
  return process.env.KUN_PACKAGED_EXTENSION_DESKTOP_SMOKE === '1'
}

async function loadGuiUpdaterModule(): Promise<GuiUpdaterModule> {
  // The packaged Extension smoke owns an isolated profile and must not make a
  // networked update check while it is validating the renderer process.
  if (isPackagedExtensionDesktopSmoke()) return import('./gui-updater')
  if (!guiUpdaterModulePromise) {
    guiUpdaterModulePromise = import('./gui-updater')
      .then((module) => {
        if (!guiUpdaterInitialized) {
          module.initializeGuiUpdater(
            () => mainWindow,
            async () => (await store.load()).guiUpdate.channel,
            prepareManagedRuntimesForUpdate,
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
const trayIcon = process.platform === 'darwin'
  ? createMultiScaleIcon(kunTrayMacPng, kunTrayMacRetinaPng)
  : createAppIcon(kunTrayPng)
traceStartup('app icon loaded', { source: appIconSource.startsWith('data:') ? 'data-url' : 'path' })
const gotSingleInstanceLock = runningClawScheduleMcpServer || app.requestSingleInstanceLock()
traceStartup('single instance lock checked', {
  gotSingleInstanceLock,
  skippedForClawScheduleMcpServer: runningClawScheduleMcpServer
})
const pendingStorageRelocationId = gotSingleInstanceLock &&
  !runningClawScheduleMcpServer &&
  appIdentity.flavor === 'production'
  ? pendingStorageRelocationOperationId(
      storageRelocationControlRoot(app.getPath('userData'))
    )
  : null
const storageRelocationRecoveryRequired = Boolean(pendingStorageRelocationId) || (
  gotSingleInstanceLock &&
  !runningClawScheduleMcpServer &&
  appIdentity.flavor === 'production' &&
  (
    storageRelocationMetadataIsInvalid(storageRelocationControlRoot(app.getPath('userData'))) ||
    activeStorageRelocationRequiresRecovery(
      storageRelocationControlRoot(app.getPath('userData')),
      homedir()
    )
  )
)
const startupMigrationLog = (message: string, detail?: unknown): void => {
  console.warn(`[kun-gui] ${message}`, detail ?? '')
}
const canonicalRuntimeMigration = gotSingleInstanceLock &&
  !runningClawScheduleMcpServer &&
  !storageRelocationRecoveryRequired &&
  appIdentity.flavor === 'production'
  ? runCanonicalKunRuntimeDataMigration({
      userDataPath: app.getPath('userData'),
      homeDir: homedir(),
      log: startupMigrationLog,
      assertLegacyRuntimeInactive: (sourcePath) =>
        assertNoActiveKunRuntimeUsingDataDir(sourcePath)
    })
  : null
const remainingHomeMappings = HOME_DATA_MIGRATION_MAPPINGS.filter(
  (mapping) => mapping.legacySegments.join('/') !== '.deepseekgui/kun'
)
const remainingHomeMigration = gotSingleInstanceLock &&
  !runningClawScheduleMcpServer &&
  !storageRelocationRecoveryRequired &&
  appIdentity.flavor === 'production'
  ? migrateLegacyHomeDataDirs({
      homeDir: homedir(),
      mappings: remainingHomeMappings,
      log: startupMigrationLog
    })
  : []
const remainingSettingsRewritten = gotSingleInstanceLock &&
  !runningClawScheduleMcpServer &&
  !storageRelocationRecoveryRequired &&
  appIdentity.flavor === 'production'
  ? rewriteLegacyPathsInSettingsFile({
      userDataPath: app.getPath('userData'),
      homeDir: homedir(),
      mappings: remainingHomeMigration
        .filter((entry) => entry.rewriteSafe)
        .map((entry) => entry.mapping),
      log: startupMigrationLog
    })
  : false
traceStartup('post-lock legacy home migration checked', {
  runtimeStatus: canonicalRuntimeMigration?.status ?? 'skipped',
  runtimeBackupPath: canonicalRuntimeMigration?.destinationBackupPath,
  runtimeMessage: canonicalRuntimeMigration?.message,
  remainingSettingsRewritten
})

function assertCanonicalRuntimeMigrationReady(): void {
  if (canonicalRuntimeMigration?.status !== 'blocked') return
  throw runtimeJsonError(
    'policy_blocked',
    `Kun Runtime data migration could not finish safely. Historical data was preserved and ` +
    `managed Runtime writes are blocked until recovery succeeds. ` +
    `${canonicalRuntimeMigration.message ?? `See ${canonicalRuntimeMigration.journalPath}.`}`
  )
}

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
      detail: '最小化到托盘会让 Kun 继续在后台运行，不会影响当前任务。退出应用会关闭桌面端及仅桌面服务；共享 Kun 运行时会继续等待审批，可在下次打开桌面端或 TUI 中处理。若运行时重启或所属任务被取消，待审批操作会被取消。',
      minimizeToTray: '最小化到托盘',
      quit: '退出应用',
      cancel: '取消',
      remember: '记住我的选择，不再询问'
    }
  }
  return {
    title: 'Close window',
    message: 'What should Kun do when this window closes?',
    detail: 'Minimize to tray keeps Kun running in the background and does not interrupt the current task. Quitting closes the desktop app and desktop-only services, while the shared Kun runtime continues waiting for approvals that can be handled when the desktop app or TUI is opened again. Pending approvals are cancelled if the runtime restarts or their turn is cancelled.',
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

const TRAY_QUOTA_WINDOW_WIDTH = 420
const TRAY_QUOTA_WINDOW_HEIGHT = 660
const TRAY_QUOTA_WINDOW_MARGIN = 8

function positionTrayQuotaWindow(window: BrowserWindow): void {
  if (!tray || tray.isDestroyed() || window.isDestroyed()) return
  const trayBounds = resolveTrayQuotaAnchorBounds(
    tray.getBounds(),
    screen.getCursorScreenPoint()
  )
  const display = screen.getDisplayMatching(trayBounds)
  const width = Math.max(1, Math.min(
    TRAY_QUOTA_WINDOW_WIDTH,
    display.workArea.width - TRAY_QUOTA_WINDOW_MARGIN * 2
  ))
  const height = Math.max(1, Math.min(
    TRAY_QUOTA_WINDOW_HEIGHT,
    display.workArea.height - TRAY_QUOTA_WINDOW_MARGIN * 2
  ))
  window.setSize(width, height, false)
  const position = resolveTrayQuotaPopoverPosition({
    trayBounds,
    windowSize: { width, height },
    workArea: display.workArea,
    margin: TRAY_QUOTA_WINDOW_MARGIN
  })
  window.setPosition(position.x, position.y, false)
}

async function ensureTrayQuotaWindow(): Promise<BrowserWindow> {
  if (trayQuotaWindow && !trayQuotaWindow.isDestroyed()) {
    await trayQuotaWindowReady
    return trayQuotaWindow
  }

  const window = new BrowserWindow({
    width: TRAY_QUOTA_WINDOW_WIDTH,
    height: TRAY_QUOTA_WINDOW_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    roundedCorners: true,
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    webPreferences: {
      preload: resolveNamedPreloadPath(__dirname, 'tray-quota'),
      contextIsolation: true,
      sandbox: true
    }
  })
  trayQuotaWindow = window
  positionTrayQuotaWindow(window)
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    logError('tray-quota', 'Failed to load tray quota preload.', {
      preloadPath,
      message: error instanceof Error ? error.message : String(error)
    })
  })
  window.on('blur', () => {
    if (!window.webContents.isDevToolsOpened()) window.hide()
  })
  window.on('closed', () => {
    if (trayQuotaWindow === window) {
      trayQuotaWindow = null
      trayQuotaWindowReady = null
    }
  })

  const devUrl = developmentRendererUrl()
  trayQuotaWindowReady = devUrl
    ? (() => {
        const target = new URL(devUrl)
        target.pathname = '/tray-quota.html'
        target.search = ''
        target.hash = ''
        return window.loadURL(target.toString())
      })()
    : window.loadFile(join(__dirname, '../renderer/tray-quota.html'))
  try {
    await trayQuotaWindowReady
  } catch (error) {
    if (!window.isDestroyed()) window.destroy()
    throw error
  }
  return window
}

function hideTrayQuotaPopover(): void {
  trayQuotaToggleGeneration += 1
  if (trayQuotaWindow && !trayQuotaWindow.isDestroyed()) trayQuotaWindow.hide()
}

function destroyTrayQuotaPopover(): void {
  trayQuotaToggleGeneration += 1
  if (trayQuotaWindow && !trayQuotaWindow.isDestroyed()) trayQuotaWindow.destroy()
  trayQuotaWindow = null
  trayQuotaWindowReady = null
}

function notifyTrayQuotaRefresh(): void {
  const window = trayQuotaWindow
  if (!window || window.isDestroyed() || window.webContents.isLoadingMainFrame()) return
  window.webContents.send(TRAY_PROVIDER_QUOTA_CHANNELS.refresh)
}

async function toggleTrayQuotaPopover(): Promise<void> {
  if (trayQuotaWindow?.isVisible()) {
    hideTrayQuotaPopover()
    return
  }
  const generation = ++trayQuotaToggleGeneration
  const window = await ensureTrayQuotaWindow()
  if (
    generation !== trayQuotaToggleGeneration ||
    window.isDestroyed() ||
    !tray ||
    tray.isDestroyed()
  ) return
  positionTrayQuotaWindow(window)
  window.webContents.send(TRAY_PROVIDER_QUOTA_CHANNELS.refresh)
  window.show()
  window.focus()
}

async function loadTrayThreads(settings: AppSettingsV1): Promise<TrayThreadSummary[]> {
  try {
    await kunRuntimeAdapter.resolveConnection(settings)
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
  hideTrayQuotaPopover()
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
    destroyTrayQuotaPopover()
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
    tray.on('click', () => {
      void toggleTrayQuotaPopover().catch((error) => {
        logWarn('tray-quota', 'Failed to toggle tray quota popover.', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    })
    tray.on('double-click', () => {
      hideTrayQuotaPopover()
      revealMainWindow()
    })
    tray.on('right-click', showTrayMenu)
  }

  tray.setToolTip(appEnvironment.appName)
  trayMenu = createTrayMenu(settings, [])
  tray.setContextMenu(null)
  notifyTrayQuotaRefresh()
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
    const result = await nativeDialogCoordinator.run(window.webContents, async () => {
      if (window.isDestroyed()) {
        throw new Error('Close-window prompt parent was destroyed.')
      }
      return dialog.showMessageBox(window, {
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

async function showTurnCompleteNotification(
  payload: TurnCompleteNotificationPayload
): Promise<{ ok: true; shown: boolean; reason?: string } | { ok: false; message: string }> {
  const settings = await store.load()
  const disabledReason = turnCompleteNotificationDisabledReason(
    settings.notifications,
    payload.source
  )
  if (disabledReason) {
    return { ok: true, shown: false, reason: disabledReason }
  }
  if (!Notification.isSupported()) {
    return { ok: true, shown: false, reason: 'unsupported' }
  }

  const baseTitle = normalizeNotificationText(payload.title, appEnvironment.appName, 80)
  const title = appEnvironment.flavor === 'development'
    ? `[DV] ${baseTitle}`
    : baseTitle
  const body = normalizeNotificationText(payload.body, 'Conversation complete.', 180)

  try {
    const notification = new Notification({
      title,
      body,
      ...notificationIconOptions(appIcon)
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
let runtimeSettingsSyncGeneration = 0
let runtimeSettingsSyncStatus: KunRuntimeSettingsSyncStatusPayload = {
  state: 'idle',
  generation: 0,
  at: new Date().toISOString()
}

function publishRuntimeSettingsSyncStatus(
  status: Omit<KunRuntimeSettingsSyncStatusPayload, 'at'>
): void {
  const full = { ...status, at: new Date().toISOString() }
  runtimeSettingsSyncStatus = full
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('runtime:settings-sync-status', full)
  }
}

const runtimeSupervisor = new KunRuntimeSupervisor<AppSettingsV1>({
  deps: {
    loadSettings: () => store.load(),
    canAutoRestart: managedKunHostCanAutoStart,
    ensureRuntime: (settings) => ensureRuntime(settings),
    restartRuntime: (settings) => restartRuntime(settings),
    checkHealth: async (settings, timeoutMs) => {
      await kunRuntimeAdapter.resolveConnection(settings)
      return kunRuntimeHealthMonitor.waitForHealthy(settings, timeoutMs)
    },
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

let runtimeMigrationVerificationPromise: Promise<void> | null = null
let runtimeMigrationVerificationCompleted = false

async function verifyRuntimeMigrationHistory(): Promise<void> {
  const settings = await store.load()
  const headers = runtimeAuthHeaders(settings)
  headers.set('Accept', 'application/json')
  const response = await fetch(
    `${getRuntimeBaseUrlForSettings(settings)}/v1/threads?include_archived=true&include=side`,
    {
      headers,
      signal: AbortSignal.timeout(15_000)
    }
  )
  if (!response.ok) {
    throw new Error(`Runtime thread inventory returned HTTP ${response.status}`)
  }
  const payload = JSON.parse(await response.text()) as { threads?: unknown }
  if (!Array.isArray(payload.threads)) {
    throw new Error('Runtime thread inventory response has no threads array')
  }
  const visibleThreadIds = payload.threads.flatMap((thread) =>
    thread &&
    typeof thread === 'object' &&
    typeof (thread as { id?: unknown }).id === 'string'
      ? [(thread as { id: string }).id]
      : []
  )
  const result = markCanonicalKunRuntimeMigrationRuntimeVerified(
    app.getPath('userData'),
    visibleThreadIds
  )
  runtimeMigrationVerificationCompleted = result.status !== 'incomplete'
  if (result.status === 'incomplete') {
    logWarn(
      'runtime-data-migration',
      'Runtime is healthy but its thread API does not expose every migrated thread; verification remains pending.',
      {
        expectedThreadCount: result.expectedThreadCount,
        visibleThreadCount: result.visibleThreadCount,
        missingThreadCount: result.missingThreadIds.length,
        missingThreadIds: result.missingThreadIds.slice(0, 20)
      }
    )
  }
}

function scheduleRuntimeMigrationHistoryVerification(): void {
  if (runtimeMigrationVerificationCompleted || runtimeMigrationVerificationPromise) return
  runtimeMigrationVerificationPromise = verifyRuntimeMigrationHistory()
    .catch((error) => {
      logWarn('runtime-data-migration', 'Could not verify migrated Runtime history through the thread API.', {
        message: error instanceof Error ? error.message : String(error)
      })
    })
    .finally(() => {
      runtimeMigrationVerificationPromise = null
    })
}

/** Record a healthy runtime: reset the crash budget and watchdog, announce recovery. */
function noteRuntimeHealthy(source: string): void {
  scheduleRuntimeMigrationHistoryVerification()
  runtimeSupervisor.noteHealthy(source)
}

function handleUnexpectedKunExit(info: KunUnexpectedExitInfo): void {
  void stopBrowserUseHost()
  void stopComputerUseHost()
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
  const generation = ++runtimeSettingsSyncGeneration
  publishRuntimeSettingsSyncStatus({ state: 'syncing', generation })

  const reportCurrent = (
    outcome: Pick<KunRuntimeSettingsSyncStatusPayload, 'state' | 'message'>
  ): void => {
    if (generation !== runtimeSettingsSyncGeneration) return
    publishRuntimeSettingsSyncStatus({
      state: outcome.state,
      generation,
      ...(outcome.message ? { message: outcome.message } : {})
    })
  }

  runtimeSupervisor.enqueueSettingsApply(
    async () => {
      if (generation !== runtimeSettingsSyncGeneration) return
      const current = runtimeSupervisor.latestOr(next)
      const currentMode = runtimeSettingsApplyMode(anchor, current)
      if (currentMode === 'restart') {
        reportCurrent(await restartManagedRuntimeForSettingsChange(anchor, current))
      } else if (currentMode === 'hot') {
        const result = await applyManagedRuntimeSettingsHot(current, 'settings-apply')
        if (result === 'restart_required') {
          reportCurrent(await restartManagedRuntimeForSettingsChange(anchor, current, true))
        } else if (result === 'applied') {
          reportCurrent({ state: 'synced' })
        } else {
          reportCurrent({ state: 'unavailable', message: 'Kun Runtime is not running.' })
        }
      } else {
        reportCurrent({ state: 'synced' })
      }
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      reportCurrent({ state: 'failed', message })
      logWarn('settings-apply', 'Failed to apply Kun runtime settings in background', {
        message
      })
    }
  )
}

function queueRuntimeMcpConfigApply(settings: AppSettingsV1): void {
  runtimeSupervisor.noteLatest(settings)
  const settingsGeneration = runtimeSettingsSyncStatus.state === 'syncing'
    ? runtimeSettingsSyncGeneration
    : null
  const reportSettingsOutcome = (outcome: ManagedRuntimeSettingsApplyOutcome): void => {
    if (
      settingsGeneration === null ||
      settingsGeneration !== runtimeSettingsSyncGeneration ||
      runtimeSettingsSyncStatus.state !== 'syncing'
    ) return
    publishRuntimeSettingsSyncStatus({
      state: outcome.state,
      generation: settingsGeneration,
      ...(outcome.message ? { message: outcome.message } : {})
    })
  }
  runtimeSupervisor.enqueueSettingsApply(
    async () => {
      const current = runtimeSupervisor.latestOr(settings)
      const result = await applyManagedRuntimeSettingsHot(current, 'mcp-config')
      if (result === 'restart_required') {
        reportSettingsOutcome(await restartManagedRuntimeForMcpConfigChange(current))
      } else if (result === 'applied') {
        reportSettingsOutcome({ state: 'synced' })
      } else {
        reportSettingsOutcome({ state: 'unavailable', message: 'Kun Runtime is not running.' })
      }
    },
    (error: unknown) => {
      reportSettingsOutcome({
        state: 'failed',
        message: error instanceof Error ? error.message : String(error)
      })
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
  assertCanonicalRuntimeMigrationReady()
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
  _source: string
): Promise<AppSettingsV1> {
  // Shared runtimes bind an ephemeral loopback port while holding the
  // data-directory election lock. The configured port is a legacy preference,
  // not the address or bearer token of the currently resolved daemon.
  return settings
}

async function ensureKunRuntime(settings: AppSettingsV1): Promise<AppSettingsV1> {
  const currentSettings = settings
  const connectionResolved = await kunRuntimeAdapter.resolveConnection(currentSettings)

  const runtime = getKunRuntimeSettings(currentSettings)

  const healthy = connectionResolved &&
    await kunRuntimeHealthMonitor.waitForHealthy(currentSettings, 2_000)
  if (healthy) {
    const threadApi = await probeThreadApi(currentSettings)
    if (threadApi.ok) {
      noteRuntimeHealthy('ensure')
      return currentSettings
    }
    throw runtimeJsonError(threadApi.error, threadApi.message)
  }

  if (!runtime.autoStart) {
    throw runtimeJsonError(
      'runtime_offline',
      'Kun is offline. Enable automatic startup in Settings, or start `kun serve` manually.'
    )
  }

  // A process that is alive but failed the probe may only be busy or waking
  // from system sleep. Give it a real recovery window before deciding what to
  // do; replacing a shared runtime here would orphan its in-flight turn.
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
      if (!isKunChildRunning()) {
        throw runtimeJsonError(
          'runtime_unhealthy',
          'Kun is still running but temporarily unresponsive. Its active runtime was preserved; retry after it recovers.'
        )
      }
      // The legacy GUI-private child can be replaced safely in place. Shared
      // daemons are never stopped by an ordinary ensure request.
      logWarn(
        'runtime-start',
        `GUI-private Kun child stopped responding on port ${runtime.port}; restarting it in place`
      )
      await kunRuntimeAdapter.stopSharedAndWait(currentSettings)
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
  assertCanonicalRuntimeMigrationReady()
  await waitForQueuedRuntimeSettingsApply()
  // Don't tear down a child that is still completing its startup; wait for it
  // to settle so a restart trigger that races a boot doesn't reset the clock
  // (#544). Resolves immediately when nothing is launching.
  await waitForKunStartupSettled()
  const runtime = getKunRuntimeSettings(settings)

  if (!runtime.autoStart) {
    throw runtimeJsonError(
      'runtime_offline',
      'Kun is offline. Enable automatic startup in Settings, or start `kun serve` manually.'
    )
  }

  const adapter = kunRuntimeAdapter
  await adapter.stopSharedAndWait(settings)
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

function resolveMainRendererUrl(): string {
  return developmentRendererUrl() ?? pathToFileURL(join(__dirname, '../renderer/index.html')).href
}

function createWindow(options: { suppressInitialShow?: boolean } = {}): void {
  traceStartup('createWindow:start')
  const preloadPath = resolvePreloadPath(__dirname)
  const usesDesktopTitleBar = process.platform === 'win32' || process.platform === 'linux'
  const windowTitle = appWindowTitleForFlavor(appEnvironment.flavor)
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: windowTitle,
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
      additionalArguments: [
        `--kun-home-dir=${homedir()}`,
        `--kun-app-environment=${encodeURIComponent(JSON.stringify(appEnvironment))}`
      ]
    }
  })
  window.on('page-title-updated', (event) => {
    event.preventDefault()
    window.setTitle(windowTitle)
  })
  mainWindow = window
  const trustedRendererUrl = resolveMainRendererUrl()
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const preventUntrustedNavigation = (event: Electron.Event, targetUrl: string): void => {
    if (!isTrustedWorkbenchUrl(targetUrl, trustedRendererUrl)) event.preventDefault()
  }
  window.webContents.on('will-navigate', preventUntrustedNavigation)
  window.webContents.on('will-redirect', preventUntrustedNavigation)
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
      reloadRenderer(window.webContents, developmentRendererUrl())
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
  const devUrl = developmentRendererUrl()
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
    if (!window.isDestroyed()) {
      window.webContents.send('runtime:settings-sync-status', runtimeSettingsSyncStatus)
    }
    showWindow()
  })
  setTimeout(() => {
    traceStartup('window:fallback-show-timeout')
    showWindow()
  }, 1500)
}

function createStorageRelocationWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 760,
    height: 620,
    minWidth: 680,
    minHeight: 520,
    title: 'Kun Storage Migration',
    icon: appIcon.isEmpty() ? undefined : appIcon,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: resolvePreloadPath(__dirname),
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      additionalArguments: [
        `--kun-home-dir=${homedir()}`,
        `--kun-app-environment=${encodeURIComponent(JSON.stringify(appEnvironment))}`
      ]
    }
  })
  mainWindow = window
  window.setMenu(null)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  const devUrl = developmentRendererUrl()
  if (devUrl) {
    const target = new URL(devUrl)
    target.searchParams.set('storageRelocation', '1')
    void window.loadURL(target.toString())
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { storageRelocation: '1' }
    })
  }
  window.once('ready-to-show', () => window.show())
  return window
}

async function listStorageRelocationActiveWork(
  manager: ServiceManagerConnection
): Promise<StorageRelocationActiveWork[]> {
  const work: StorageRelocationActiveWork[] = terminalPtyController?.listSessionIds().map((id) => ({
    kind: 'background-service' as const,
    id: `terminal:${id}`,
    label: `Terminal session ${id}`,
    interruptible: true
  })) ?? []
  for (const flavor of ['production', 'development'] as const) {
    const registration = await readManagerRuntime(manager, flavor).catch(() => null)
    if (!registration) continue
    const response = await fetch(`${registration.baseUrl}/v1/threads?limit=500&include=side`, {
      headers: { authorization: `Bearer ${registration.runtimeToken}` },
      signal: AbortSignal.timeout(5_000)
    }).catch(() => null)
    if (!response?.ok) {
      work.push({
        kind: 'external-writer',
        id: `runtime:${flavor}:${registration.instanceId}`,
        label: `${flavor} Runtime could not be inspected`,
        interruptible: false
      })
      continue
    }
    const payload = await response.json().catch(() => null) as { threads?: unknown } | null
    for (const thread of Array.isArray(payload?.threads) ? payload.threads : []) {
      if (!thread || typeof thread !== 'object') continue
      const value = thread as { id?: unknown; title?: unknown; status?: unknown; turns?: unknown }
      const threadId = typeof value.id === 'string' ? value.id : ''
      const threadActive = value.status === 'queued' || value.status === 'in_progress' ||
        value.status === 'started' || value.status === 'running'
      let turns = Array.isArray(value.turns) ? value.turns : []
      if (threadActive && turns.length === 0 && threadId) {
        const detailResponse = await fetch(`${registration.baseUrl}/v1/threads/${encodeURIComponent(threadId)}`, {
          headers: { authorization: `Bearer ${registration.runtimeToken}` },
          signal: AbortSignal.timeout(5_000)
        }).catch(() => null)
        const detail = detailResponse?.ok
          ? await detailResponse.json().catch(() => null) as { turns?: unknown } | null
          : null
        turns = Array.isArray(detail?.turns) ? detail.turns : []
      }
      const activeTurn = turns.find((turn) => {
        const status = turn && typeof turn === 'object' ? (turn as { status?: unknown }).status : undefined
        return status === 'queued' || status === 'in_progress' || status === 'started' || status === 'running'
      }) as { id?: unknown; turnId?: unknown } | undefined
      if (!threadActive && !activeTurn) continue
      const turnId = typeof activeTurn?.id === 'string'
        ? activeTurn.id
        : typeof activeTurn?.turnId === 'string' ? activeTurn.turnId : ''
      work.push({
        kind: 'turn',
        id: `${flavor}:${threadId}:${turnId}`,
        label: typeof value.title === 'string' && value.title.trim()
          ? value.title.trim()
          : `${flavor} thread ${threadId || 'unknown'}`,
        interruptible: Boolean(threadId && turnId)
      })
    }
  }
  return work
}

async function interruptStorageRelocationWork(manager: ServiceManagerConnection): Promise<void> {
  const work = await listStorageRelocationActiveWork(manager)
  const blocked = work.filter((item) => !item.interruptible)
  if (blocked.length > 0) {
    throw new Error(`active_writer: ${blocked.map((item) => item.label).join('; ')}`)
  }
  terminalPtyController?.disposeAll()
  for (const item of work.filter((entry) => entry.kind === 'turn')) {
    const [flavor, threadId, turnId] = item.id.split(':')
    if (!threadId || !turnId || (flavor !== 'production' && flavor !== 'development')) continue
    const registration = await readManagerRuntime(manager, flavor)
    if (!registration) throw new Error(`active_writer: ${flavor} Runtime disappeared before interruption.`)
    const response = await fetch(
      `${registration.baseUrl}/v1/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/interrupt`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${registration.runtimeToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ discard: false }),
        signal: AbortSignal.timeout(10_000)
      }
    )
    if (!response.ok && response.status !== 404 && response.status !== 409) {
      throw new Error(`active_writer: Failed to interrupt ${item.label} (HTTP ${response.status}).`)
    }
  }
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const remaining = (await listStorageRelocationActiveWork(manager))
      .filter((item) => item.kind === 'turn' || !item.interruptible)
    if (remaining.length === 0) return
    await new Promise<void>((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('active_writer: Timed out waiting for active Kun writes to stop.')
}

async function shutdownServiceManagerAndWait(manager: ServiceManagerConnection): Promise<void> {
  await requestManagerJson(manager, '/v1/manager/shutdown', {
    method: 'POST',
    body: { instanceId: manager.discovery.instanceId },
    timeoutMs: 10_000
  })
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      process.kill(manager.discovery.pid, 0)
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
    } catch {
      return
    }
  }
  throw new Error('active_writer: Kun Service Manager did not exit before migration.')
}

async function shutdownActiveServiceManagerForUpdate(): Promise<void> {
  const manager = activeServiceManager
  if (!manager) return
  await shutdownServiceManagerAndWait(manager)
  if (activeServiceManager === manager) activeServiceManager = null
}

async function runStorageRelocationMaintenance(productionSettingsPath: string): Promise<void> {
  const window = createStorageRelocationWindow()
  let relaunchScheduled = false
  const scheduleRelaunch = (): void => {
    if (relaunchScheduled) return
    relaunchScheduled = true
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 750).unref?.()
  }
  const publish = (progress: StorageRelocationProgress): void => {
    if (!window.isDestroyed()) window.webContents.send('storage-relocation:progress', progress)
  }
  const engine = new StorageRelocationEngine({
    homeDir: homedir(),
    userDataPath: app.getPath('userData'),
    installPath: dirname(process.execPath),
    platform: process.platform,
    featureEnabled: true,
    onProgress: publish,
    healthCheck: async () => {
      let manager: ServiceManagerConnection | null = null
      let settings: AppSettingsV1 | null = null
      try {
        manager = await ensureKunServiceManager({ settingsPath: productionSettingsPath })
        const recoveryStore = new JsonSettingsStore(app.getPath('userData'), {
          documentBackend: new ManagerRevisionedDocumentClient(manager, 'settings')
        })
        settings = await recoveryStore.load()
        await kunRuntimeAdapter.ensureRunning(settings)
        const headers = runtimeAuthHeaders(settings)
        const [health, threads, attachments, extensions] = await Promise.all([
          fetch(`${getRuntimeBaseUrlForSettings(settings)}/health`, {
            headers,
            signal: AbortSignal.timeout(15_000)
          }),
          fetch(`${getRuntimeBaseUrlForSettings(settings)}/v1/threads?limit=1&include=side`, {
            headers,
            signal: AbortSignal.timeout(15_000)
          }),
          fetch(`${getRuntimeBaseUrlForSettings(settings)}/v1/attachments/diagnostics`, {
            headers,
            signal: AbortSignal.timeout(15_000)
          }),
          fetch(`${getRuntimeBaseUrlForSettings(settings)}/v1/extensions`, {
            headers,
            signal: AbortSignal.timeout(15_000)
          })
        ])
        if (!health.ok || !threads.ok || !attachments.ok || !extensions.ok) {
          throw new Error(
            `Runtime health verification failed ` +
            `(${health.status}/${threads.status}/${attachments.status}/${extensions.status}).`
          )
        }
        const body = await threads.json() as { threads?: unknown }
        if (!Array.isArray(body.threads)) throw new Error('Runtime thread verification returned invalid data.')
      } catch (error) {
        if (settings) await kunRuntimeAdapter.stopSharedAndWait(settings).catch(() => undefined)
        if (manager) await shutdownServiceManagerAndWait(manager).catch(() => undefined)
        throw error
      }
    }
  })
  new StorageRelocationController({
    engine,
    getMainWindow: () => mainWindow,
    recoveryMode: true
  }).registerIpc()
  const repairPoll = setInterval(() => {
    void Promise.all([engine.status(), engine.hasPendingOperation()]).then(([status, pending]) => {
      if (!pending && (status.state === 'default' || status.state === 'relocated') && !status.recoveryRequired) {
        scheduleRelaunch()
      }
    }).catch(() => undefined)
  }, 2_000)
  repairPoll.unref?.()
  try {
    const result = await engine.runPending()
    if (result && (result.phase === 'completed' || !await engine.hasPendingOperation())) {
      scheduleRelaunch()
    }
  } catch (error) {
    logError('storage-relocation', 'Storage relocation maintenance failed.', {
      message: error instanceof Error ? error.message : String(error)
    })
  }
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
type ManagedRuntimeSettingsApplyOutcome = Pick<
  KunRuntimeSettingsSyncStatusPayload,
  'state' | 'message'
>

async function applyManagedRuntimeSettingsHot(
  settings: AppSettingsV1,
  source: string
): Promise<ManagedRuntimeHotApplyResult> {
  assertCanonicalRuntimeMigrationReady()
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
): Promise<ManagedRuntimeSettingsApplyOutcome> {
  if (!force && !runtimeProcessConfigChanged(prev, next)) return { state: 'synced' }

  // Let any in-flight boot launch finish (or fail) before we read liveness
  // and stop the child. Killing a kun that is still inside its startup window
  // throws away the boot's progress and restarts the clock — the #544 restart
  // storm. Once it settles, the child is either healthy (graceful restart
  // below) or already gone (`wasRunning` is false and we return).
  await waitForKunStartupSettled()

  const runtime = resolveKunRuntimeSettings(next)
  const adapter = kunRuntimeAdapter
  const wasRunning = adapter.isChildRunning()

  if (!wasRunning) return { state: 'unavailable', message: 'Kun Runtime is not running.' }

  await waitForManagedRuntimeReadyBeforeStop(prev, 'settings-apply')
  await adapter.stopSharedAndWait(prev)
  if (!runtime.autoStart) {
    publishRuntimeStatus({
      state: 'stopped',
      source: 'settings-apply',
      message: 'Kun was stopped because automatic startup is disabled.'
    })
    return { state: 'unavailable', message: 'Kun Runtime is stopped by the current settings.' }
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
    return { state: 'synced' }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logWarn('settings-apply', `Kun restart failed after settings change: ${message}`)
    await rollbackRuntimeSettingsAfterFailedApply(prev, next, message)
    return { state: 'failed', message }
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
  desired: AppSettingsV1,
  failureMessage: string
): Promise<void> {
  const adapter = kunRuntimeAdapter
  let base: AppSettingsV1 = prev
  try {
    // Route definitions are durable user intent, not process-critical launch
    // settings. Keep the newest routes repairable while restoring the previous
    // Runtime/provider transport configuration.
    base = await store.patch(runtimeSettingsRollbackPatch(prev, desired))
    runtimeSupervisor.noteLatest(base)
  } catch (error) {
    logWarn('settings-apply', 'failed to restore previous runtime settings on disk', {
      message: error instanceof Error ? error.message : String(error)
    })
  }
  if (!getKunRuntimeSettings(base).autoStart) {
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

async function restartManagedRuntimeForMcpConfigChange(
  settings: AppSettingsV1
): Promise<ManagedRuntimeSettingsApplyOutcome> {
  // See restartManagedRuntimeForSettingsChange: never interrupt an in-flight
  // boot launch (#544 restart storm).
  await waitForKunStartupSettled()

  const runtime = resolveKunRuntimeSettings(settings)
  const adapter = kunRuntimeAdapter
  const wasRunning = adapter.isChildRunning()

  if (!wasRunning) return { state: 'unavailable', message: 'Kun Runtime is not running.' }
  await waitForManagedRuntimeReadyBeforeStop(settings, 'mcp-config')
  await adapter.stopSharedAndWait(settings)
  if (!runtime.autoStart) {
    return { state: 'unavailable', message: 'Kun Runtime is stopped by the current settings.' }
  }

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
    return { state: 'synced' }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logWarn('mcp-config', `Kun restart failed after MCP config change: ${message}`)
    publishRuntimeStatus({
      state: 'failed',
      source: 'mcp-config',
      message: `Kun failed to restart after the MCP config change: ${message}. Check the MCP config file, then retry.`
    })
    return { state: 'failed', message }
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

  const installHealth = inspectPackagedInstallHealth({
    isPackaged: app.isPackaged,
    executablePath: process.execPath,
    resourcesPath: process.resourcesPath
  })
  if (!installHealth.ok) {
    dialog.showErrorBox(
      'Kun installation needs repair',
      `The installed application is incomplete (${installHealth.missing.join(', ')}). Reinstall Kun and try again.`
    )
    app.quit()
    return
  }

  try {
    const cleared = await clearDevelopmentRendererHttpCache(
      session.defaultSession,
      developmentRendererUrl()
    )
    if (cleared) traceStartup('development renderer HTTP cache cleared')
  } catch (error) {
    console.warn('[kun-gui] failed to clear the development renderer HTTP cache:', error)
  }

  if (process.platform === 'darwin') {
    const macDockIcon = createAppIcon(kunMacLogoPng)
    app.dock?.setIcon(macDockIcon.isEmpty() ? appIcon : macDockIcon)
  }

  const productionSettingsUserDataPath = appIdentity.flavor === 'production'
    ? app.getPath('userData')
    : join(app.getPath('appData'), 'Kun')
  const productionSettingsPath = join(productionSettingsUserDataPath, SETTINGS_FILE_NAME)
  if (storageRelocationRecoveryRequired) {
    traceStartup('storage relocation maintenance:start', {
      operationId: pendingStorageRelocationId ?? 'repair'
    })
    await runStorageRelocationMaintenance(productionSettingsPath)
    return
  }
  const serviceManager = await ensureKunServiceManager({
    settingsPath: productionSettingsPath
  })
  activeServiceManager = serviceManager
  const sharedSettingsBackend = new ManagerRevisionedDocumentClient(serviceManager, 'settings')
  const sharedClientStateDocument = new ManagerRevisionedDocumentClient(serviceManager, 'client-state')
  ipcMain.handle('shared-client-state:get', async () => {
    const snapshot = await sharedClientStateDocument.read()
    return {
      revision: snapshot.revision,
      value: parseSharedClientState(snapshot.value)
    }
  })
  ipcMain.handle('shared-client-state:put', async (_event, input: unknown) => {
    const parsed = parseSharedClientStateWrite(input)
    const committed = await sharedClientStateDocument.write(
      parsed.expectedRevision,
      `${JSON.stringify(parsed.entries, null, 2)}\n`
    )
    return {
      revision: committed.revision,
      value: parsed.entries
    }
  })
  const credentialMigration = canonicalRuntimeMigration?.status === 'blocked'
    ? undefined
    : new LegacyProviderSettingsMigrationCoordinator()
  store = credentialMigration
    ? new JsonSettingsStore(productionSettingsUserDataPath, {
        credentialMigration,
        documentBackend: sharedSettingsBackend
      })
    : new JsonSettingsStore(productionSettingsUserDataPath, {
        rejectPlaintextCredentials: canonicalRuntimeMigration?.status === 'blocked',
        documentBackend: sharedSettingsBackend
      })
  traceStartup('settings load:start')
  const initial = await store.load()
  disposeTrayQuotaIpc = registerTrayQuotaIpc({
    ipcMain,
    getWindow: () => trayQuotaWindow,
    list: async () => {
      const settings = await store.load()
      return requestRuntimeProviderQuotas((path, method) =>
        runtimeRequest(settings, path, { method })
      )
    },
    context: async () => {
      const settings = await store.load()
      return {
        locale: settings.locale,
        platform: process.platform === 'darwin'
          ? 'darwin'
          : process.platform === 'win32'
            ? 'win32'
            : 'linux',
        colorMode: settings.theme === 'dark' ||
          (settings.theme === 'system' && nativeTheme.shouldUseDarkColors)
          ? 'dark'
          : 'light'
      }
    },
    action: (action) => {
      hideTrayQuotaPopover()
      if (action === 'new-chat') dispatchTrayAction({ type: 'new-chat' })
      else if (action === 'open-app') revealMainWindow()
    },
    openExternal: (url) => shell.openExternal(url)
  })
  const browserUseManager = configureBrowserUseHost({
    settings: initial,
    getMainWindow: () => mainWindow
  })
  configureComputerUseHost({ settings: initial })
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
  const workspacePreviewProtocols = new WorkspacePreviewProtocolRegistry()
  workspacePreviewProtocols.register(protocol)

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
    deferReloadUntil: (frame) => nativeDialogCoordinator.deferUntilIdle(frame),
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
  logDir = resolveLogDirectory(app)
  configureLogger({
    dir: logDir,
    enabled: initial.log.enabled,
    retentionDays: initial.log.retentionDays
  })
  traceStartup('logger configured')
  let ownsDesktopBackgroundServices = false
  const startDesktopBackgroundServices = async (): Promise<void> => {
    if (scheduleRuntime || workflowRuntime || clawRuntime || telegramRuntime) return
    ownsDesktopBackgroundServices = true
    const settings = await store.load()
    await syncClawScheduleMcpConfig(settings, getClawScheduleMcpLaunchConfig()).catch((error) => {
      console.error('[claw-schedule-mcp] failed to sync config on desktop-host acquisition:', error)
    })
    void runCheckpointCleanup(settings, { force: true, reason: 'startup' })
    syncCheckpointCleanupTimer(settings)
    scheduleRuntime = createScheduleRuntime({ store, runtimeRequest, logError, powerSaveBlocker })
    scheduleRuntime.sync(settings)
    workflowRuntime = createWorkflowRuntime({ store, runtimeRequest, logError, powerSaveBlocker })
    workflowRuntime.sync(settings)
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
    clawRuntime.sync(settings)
    telegramRuntime.sync(settings)
    syncWeixinBridgeRuntime(settings)
  }
  const stopDesktopBackgroundServices = async (): Promise<void> => {
    ownsDesktopBackgroundServices = false
    stopCheckpointCleanupTimer()
    const [schedule, workflow, claw, telegram] = [
      scheduleRuntime,
      workflowRuntime,
      clawRuntime,
      telegramRuntime
    ] as const
    scheduleRuntime = null
    workflowRuntime = null
    clawRuntime = null
    telegramRuntime = null
    await Promise.allSettled([
      schedule?.stop(),
      workflow?.stop(),
      claw?.stop(),
      telegram?.stop(),
      stopWeixinBridgeRuntime()
    ])
  }
  const desktopResourceLeases = new ManagerResourceLeaseClient(
    serviceManager,
    appIdentity.runtimeFlavor,
    randomUUID()
  )
  await desktopResourceLeases.maintain({
    resource: 'desktop-background-services',
    onAcquired: startDesktopBackgroundServices,
    onLost: stopDesktopBackgroundServices
  })
  await desktopResourceLeases.maintain({
    resource: 'desktop-host',
    onAcquired: () => undefined,
    onLost: () => undefined
  })
  shutdownDesktopResourceLeases = () => desktopResourceLeases.shutdown()
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
    const requestedDataDir = effectivePartial.agents?.kun?.dataDir
    if (
      appEnvironment.flavor === 'production' &&
      typeof requestedDataDir === 'string' &&
      requestedDataDir !== prev.agents.kun.dataDir
    ) {
      throw new Error('Kun data location is managed from Settings > Storage on Windows.')
    }
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
    updateBrowserUseHostSettings(saved)
    updateComputerUseHostSettings(saved)
    if (ownsDesktopBackgroundServices) {
      await syncClawScheduleMcpConfig(saved, getClawScheduleMcpLaunchConfig()).catch((error) => {
        console.error('[claw-schedule-mcp] failed to sync config after settings change:', error)
      })
    }
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
    if (ownsDesktopBackgroundServices) syncWeixinBridgeRuntime(saved)
    syncLoginItemSettings(saved)
    syncTray(saved)
    if (ownsDesktopBackgroundServices) syncCheckpointCleanupTimer(saved)
    requestExtensionWorkbenchEnvironmentPublish()
    return saved
  }

  const fetchModels = async () => {
    const settings = await store.load()
    const shared = await runtimeRequest(settings, '/v1/model-connections', { method: 'GET' })
    if (shared.ok) {
      try {
        const live = modelListFromSharedConnections(JSON.parse(shared.body) as unknown)
        if (live) return live
      } catch {
        // Fall back to the compatibility settings projection below.
      }
    }
    const key = resolveConfiguredApiKey(settings)
    return fetchUpstreamModelIds(settings, key)
  }

  const saveSettingsPatch = async (partial: AppSettingsPatch): Promise<AppSettingsV1> => {
    const previous = await store.load()
    const effectivePartial = preserveRuntimeTokenForFullSettingsSnapshot(previous, partial)
    const requestedDataDir = effectivePartial.agents?.kun?.dataDir
    if (
      appEnvironment.flavor === 'production' &&
      typeof requestedDataDir === 'string' &&
      requestedDataDir !== previous.agents.kun.dataDir
    ) {
      throw new Error('Kun data location is managed from Settings > Storage on Windows.')
    }
    const saved = await store.patch(effectivePartial)
    requestExtensionWorkbenchEnvironmentPublish()
    return saved
  }

  registerAppIpcHandlers({
    store,
    getMainWindow: () => mainWindow,
    applySettingsPatch,
    saveSettingsPatch,
    resetUnreadableCredentials: async () => {
      assertCanonicalRuntimeMigrationReady()
      const dataDir = resolveSettingsDataDir(await store.load())
      const result = await resetUnreadableWindowsCredentials(dataDir)
      credentialMigration?.invalidateRuntime(dataDir)
      return { reset: true as const, ...result }
    },
    runtimeRequest: async (path, method, body, headers) => {
      const settings = await store.load()
      const result = await runtimeRequest(settings, path, { method, body, headers })
      const cleanup = result.ok
        ? browserUseCleanupForRuntimeRequest({ path, method, body })
        : undefined
      if (cleanup) await browserUseManager.clear(cleanup.threadId, cleanup.reason)
      return result
    },
    getRuntimeAuthToken,
    getRuntimeSettingsSyncStatus: () => runtimeSettingsSyncStatus,
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
    logError,
    logInfo,
    nativeDialogs: nativeDialogCoordinator,
    workspacePreviewProtocols
  })
  const disposeBrowserUseIpc = registerBrowserUseIpc({
    ipcMain,
    manager: browserUseManager,
    getMainWindow: () => mainWindow
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
    featureEnabled: resolveDataMigrationFeatureEnabled()
  })
  dataMigrationController.registerIpc()
  const storageRelocationEngine = new StorageRelocationEngine({
    homeDir: homedir(),
    userDataPath: productionSettingsUserDataPath,
    installPath: dirname(process.execPath),
    platform: process.platform,
    featureEnabled: storageRelocationFeatureEnabled({
      platform: process.platform,
      flavor: appEnvironment.flavor,
      isPackaged: app.isPackaged,
      environment: process.env
    }),
    listActiveWork: () => listStorageRelocationActiveWork(serviceManager),
    onProgress: (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('storage-relocation:progress', progress)
      }
    }
  })
  new StorageRelocationController({
    engine: storageRelocationEngine,
    getMainWindow: () => mainWindow,
    loadSettings: () => store.load(),
    prepareForRestart: async () => {
      await interruptStorageRelocationWork(serviceManager)
      runtimeShutdown.setStorageRelocationQuit(true)
      await runtimeShutdown.stopForQuit()
      await shutdownServiceManagerAndWait(serviceManager)
      if (activeServiceManager === serviceManager) activeServiceManager = null
      mainWindow?.destroy()
      app.relaunch()
      app.exit(0)
    }
  }).registerIpc()
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
    logError,
    nativeDialogs: nativeDialogCoordinator
  }
  const extensionIpcRegistration = registerExtensionIpcHandlers(extensionIpcOptions)
  publishExtensionWorkbenchEnvironmentChanged = () =>
    extensionIpcRegistration.publishWorkbenchEnvironmentChanged()
  const onNativeThemeUpdated = (): void => {
    requestExtensionWorkbenchEnvironmentPublish()
    notifyTrayQuotaRefresh()
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
    disposeTrayQuotaIpc?.()
    disposeTrayQuotaIpc = null
    destroyTrayQuotaPopover()
    disposeBrowserUseIpc()
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
  registerCliInstallIpc(ipcMain)

  terminalPtyController = registerTerminalPtyIpc({
    ipcMain,
    getMainWindow: () => mainWindow,
    logError,
    getTerminalColorMode: async () => resolveTerminalColorMode(await store.load())
  })
  traceStartup('ipc registration:done')

  createWindow({ suppressInitialShow: shouldStartHidden(initial) })
  void maybePromptCliInstall(() => mainWindow).catch((error) => {
    console.warn('[kun-gui] CLI install prompt failed:', error)
  })
  traceStartup('createWindow:returned')
  void loadGuiUpdaterModule()
    .then((module) => module.showPostUpdateReleaseNotes())
    .catch((error) => {
      console.warn('[kun-gui updater] failed to show post-update release notes:', error)
    })

  void pruneOnStartup().catch((err) => {
    console.warn('[kun-gui] prune logs:', err)
  })

  if (managedKunHostCanAutoStart(initial)) {
    setTimeout(() => {
      void ensureRuntime(initial)
        .then(async (current) => {
          const applied = await applyManagedRuntimeSettingsHot(current, 'startup-settings')
          if (applied === 'restart_required') {
            logWarn(
              'startup-settings',
              'Kun attached successfully, but the configured default model could not be hot-applied.'
            )
          }
        })
        .catch((err) => {
          console.warn('[kun-gui] failed to start, attach, or configure the shared Kun runtime:', err)
        })
    }, 1500)
  } else {
    void kunRuntimeAdapter.resolveConnection(initial)
  }

  app.on('second-instance', () => {
    revealMainWindow()
  })

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow()
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
  if (process.platform === 'darwin') return
  void stopManagedRuntimes().catch((error) => {
    console.warn('[kun-gui] failed to stop Kun runtime:', error)
  })
  app.quit()
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
