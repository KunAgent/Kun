import {
  app,
  ipcMain,
  nativeTheme,
  powerSaveBlocker,
  protocol,
  session,
  shell
} from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  JsonSettingsStore
} from './settings-store'
import kunMacLogoPng from '../asset/img/kun_mac.png?url'
import { createAppIcon } from './app-icon'
import { requestRuntimeProviderQuotas } from './runtime-provider-quota'
import { registerTrayQuotaIpc } from './tray-quota-ipc'
import { clearDevelopmentRendererHttpCache } from './dev-renderer-cache'
import { syncLoginItemSettings } from './desktop-behavior'
import { resolveLogDirectory, resolveNamedPreloadPath } from './main-paths'
import { SETTINGS_FILE_NAME } from './settings-file-paths'
import {
  type AppSettingsV1
} from '../shared/app-settings'
import {
  ManagerResourceLeaseClient,
  ManagerRevisionedDocumentClient
} from '../../kun/src/manager/manager-client.js'
import {
  configureKunManagerDataPlaneForCurrentProcess,
  ensureKunServiceManager,
  resolveKunManagerDataDirFromSettings,
  setKunUnexpectedExitHandler
} from './kun-process'
import { LegacyProviderSettingsMigrationCoordinator } from './legacy-provider-settings-migration'
import { configureLogger, logError, logWarn } from './logger'
import { createClawRuntime } from './claw-runtime'
import { createScheduleRuntime } from './schedule-runtime'
import { createWorkflowRuntime } from './workflow-runtime'
import { createDaemonRuntime } from './daemon-runtime'
import { createDaemonPushText } from './daemon-push-service'
import { createPowerSaveController } from './power-save-controller'
import { inspectPackagedInstallHealth } from './packaged-install-health'
import { registerKunExtensionProtocol } from './extensions/extension-resource-protocol'
import { ExtensionMediaProtocolRegistry } from './extensions/extension-media-protocol'
import { ExtensionDescriptorResolver } from './extensions/extension-descriptor-resolver'
import { ExtensionViewProtocolRegistry } from './extensions/extension-view-protocol-registry'
import {
  ExtensionConsentTokenService,
  ProtectedExtensionActionService
} from './extensions/extension-consent-service'
import { localizeProtectedExtensionPrompt } from './extensions/protected-extension-prompt'
import { ProtectedCredentialSurfaceController } from './extensions/protected-credential-surface'
import { ExtensionContentScriptController } from './extensions/extension-content-script-controller'
import { WorkspacePreviewProtocolRegistry } from './services/workspace-preview-protocol'
import {
  configureBrowserUseHost
} from './browser-use/browser-use-host'
import { configureComputerUseHost } from './computer-use/computer-use-host'
import { createTelegramRuntime } from './telegram-runtime'
import {
  configureManagedWeixinBridgeUrlResolver
} from './claw-platform-install'
import {
  configureWeixinBridgeRuntimeContextProvider,
  ensureWeixinBridgeRpcUrl,
  getWeixinBridgeAccountUserId,
  sendWeixinBridgeMessage,
  stopWeixinBridgeRuntime
} from './weixin-bridge-runtime'
import { webhookUrl } from './claw-runtime-helpers'
import { syncClawScheduleMcpConfig } from './claw-schedule-mcp-config'
import {
  __dirname,
  appEnvironment,
  appIcon,
  appIdentity,
  developmentRendererUrl,
  extensionViewSessions,
  getClawScheduleMcpLaunchConfig,
  gotSingleInstanceLock,
  mainState,
  nativeDialogCoordinator,
  parseSharedClientState,
  parseSharedClientStateWrite,
  pendingStorageRelocationId,
  storageRelocationRecoveryRequired,
  syncWeixinBridgeRuntime,
  traceStartup
} from './main-app-context'
import {
  emitClawChannelActivity,
  installDevPreviewWebviewGuards,
  runCheckpointCleanup,
  stopCheckpointCleanupTimer,
  syncCheckpointCleanupTimer
} from './main-lifecycle'
import {
  runRuntimeDataRecoveryMaintenance,
  runStartupLegacyMigrations,
  runStorageRelocationMaintenance
} from './main-migrations'
import { handleUnexpectedKunExit, runtimeSupervisor } from './main-runtime-health'
import {
  runtimeRequest
} from './main-runtime-settings'
import {
  dispatchTrayAction,
  hideTrayQuotaPopover,
  revealMainWindow,
  syncTray
} from './main-tray'

export interface MainServices {
  initial: AppSettingsV1
  serviceManager: Awaited<ReturnType<typeof ensureKunServiceManager>>
  withRegistryCredentials: (
    settings: AppSettingsV1,
    providerIds?: readonly string[]
  ) => Promise<AppSettingsV1>
  browserUseManager: ReturnType<typeof configureBrowserUseHost>
  extensionDescriptors: ExtensionDescriptorResolver
  workspacePreviewProtocols: WorkspacePreviewProtocolRegistry
  extensionMediaProtocols: ExtensionMediaProtocolRegistry
  extensionViewProtocols: ExtensionViewProtocolRegistry
  protectedExtensionActions: ProtectedExtensionActionService
  extensionContentScripts: ExtensionContentScriptController
  credentialMigration: LegacyProviderSettingsMigrationCoordinator | undefined
  productionSettingsUserDataPath: string
  ownsDesktopBackgroundServices: () => boolean
}

export async function initializeMainServices(): Promise<MainServices | null> {
    // A detached Runtime and its Service Manager are shared by GUI, TUI, and
    // other local clients. Desktop startup must attach through the Manager,
    // not terminate processes by name before their registrations can be
    // reconciled. Broad historical-process cleanup remains an explicit
    // replacement/update action only.
    const installHealth = inspectPackagedInstallHealth({
      isPackaged: app.isPackaged,
      executablePath: process.execPath,
      resourcesPath: process.resourcesPath
    })
    if (!installHealth.ok) {
      throw new Error(
        `Kun installation needs repair. The installed application is incomplete (${installHealth.missing.join(', ')}). Reinstall Kun and try again.`
      )
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
      return null
    }
    if (appIdentity.flavor === 'production') {
      traceStartup('runtime data migration:start')
      const migrationResult = await runStartupLegacyMigrations()
      traceStartup('runtime data migration:done', {
        status: migrationResult.status
      })
      if (migrationResult.status === 'blocked') {
        traceStartup('runtime data recovery maintenance:start', {
          message: migrationResult.message
        })
        await runRuntimeDataRecoveryMaintenance()
        return null
      }
    }
    const managerDataDir = await resolveKunManagerDataDirFromSettings(productionSettingsPath)
    const serviceManager = await ensureKunServiceManager({
      settingsPath: productionSettingsPath,
      dataDir: managerDataDir
    })
    mainState.activeServiceManager = serviceManager
    // Main still hosts a handful of legacy model consumers. Point their
    // Registry/credential projection at the exact Manager-owned data plane used
    // by both Runtime flavors; a process-local AtomicJson fallback would bypass
    // durable credential fences and race Runtime OAuth refreshes.
    configureKunManagerDataPlaneForCurrentProcess(serviceManager)
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
    const credentialMigration = mainState.canonicalRuntimeMigration?.status === 'blocked'
      ? undefined
      : new LegacyProviderSettingsMigrationCoordinator()
    const withRegistryCredentials = (
      settings: AppSettingsV1,
      providerIds?: readonly string[]
    ): Promise<AppSettingsV1> =>
      credentialMigration?.withRegistryCredentials(settings, providerIds) ?? Promise.resolve(settings)
    mainState.store = credentialMigration
      ? new JsonSettingsStore(productionSettingsUserDataPath, {
          credentialMigration,
          documentBackend: sharedSettingsBackend
        })
      : new JsonSettingsStore(productionSettingsUserDataPath, {
          rejectPlaintextCredentials: mainState.canonicalRuntimeMigration?.status === 'blocked',
          documentBackend: sharedSettingsBackend
        })
    traceStartup('settings load:start')
    const initial = await mainState.store.load()
    mainState.settledRuntimeSettings = initial
    runtimeSupervisor.noteLatest(initial)
    mainState.disposeTrayQuotaIpc = registerTrayQuotaIpc({
      ipcMain,
      getWindow: () => mainState.trayQuotaWindow,
      list: async () => {
        const settings = await mainState.store.load()
        return requestRuntimeProviderQuotas((path, method) =>
          runtimeRequest(settings, path, { method })
        )
      },
      context: async () => {
        const settings = await mainState.store.load()
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
      getMainWindow: () => mainState.mainWindow
    })
    configureComputerUseHost({ settings: initial })
    traceStartup('settings load:done')
    const extensionDescriptors = new ExtensionDescriptorResolver(async (path, method, body) => {
      const settings = await mainState.store.load()
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
    mainState.protectedCredentialSurface = new ProtectedCredentialSurfaceController(
      resolveNamedPreloadPath(__dirname, 'extension-protected-surface')
    )
    mainState.protectedCredentialSurface.register()
    const protectedExtensionActions = new ProtectedExtensionActionService(
      extensionConsentTokens,
      async (binding, copy) => {
        const settings = await mainState.store.load()
        const prompt = localizeProtectedExtensionPrompt(binding, copy, settings.locale)
        const parent = mainState.mainWindow && !mainState.mainWindow.isDestroyed() ? mainState.mainWindow : undefined
        return mainState.protectedCredentialSurface!.promptConsent(parent ?? null, {
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
    mainState.appBehavior = initial.appBehavior
    syncLoginItemSettings(initial)
    mainState.logDir = resolveLogDirectory(app)
    configureLogger({
      dir: mainState.logDir,
      enabled: initial.log.enabled,
      retentionDays: initial.log.retentionDays
    })
    traceStartup('logger configured')
    syncTray(initial)
    let ownsDesktopBackgroundServices = false
    const startDesktopBackgroundServices = async (): Promise<void> => {
      if (mainState.scheduleRuntime || mainState.workflowRuntime || mainState.clawRuntime || mainState.telegramRuntime || mainState.daemonRuntime) return
      ownsDesktopBackgroundServices = true
      const settings = await mainState.store.load()
      await syncClawScheduleMcpConfig(settings, getClawScheduleMcpLaunchConfig()).catch((error) => {
        console.error('[claw-schedule-mcp] failed to sync config on desktop-host acquisition:', error)
      })
      void runCheckpointCleanup(settings, { force: true, reason: 'startup' })
      syncCheckpointCleanupTimer(settings)
      mainState.powerSaveController = createPowerSaveController(powerSaveBlocker)
      mainState.scheduleRuntime = createScheduleRuntime({
        store: mainState.store,
        withModelCredentials: withRegistryCredentials,
        runtimeRequest,
        logError,
        powerSaveController: mainState.powerSaveController
      })
      mainState.scheduleRuntime.sync(settings)
      mainState.workflowRuntime = createWorkflowRuntime({
        store: mainState.store,
        withModelCredentials: withRegistryCredentials,
        runtimeRequest,
        logError,
        powerSaveBlocker
      })
      mainState.workflowRuntime.sync(settings)
      mainState.telegramRuntime = createTelegramRuntime({
        store: mainState.store,
        logError,
        onInbound: (payload) => mainState.clawRuntime?.handleTelegramUpdate(payload)
      })
      mainState.clawRuntime = createClawRuntime({
        store: mainState.store,
        runtimeRequest,
        logError,
        notifyChannelActivity: emitClawChannelActivity,
        sendWeixinBridgeMessage,
        resolveWeixinAccountUserId: getWeixinBridgeAccountUserId,
        telegramRuntime: mainState.telegramRuntime,
        createScheduledTaskFromText: (text, options) =>
          mainState.scheduleRuntime?.createScheduledTaskFromText(text, options) ?? Promise.resolve({ kind: 'noop' })
      })
      mainState.clawRuntime.sync(settings)
      mainState.telegramRuntime.sync(settings)
      mainState.daemonRuntime = createDaemonRuntime({
        store: mainState.store,
        logError,
        logDir: mainState.logDir,
        powerSaveController: mainState.powerSaveController ?? undefined,
        pushText: createDaemonPushText({
          store: mainState.store,
          logError,
          sendWeixinBridgeMessage
        })
      })
      mainState.daemonRuntime.sync(settings)
      syncWeixinBridgeRuntime(settings)
    }
    const stopDesktopBackgroundServices = async (): Promise<void> => {
      ownsDesktopBackgroundServices = false
      stopCheckpointCleanupTimer()
      const [schedule, workflow, claw, telegram, daemon] = [
        mainState.scheduleRuntime,
        mainState.workflowRuntime,
        mainState.clawRuntime,
        mainState.telegramRuntime,
        mainState.daemonRuntime
      ] as const
      mainState.scheduleRuntime = null
      mainState.workflowRuntime = null
      mainState.clawRuntime = null
      mainState.telegramRuntime = null
      mainState.daemonRuntime = null
      mainState.powerSaveController = null
      await Promise.allSettled([
        schedule?.stop(),
        workflow?.stop(),
        claw?.stop(),
        telegram?.stop(),
        daemon?.stop(),
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
    mainState.shutdownDesktopResourceLeases = () => desktopResourceLeases.shutdown()
    configureWeixinBridgeRuntimeContextProvider(async () => {
      const settings = await mainState.store.load()
      const channel = settings.claw.channels.find((item) => item.enabled && item.provider === 'weixin')
      return {
        webhookUrl: webhookUrl(settings),
        webhookSecret: settings.claw.im.secret,
        channelId: channel?.id ?? '',
        resolveLocalSendTarget: (channelId, conversationId) => {
          const targetChannel = settings.claw.channels.find(
            (item) => item.id === channelId && item.enabled && item.provider === 'weixin'
          )
          if (!targetChannel) {
            return { ok: false, code: 'channel_not_found', message: 'WeChat channel is missing or disabled.' }
          }
          const conversation = targetChannel.conversations.find((item) => item.id === conversationId)
          if (!conversation?.chatId.trim()) {
            return { ok: false, code: 'conversation_not_found', message: 'WeChat conversation is missing.' }
          }
          const credential = targetChannel.platformCredential
          if (credential?.kind !== 'weixin' || !credential.accountId.trim()) {
            return { ok: false, code: 'channel_not_configured', message: 'WeChat account is not configured.' }
          }
          return { ok: true, accountId: credential.accountId.trim(), to: conversation.chatId.trim() }
        }
      }
    })
    configureManagedWeixinBridgeUrlResolver(ensureWeixinBridgeRpcUrl)

  return {
    initial,
    serviceManager,
    withRegistryCredentials,
    browserUseManager,
    extensionDescriptors,
    workspacePreviewProtocols,
    extensionMediaProtocols,
    extensionViewProtocols,
    protectedExtensionActions,
    extensionContentScripts,
    credentialMigration,
    productionSettingsUserDataPath,
    ownsDesktopBackgroundServices: () => ownsDesktopBackgroundServices
  }
}
