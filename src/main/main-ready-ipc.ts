import {
  app,
  ipcMain,
  nativeTheme,
  systemPreferences
} from 'electron'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  applySettingsPatchToSnapshot
} from './settings-store'
import { preserveRedactedProviderCredentials } from './settings-credential-redaction'
import { syncLoginItemSettings } from './desktop-behavior'
import {
  getModelProviderSettings,
  resolveTerminalColorMode,
  type AppSettingsPatch,
  type AppSettingsV1
} from '../shared/app-settings'
import { fetchUpstreamModelIds, modelListFromSharedConnections } from './upstream-models'
import {
  acquireRuntimeRequestLease as acquireKunRuntimeRequestLease,
  getRuntimeBaseUrlForSettings,
  runtimeAuthHeaders
} from './runtime/kun-adapter'
import {
  resolveKunMcpJsonPath,
  syncClawScheduleMcpConfig
} from './claw-schedule-mcp-config'
import { registerAppIpcHandlers } from './ipc/register-app-ipc-handlers'
import { registerDevPreviewCaptureIpc } from './dev-preview-capture'
import { DataMigrationController } from './data-migration/data-migration-controller'
import { resolveDataMigrationFeatureEnabled } from './data-migration/feature-policy'
import {
  pollFeishuInstall,
  pollWeixinInstall,
  startFeishuInstallQrcode,
  startWeixinInstallQrcode
} from './claw-platform-install'
import { registerRuntimeSseIpc } from './runtime-sse-ipc'
import { registerTerminalPtyIpc } from './terminal/terminal-pty-ipc'
import { JsonRemoteSshHostStore } from './remote-ssh/host-store'
import { RemoteSshKnownHostStore } from './remote-ssh/known-host-store'
import { registerRemoteSshIpc } from './remote-ssh/register-remote-ssh-ipc'
import { registerCliInstallIpc } from './cli-install-service'
import { resetUnreadableWindowsCredentials } from './credential-recovery'
import { resolveSettingsDataDir } from './legacy-provider-settings-migration'
import {
  registerExtensionIpcHandlers,
  startExtensionNotificationPump,
  startExtensionSecretRevealConsentPump,
  type RegisterExtensionIpcHandlersOptions
} from './ipc/register-extension-ipc-handlers'
import { createExtensionWorkbenchEnvironment } from './extensions/extension-workbench-environment'
import { registerBrowserUseIpc } from './browser-use/register-browser-use-ipc'
import { updateComputerUseHostSettings } from './computer-use/computer-use-host'
import { browserUseCleanupForRuntimeRequest } from './browser-use/thread-lifecycle'
import { StorageRelocationController } from './storage-relocation/controller'
import { StorageRelocationEngine } from './storage-relocation/engine'
import { storageRelocationFeatureEnabled } from './storage-relocation/feature-policy'
import { UninstallController } from './uninstall/controller'
import { configureLogger, logError, logInfo, logWarn } from './logger'
import { resolveLogDirectory } from './main-paths'
import {
  appEnvironment,
  extensionExternalBrowsers,
  extensionViewSessions,
  getClawScheduleMcpLaunchConfig,
  mainState,
  nativeDialogCoordinator,
  resolveConfiguredApiKey,
  runtimeSettingsIntents,
  syncWeixinBridgeRuntime,
  traceStartup
} from './main-app-context'
import {
  loadGuiUpdaterModule,
  readGuiUpdateState,
  runtimeShutdown,
  syncCheckpointCleanupTimer
} from './main-lifecycle'
import {
  assertCanonicalRuntimeMigrationReady,
  interruptStorageRelocationWork,
  listStorageRelocationActiveWork,
  shutdownServiceManagerAndWait
} from './main-migrations'
import {
  preserveRuntimeTokenForFullSettingsSnapshot,
  queueRuntimeMcpConfigApply,
  queueRuntimeSettingsApply,
  reserveRuntimeSettingsApply,
  runtimeRequest,
  runtimeRequestOnLease,
  validateRuntimeSettingsForApply
} from './main-runtime-settings'
import {
  ensureRuntime,
  restartAllKunServeProcesses,
  restartRuntime
} from './main-runtime-startup'
import {
  destroyTrayQuotaPopover,
  notifyTrayQuotaRefresh,
  showTurnCompleteNotification,
  syncTray
} from './main-tray'
import type { MainServices } from './main-ready-services'

export function registerMainIpc(services: MainServices): void {
  const {
    browserUseManager,
    credentialMigration,
    extensionContentScripts,
    extensionDescriptors,
    extensionMediaProtocols,
    extensionViewProtocols,
    protectedExtensionActions,
    productionSettingsUserDataPath,
    serviceManager,
    withRegistryCredentials,
    workspacePreviewProtocols
  } = services
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
      const { previous, saved } = await runtimeSettingsIntents.serializePersistence(async () => {
        let committedPrevious: AppSettingsV1 | undefined
        const saved = await mainState.store.update((current) => {
          const effectivePartial = preserveRedactedProviderCredentials(
            current,
            preserveRuntimeTokenForFullSettingsSnapshot(current, partial)
          )
          const requestedDataDir = effectivePartial.agents?.kun?.dataDir
          if (
            appEnvironment.flavor === 'production' &&
            typeof requestedDataDir === 'string' &&
            requestedDataDir !== current.agents.kun.dataDir
          ) {
            throw new Error('Kun data location is managed from Settings > Storage on Windows.')
          }
          const next = applySettingsPatchToSnapshot(current, effectivePartial)
          const runtimeValidationError = validateRuntimeSettingsForApply(next)
          if (runtimeValidationError) {
            throw new Error(`Invalid runtime settings: ${runtimeValidationError}`)
          }
          committedPrevious = current
          return next
        })
        if (!committedPrevious) throw new Error('Settings persistence completed without a source snapshot')
        const previous = committedPrevious
        const reservation = reserveRuntimeSettingsApply(previous, saved)
        // Insert the settings barrier in the same synchronous commit section as
        // generation reservation. No ensure/restart can observe this durable
        // snapshot before its preparation/apply node exists in the FIFO lane.
        queueRuntimeSettingsApply(previous, saved, reservation, async () => {
          if (!services.ownsDesktopBackgroundServices()) return
          await syncClawScheduleMcpConfig(saved, getClawScheduleMcpLaunchConfig()).catch((error) => {
            console.error('[claw-schedule-mcp] failed to sync config after settings change:', error)
          })
        })
        return { previous, saved }
      })
      if (
        previous.log.enabled !== saved.log.enabled ||
        previous.log.retentionDays !== saved.log.retentionDays
      ) {
        configureLogger({ enabled: saved.log.enabled, retentionDays: saved.log.retentionDays })
      }
      updateComputerUseHostSettings(saved)
      if (previous.guiUpdate.channel !== saved.guiUpdate.channel && mainState.guiUpdaterModulePromise) {
        void mainState.guiUpdaterModulePromise.then((module) => module.setGuiUpdateChannel(saved.guiUpdate.channel))
      }
      try {
        mainState.scheduleRuntime?.sync(saved)
        mainState.workflowRuntime?.sync(saved)
        mainState.daemonRuntime?.sync(saved)
        mainState.clawRuntime?.sync(saved)
      } catch (error) {
        logError('settings-apply', 'failed to sync schedule/claw runtimes after settings change', {
          message: error instanceof Error ? error.message : String(error)
        })
      }
      if (services.ownsDesktopBackgroundServices()) syncWeixinBridgeRuntime(saved)
      syncLoginItemSettings(saved)
      syncTray(saved)
      if (services.ownsDesktopBackgroundServices()) syncCheckpointCleanupTimer(saved)
      requestExtensionWorkbenchEnvironmentPublish()
      return saved
    }

    const fetchModels = async () => {
      const storedSettings = await mainState.store.load()
      let settings = storedSettings
      try {
        settings = await withRegistryCredentials(storedSettings)
      } catch (error) {
        // Model names are not secret. Retain the saved catalog while a
        // protected credential read is temporarily unavailable, rather than
        // making the composer claim that every provider is unconfigured.
        logWarn('upstream-models', 'Falling back to saved model catalog after credential projection failed.', {
          message: error instanceof Error ? error.message : String(error)
        })
      }
      try {
        const shared = await runtimeRequest(settings, '/v1/model-connections', { method: 'GET' })
        if (shared.ok) {
          try {
            const providerSettings = getModelProviderSettings(settings)
            const configuredProviderLabels = new Map(
              providerSettings.providers.flatMap((provider) => {
                const providerId = provider.id.trim().toLowerCase()
                const label = provider.name.trim()
                return providerId && label ? [[providerId, label]] : []
              })
            )
            const live = modelListFromSharedConnections(
              JSON.parse(shared.body) as unknown,
              providerSettings.localGateway.name,
              configuredProviderLabels
            )
            if (live) return live
          } catch {
            // Fall back to the compatibility settings projection below.
          }
        }
      } catch (error) {
        // The runtime can be restarting while the renderer opens. The saved
        // model catalog keeps the picker usable until the next live sync.
        logWarn('upstream-models', 'Falling back to saved model catalog after runtime lookup failed.', {
          message: error instanceof Error ? error.message : String(error)
        })
      }
      const key = resolveConfiguredApiKey(settings)
      return fetchUpstreamModelIds(settings, key)
    }

    const saveSettingsPatch = async (partial: AppSettingsPatch): Promise<AppSettingsV1> => {
      const saved = await runtimeSettingsIntents.serializePersistence(async () => {
        let committedPrevious: AppSettingsV1 | undefined
        const saved = await mainState.store.update((current) => {
          const effectivePartial = preserveRedactedProviderCredentials(
            current,
            preserveRuntimeTokenForFullSettingsSnapshot(current, partial)
          )
          const requestedDataDir = effectivePartial.agents?.kun?.dataDir
          if (
            appEnvironment.flavor === 'production' &&
            typeof requestedDataDir === 'string' &&
            requestedDataDir !== current.agents.kun.dataDir
          ) {
            throw new Error('Kun data location is managed from Settings > Storage on Windows.')
          }
          const next = applySettingsPatchToSnapshot(current, effectivePartial)
          const runtimeValidationError = validateRuntimeSettingsForApply(next)
          if (runtimeValidationError) {
            throw new Error(`Invalid runtime settings: ${runtimeValidationError}`)
          }
          committedPrevious = current
          return next
        })
        if (!committedPrevious) throw new Error('Settings persistence completed without a source snapshot')
        const previous = committedPrevious
        const reservation = reserveRuntimeSettingsApply(previous, saved)
        // Silent saves still carry durable Runtime intent (for example the
        // composer model/provider selection). Keep them in the same lifecycle
        // order; "silent" only suppresses the normal settings UI side effects.
        queueRuntimeSettingsApply(previous, saved, reservation, async () => {
          if (!services.ownsDesktopBackgroundServices()) return
          await syncClawScheduleMcpConfig(saved, getClawScheduleMcpLaunchConfig()).catch((error) => {
            console.error('[claw-schedule-mcp] failed to sync config after silent settings save:', error)
          })
        })
        return saved
      })
      requestExtensionWorkbenchEnvironmentPublish()
      return saved
    }

    registerAppIpcHandlers({
      store: mainState.store,
      withRegistryCredentials,
      getMainWindow: () => mainState.mainWindow,
      applySettingsPatch,
      saveSettingsPatch,
      resetUnreadableCredentials: async () => {
        assertCanonicalRuntimeMigrationReady()
        const dataDir = resolveSettingsDataDir(await mainState.store.load())
        const result = await resetUnreadableWindowsCredentials(dataDir)
        credentialMigration?.invalidateRuntime(dataDir)
        return { reset: true as const, ...result }
      },
      runtimeRequest: async (path, method, body, headers) => {
        const settings = await mainState.store.load()
        const result = await runtimeRequest(settings, path, { method, body, headers })
        const cleanup = result.ok
          ? browserUseCleanupForRuntimeRequest({ path, method, body })
          : undefined
        if (cleanup) await browserUseManager.clear(cleanup.threadId, cleanup.reason)
        return result
      },
      acquireRuntimeRequestLease: async () => {
        const settings = await mainState.store.load()
        const lease = await acquireKunRuntimeRequestLease(settings, ensureRuntime)
        return Object.freeze({
          runtimeToken: lease.runtimeToken,
          request: (path: string, method?: string, body?: string, headers?: Record<string, string>) =>
            runtimeRequestOnLease(lease, path, { method, body, headers })
        })
      },
      getRuntimeSettingsSyncStatus: () => mainState.runtimeSettingsSyncStatus,
      restartRuntime: async () => {
        const settings = await mainState.store.load()
        await restartRuntime(settings)
      },
      restartKunServe: async () => {
        const settings = await mainState.store.load()
        await restartAllKunServeProcesses(settings)
      },
      fetchUpstreamModels: fetchModels,
      getClawRuntime: () => mainState.clawRuntime,
      getScheduleRuntime: () => mainState.scheduleRuntime,
      getDaemonRuntime: () => mainState.daemonRuntime,
      getWorkflowRuntime: () => mainState.workflowRuntime,
      startFeishuInstallQrcode,
      pollFeishuInstall,
      startWeixinInstallQrcode,
      pollWeixinInstall,
      resolveKunConfigPath: resolveKunMcpJsonPath,
      resolveSettingsConfigPath: () => serviceManager.discovery.settingsPath,
      onKunMcpConfigWritten: async () => {
        const settings = await mainState.store.load()
        queueRuntimeMcpConfigApply(settings)
      },
      onKunProjectConfigChanged: async () => {
        const settings = await mainState.store.load()
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
    registerDevPreviewCaptureIpc({ getMainWindow: () => mainState.mainWindow })
    const disposeBrowserUseIpc = registerBrowserUseIpc({
      ipcMain,
      manager: browserUseManager,
      getMainWindow: () => mainState.mainWindow
    })
    const dataMigrationController = new DataMigrationController({
      userDataPath: app.getPath('userData'),
      store: mainState.store,
      getMainWindow: () => mainState.mainWindow,
      runtimeFetch: async (path, init = {}) => {
        const settings = await mainState.store.load()
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
        if (mainState.mainWindow && !mainState.mainWindow.isDestroyed()) {
          mainState.mainWindow.webContents.send('storage-relocation:progress', progress)
        }
      }
    })
    new StorageRelocationController({
      engine: storageRelocationEngine,
      getMainWindow: () => mainState.mainWindow,
      loadSettings: () => mainState.store.load(),
      prepareForRestart: async () => {
        await interruptStorageRelocationWork(serviceManager)
        runtimeShutdown.setStorageRelocationQuit(true)
        await runtimeShutdown.stopForQuit()
        await shutdownServiceManagerAndWait(serviceManager)
        if (mainState.activeServiceManager === serviceManager) mainState.activeServiceManager = null
        mainState.mainWindow?.destroy()
        app.relaunch()
        app.exit(0)
      }
    }).registerIpc()
    new UninstallController({
      getMainWindow: () => mainState.mainWindow,
      getUserDataPath: () => app.getPath('userData'),
      getExecPath: () => process.execPath,
      isPackaged: () => app.isPackaged,
      getAppImageEnv: () => process.env.APPIMAGE,
      loadSettings: () => mainState.store.load(),
      prepareForUninstall: async () => {
        await interruptStorageRelocationWork(serviceManager)
        await runtimeShutdown.stopForQuit()
        await shutdownServiceManagerAndWait(serviceManager)
        if (mainState.activeServiceManager === serviceManager) mainState.activeServiceManager = null
        mainState.mainWindow?.destroy()
      }
    }).registerIpc()
    const extensionIpcOptions: RegisterExtensionIpcHandlersOptions = {
      getMainWindow: () => mainState.mainWindow,
      runtimeRequest: async (path, method, body, headers) => {
        const settings = await mainState.store.load()
        return runtimeRequest(settings, path, { method, body, headers })
      },
      descriptors: extensionDescriptors,
      viewSessions: extensionViewSessions,
      viewProtocols: extensionViewProtocols,
      externalBrowsers: extensionExternalBrowsers,
      mediaProtocols: extensionMediaProtocols,
      protectedActions: protectedExtensionActions,
      credentialSurface: mainState.protectedCredentialSurface!,
      contentScripts: extensionContentScripts,
      getWorkbenchEnvironment: async () => {
        const settings = await mainState.store.load()
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
          zoomFactor: mainState.mainWindow && !mainState.mainWindow.isDestroyed()
            ? mainState.mainWindow.webContents.getZoomFactor()
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
    mainState.bindExtensionMainWindow = (window) => {
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
      mainState.disposeTrayQuotaIpc?.()
      mainState.disposeTrayQuotaIpc = null
      destroyTrayQuotaPopover()
      disposeBrowserUseIpc()
      stopSecretRevealConsentPump()
      stopExtensionNotificationPump()
      extensionIpcRegistration.dispose()
      extensionExternalBrowsers.destroy()
      mainState.bindExtensionMainWindow = undefined
      nativeTheme.removeListener('updated', onNativeThemeUpdated)
      mainState.mainWindow?.webContents.removeListener('zoom-changed', onWorkbenchZoomChanged)
      mainState.remoteSshController?.disposeAll()
      mainState.remoteSshController = null
    })

    void loadGuiUpdaterModule().catch((error) => {
      console.warn('[kun-gui updater] failed to initialize on startup:', error)
    })

    registerRuntimeSseIpc({ ipcMain, store: mainState.store, ensureRuntime, logError })
    registerCliInstallIpc(ipcMain)

    mainState.terminalPtyController = registerTerminalPtyIpc({
      ipcMain,
      getMainWindow: () => mainState.mainWindow,
      logError,
      getTerminalColorMode: async () => resolveTerminalColorMode(await mainState.store.load())
    })
    const remoteSshDataDir = join(app.getPath('userData'), 'remote-ssh')
    mainState.remoteSshController = registerRemoteSshIpc({
      ipcMain,
      getMainWindow: () => mainState.mainWindow,
      hosts: new JsonRemoteSshHostStore(join(remoteSshDataDir, 'hosts.json')),
      knownHosts: new RemoteSshKnownHostStore(join(remoteSshDataDir, 'known-hosts.json')),
      logError
    })
    traceStartup('ipc registration:done')
}
