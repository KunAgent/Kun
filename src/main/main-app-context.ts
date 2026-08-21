import {
  app,
  BrowserWindow,
  Menu,
  protocol,
  Tray
} from 'electron'
import {
  homedir
} from 'node:os'
import {
  dirname,
  join
} from 'node:path'
import {
  fileURLToPath
} from 'node:url'
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
  createMultiScaleIcon
} from './app-icon'
import {
  configureLinuxWaylandImeSwitches
} from './app-command-line'
import {
  configureDevelopmentRendererHttpCache
} from './dev-renderer-cache'
import {
  configureAppIdentity,
  configureDesktopSmokeAppDataPath,
  readPackagedAppFlavor
} from './app-identity'
import {
  HOME_DATA_MIGRATION_MAPPINGS,
  migrateLegacyHomeDataDirs,
  migrateLegacyUserDataDir
} from './legacy-data-migration'
import {
  type RuntimeDataDirMigrationResult
} from './runtime-data-dir-migration'
import {
  type CanonicalRuntimeMigrationLock
} from './runtime-data-dir-migration-lock'
import {
  getActiveAgentApiKey,
  normalizeAppBehaviorSettings,
  type AppBehaviorConfigV1,
  type AppSettingsV1
} from '../shared/app-settings'
import {
  runtimeErrorToError,
  type RuntimeErrorCode
} from '../shared/runtime-error'
import type {
  KunRuntimeSettingsSyncStatusPayload
} from '../shared/kun-gui-api'
import {
  type ServiceManagerConnection
} from '../../kun/src/manager/manager-client.js'
import {
  RuntimeSettingsIntentSequencer
} from './runtime/runtime-settings-intent-sequencer'
import {
  logWarn
} from './logger'
import {
  NativeDialogCoordinator
} from './native-dialog-coordinator'
import {
  type ClawRuntime
} from './claw-runtime'
import {
  type ScheduleRuntime
} from './schedule-runtime'
import {
  type WorkflowRuntime
} from './workflow-runtime'
import {
  type DaemonRuntime
} from './daemon-runtime'
import {
  type PowerSaveController
} from './power-save-controller'
import {
  storageRelocationControlRoot
} from './storage-relocation/paths'
import {
  activeStorageRelocationRequiresRecovery,
  pendingStorageRelocationOperationId,
  storageRelocationMetadataIsInvalid
} from './storage-relocation/store'
import {
  type ClawScheduleMcpLaunchConfig
} from './claw-schedule-mcp-config'
import {
  type TerminalPtyController
} from './terminal/terminal-pty-ipc'
import type { RemoteSshController } from './remote-ssh/register-remote-ssh-ipc'
import {
  ensureWeixinBridgeRpcUrl
} from './weixin-bridge-runtime'
import {
  type TelegramRuntime
} from './telegram-runtime'
import {
  registerKunExtensionPlatformSchemesAsPrivileged
} from './extensions/extension-media-protocol'
import {
  ExtensionViewSessionRegistry
} from './extensions/extension-view-sessions'
import {
  ExtensionExternalBrowserManager
} from './extensions/extension-external-browser'
import {
  ProtectedCredentialSurfaceController
} from './extensions/protected-credential-surface'
import {
  createAppEnvironmentInfo,
  resolveAppFlavor
} from '../shared/app-environment'

export const __dirname = dirname(fileURLToPath(import.meta.url))

/** Compare only the immutable renderer origin and entry document; query/hash are UI state. */
export function isTrustedWorkbenchUrl(candidate: string, trustedRendererUrl: string): boolean {
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

export function normalizeWorkbenchPathname(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

export function developmentRendererUrl(): string | undefined {
  return devServerHintUrl(app.isPackaged)
}

registerKunExtensionPlatformSchemesAsPrivileged(protocol)
export const startupTraceEnabled =
  process.env.KUN_STARTUP_TRACE === '1' || process.env.DEEPSEEK_GUI_STARTUP_TRACE === '1'
export const startupTraceStart = Date.now()

export function traceStartup(label: string, detail?: unknown): void {
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

export function syncWeixinBridgeRuntime(settings: AppSettingsV1): void {
  if (!shouldStartWeixinBridgeRuntime(settings)) return
  void ensureWeixinBridgeRpcUrl().catch((error) => {
    logWarn('weixin-bridge', 'Failed to start managed WeChat bridge.', {
      message: error instanceof Error ? error.message : String(error)
    })
  })
}

export const runningClawScheduleMcpServer =
  process.argv.includes('--gui-schedule-mcp-server') || process.argv.includes('--claw-schedule-mcp-server')

export function getClawScheduleMcpLaunchConfig(): ClawScheduleMcpLaunchConfig {
  return {
    appPath: app.getAppPath(),
    execPath: process.execPath,
    isPackaged: app.isPackaged
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function runtimeFailure(code: string, message: string, status = 0, details?: unknown) {
  return {
    ok: false as const,
    status,
    body: JSON.stringify({ code, message, ...(details !== undefined ? { details } : {}) })
  }
}

export function resolveConfiguredApiKey(settings: AppSettingsV1): string {
  const fromSettings = getActiveAgentApiKey(settings)
  const fromEnv = process.env.DEEPSEEK_API_KEY?.trim() ?? ''
  return fromSettings || fromEnv
}

export function runtimeJsonError(code: string, message: string): Error {
  return runtimeErrorToError({ code: code as RuntimeErrorCode, message })
}

const MAX_SHARED_CLIENT_STATE_ENTRIES = 64
const MAX_SHARED_CLIENT_STATE_VALUE_BYTES = 2 * 1024 * 1024

export function parseSharedClientState(raw: string | null): Record<string, string> {
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

export function parseSharedClientStateWrite(input: unknown): {
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
export const appFlavor = resolveAppFlavor({
  argv: process.argv,
  env: process.env,
  packagedFlavor: app.isPackaged ? readPackagedAppFlavor(app.getAppPath()) : undefined
})
export const desktopSmokeAppDataPath = configureDesktopSmokeAppDataPath()
export const appIdentity = configureAppIdentity({
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
export const legacyUserDataMigration = appIdentity.flavor === 'production'
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
export const appEnvironment = createAppEnvironmentInfo({
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


export type GuiUpdaterModule = typeof import('./gui-updater')

export const nativeDialogCoordinator = new NativeDialogCoordinator()
export const extensionViewSessions = new ExtensionViewSessionRegistry()
export const extensionExternalBrowsers = new ExtensionExternalBrowserManager(extensionViewSessions)
export const runtimeSettingsIntents = new RuntimeSettingsIntentSequencer()

export const mainState = {
  mainWindow: null as BrowserWindow | null,
  store: undefined as unknown as JsonSettingsStore,
  logDir: '',
  clawRuntime: null as ClawRuntime | null,
  scheduleRuntime: null as ScheduleRuntime | null,
  daemonRuntime: null as DaemonRuntime | null,
  powerSaveController: null as PowerSaveController | null,
  telegramRuntime: null as TelegramRuntime | null,
  workflowRuntime: null as WorkflowRuntime | null,
  appBehavior: normalizeAppBehaviorSettings() as AppBehaviorConfigV1,
  tray: null as Tray | null,
  trayAvailable: false,
  trayMenu: null as Menu | null,
  trayMenuOpenPromise: null as Promise<void> | null,
  trayQuotaWindow: null as BrowserWindow | null,
  trayQuotaWindowReady: null as Promise<void> | null,
  trayQuotaToggleGeneration: 0,
  disposeTrayQuotaIpc: null as (() => void) | null,
  closeWindowPromptOpen: false,
  checkpointCleanupTimer: null as ReturnType<typeof setInterval> | null,
  protectedCredentialSurface: null as ProtectedCredentialSurfaceController | null,
  bindExtensionMainWindow: undefined as ((window: BrowserWindow) => void) | undefined,
  shutdownDesktopResourceLeases: null as (() => Promise<void>) | null,
  waitForRuntimeOperationsIdle: null as (() => Promise<void>) | null,
  terminalPtyController: null as TerminalPtyController | null,
  remoteSshController: null as RemoteSshController | null,
  activeServiceManager: null as ServiceManagerConnection | null,
  runtimeDataRecoveryMigrationLock: null as CanonicalRuntimeMigrationLock | null,
  guiUpdaterModulePromise: null as Promise<GuiUpdaterModule> | null,
  guiUpdaterInitialized: false,
  canonicalRuntimeMigration: null as RuntimeDataDirMigrationResult | null,
  remainingHomeMigration: [] as ReturnType<typeof migrateLegacyHomeDataDirs>,
  remainingSettingsRewritten: false,
  settledRuntimeSettings: null as AppSettingsV1 | null,
  runtimeSettingsSyncStatus: {
    state: 'idle',
    generation: 0,
    at: new Date().toISOString()
  } as KunRuntimeSettingsSyncStatusPayload,
  createWindow: (_options: { suppressInitialShow?: boolean } = {}) => undefined as void,
  ensureRuntime: async (settings: AppSettingsV1) => settings,
  restartRuntime: async (_settings: AppSettingsV1) => undefined as void,
  assertCanonicalRuntimeMigrationReady: () => undefined as void,
  shutdownActiveServiceManagerForUpdate: async () => undefined as void
}

const appIconSource = process.platform === 'win32' ? kunMacLogoPng : kunLogoPng
export const appIcon = createAppIcon(appIconSource)
export const trayIcon = process.platform === 'darwin'
  ? createMultiScaleIcon(kunTrayMacPng, kunTrayMacRetinaPng)
  : createAppIcon(kunTrayPng)
traceStartup('app icon loaded', { source: appIconSource.startsWith('data:') ? 'data-url' : 'path' })
export const gotSingleInstanceLock = runningClawScheduleMcpServer || app.requestSingleInstanceLock()
traceStartup('single instance lock checked', {
  gotSingleInstanceLock,
  skippedForClawScheduleMcpServer: runningClawScheduleMcpServer
})
export const pendingStorageRelocationId = gotSingleInstanceLock &&
  !runningClawScheduleMcpServer &&
  appIdentity.flavor === 'production'
  ? pendingStorageRelocationOperationId(
      storageRelocationControlRoot(app.getPath('userData'))
    )
  : null
export const storageRelocationRecoveryRequired = Boolean(pendingStorageRelocationId) || (
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
export const startupMigrationLog = (message: string, detail?: unknown): void => {
  console.warn(`[kun-gui] ${message}`, detail ?? '')
}
export const remainingHomeMappings = HOME_DATA_MIGRATION_MAPPINGS.filter(
  (mapping) => mapping.legacySegments.join('/') !== '.deepseekgui/kun'
)
