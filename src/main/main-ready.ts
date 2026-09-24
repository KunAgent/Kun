import { app, dialog, type BrowserWindow } from 'electron'
import { shouldStartHidden } from './desktop-behavior'
import { disposeProxyAgents } from './proxy-fetch'
import { maybePromptCliInstall } from './cli-install-service'
import { managedKunHostCanAutoStart } from './managed-runtime-startup-policy'
import { kunRuntimeAdapter } from './runtime/kun-adapter'
import { configureLogger, logError, logInfo, pruneOnStartup, logWarn } from './logger'
import {
  gotSingleInstanceLock,
  mainState,
  runningClawScheduleMcpServer,
  traceStartup
} from './main-app-context'
import {
  loadGuiUpdaterModule,
  stopManagedRuntimes,
  runtimeShutdown
} from './main-lifecycle'
import {
  assertCanonicalRuntimeMigrationReady,
  createStartupKunHandoffRecovery,
  shutdownActiveServiceManagerForUpdate
} from './main-migrations'
import {
  applyManagedRuntimeSettingsHot
} from './main-runtime-settings'
import {
  runtimeSupervisor
} from './main-runtime-health'
import {
  recoverDesktopManagerAfterExit,
  ensureKunServeFreshOnStartup,
  ensureRuntime,
  prepareGuiRuntimeForStartupRetry,
  reconcileBundledRuntimeAfterInstall,
  restartRuntime
} from './main-runtime-startup'
import {
  createStartupSettingsApply,
  runPostWindowRuntimeStartup
} from './main-runtime-startup-flow'
import { startWindowFirstStartup } from './main-startup-orchestrator'
import { createWindow } from './main-window'
import { MainWindowActivationCoordinator } from './main-window-activation'
import { initializeMainServices } from './main-ready-services'
import { initializeWindowShell } from './main-ready-shell'
import { registerShellIpc } from './main-ready-ipc'
import { registerMainIpc } from './main-ready-ipc-full'
import { revealMainWindow, syncTray } from './main-tray'
import { resolveLogDirectory } from './main-paths'
import { showStartupFailureWindow } from './startup-failure-window'
import { sanitizeStartupFailureMessage } from './startup-failure-content'
import {
  captureDesktopInstanceIdentity,
  decideDesktopInstanceLock,
  formatDesktopInstanceConflictMessage,
  readDesktopInstanceIdentity,
  writeDesktopInstanceIdentity
} from './desktop-instance-identity'
import { resolveManagedRuntimeStartupTarget } from './runtime/managed-runtime-startup-attach'
import { join } from 'node:path'
import { prefetchCatalogPricing } from './catalog-prefetch'
import { attachModelsDevDiskCache } from './models-dev-catalog'
import { recoverUpdateBeforeRuntimeStart } from './update-bootstrap-recovery'
import { installHostPowerRecovery } from './host-power-recovery'
import { desktopProcessStack } from './runtime/desktop-process-stack'
import {
  stageProviderImportLink,
  type StagedProviderImportLink
} from './provider-import-link'

export function startMainApp(): Promise<void> {
  mainState.createWindow = createWindow
  mainState.ensureRuntime = ensureRuntime
  mainState.restartRuntime = restartRuntime
  mainState.assertCanonicalRuntimeMigrationReady = assertCanonicalRuntimeMigrationReady
  mainState.shutdownActiveServiceManagerForUpdate = shutdownActiveServiceManagerForUpdate
  mainState.stopDesktopServicesForRecovery = stopManagedRuntimes
  desktopProcessStack.setManagerExitHandler(() => {
    void recoverDesktopManagerAfterExit().catch((error) => {
      logWarn('manager-recovery', 'Application data service recovery failed.', {
        message: error instanceof Error ? error.message : String(error)
      })
    })
  })

  try {
    mainState.logDir = resolveLogDirectory(app)
    configureLogger({ dir: mainState.logDir, enabled: true })
    logInfo('startup', 'Desktop startup entered.', {
      platform: process.platform,
      packaged: app.isPackaged,
      appVersion: app.getVersion(),
      executablePath: process.execPath,
      appPath: app.getAppPath()
    })
  } catch (error) {
    console.warn('[kun-gui] failed to configure bootstrap startup logging:', error)
  }

  const activation = new MainWindowActivationCoordinator(
    () => mainState.mainWindow,
    revealMainWindow
  )

  // kun://import deep links (plan §6.12). The staged draft is delivered to the
  // workbench; the key itself stays staged in this process until the user
  // confirms through the commit IPC.
  let stagedImportLink: StagedProviderImportLink | null = null
  const deliverImportLink = (window: BrowserWindow | null): void => {
    if (!window || !stagedImportLink) return
    const staged = stagedImportLink
    const send = (): void => {
      stagedImportLink = null
      if (!window.isDestroyed()) window.webContents.send('provider:import-link', staged)
    }
    if (window.webContents.isLoadingMainFrame()) {
      window.webContents.once('did-finish-load', send)
    } else {
      send()
    }
  }
  const onImportLink = (raw: string): void => {
    const staged = stageProviderImportLink(raw)
    if (!staged.ok) {
      logWarn('provider-import-link', 'Rejected kun:// import link.', { message: staged.message })
      return
    }
    stagedImportLink = staged.staged
    activation.requestReveal()
    deliverImportLink(mainState.mainWindow)
  }
  app.setAsDefaultProtocolClient('kun')
  app.on('open-url', (event, url) => {
    event.preventDefault()
    onImportLink(url)
  })
  app.on('second-instance', (_event, argv) => {
    activation.requestReveal()
    const link = argv.find((arg) => /^kun:\/\/import/i.test(arg))
    if (link) onImportLink(link)
  })

  const handleStartupFailure = async (error: unknown): Promise<void> => {
    if (runtimeShutdown.isQuitInProgress) return
    runtimeSupervisor.setManagedRuntimeExpected(false)
    desktopProcessStack.beginStop()
    await stopManagedRuntimes().catch((cleanupError) => {
      logWarn('startup', 'Failed startup resource cleanup was incomplete.', {
        message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      })
    })
    const message = sanitizeStartupFailureMessage(error)
    if (!mainState.startupState.isReady()) {
      try {
        mainState.startupState.transition('recovery_required', message)
      } catch {
        // Keep the recovery path total even if a test or future caller reaches
        // failure from an unexpected state.
      }
    }
    const earlyWindow = mainState.mainWindow
    console.error('[kun-gui] startup failed:', message)
    logError('startup', 'Desktop startup failed.', {
      platform: process.platform,
      packaged: app.isPackaged,
      message
    })
    const recoverHandoff = createStartupKunHandoffRecovery(error)
    const recoveryWindow = showStartupFailureWindow(
      error,
      mainState.logDir,
      {
        ...(recoverHandoff ? { recoverHandoff } : {}),
        recoverRetry: () => prepareGuiRuntimeForStartupRetry(error),
        replaceWindow: earlyWindow
      }
    )
    if (recoveryWindow) {
      mainState.mainWindow = recoveryWindow
      recoveryWindow.on('closed', () => {
        if (mainState.mainWindow === recoveryWindow) mainState.mainWindow = null
      })
      activation.windowAvailable()
    }
  }

  const createWorkbenchWindow = (options: {
    suppressInitialShow?: boolean
    useSystemTitleBar?: boolean
  } = {}): void => {
    createWindow(options)
    const window = mainState.mainWindow as BrowserWindow | null
    if (!window) return
    const publishState = (): void => {
      mainState.startupState.publish()
      deliverImportLink(window)
    }
    if (window.webContents.isLoadingMainFrame()) {
      window.webContents.once('did-finish-load', publishState)
    } else {
      publishState()
    }
  }

  return app.whenReady().then(async () => {
    traceStartup('app.whenReady:start')
    if (!gotSingleInstanceLock) {
      await explainConflictingDesktopInstance()
      return
    }
    if (!runningClawScheduleMcpServer) publishDesktopInstanceIdentity()
    const disposeHostPowerRecovery = installHostPowerRecovery()
    app.once('before-quit', disposeHostPowerRecovery)
    app.once('before-quit', () => disposeProxyAgents())
    if (await recoverUpdateBeforeRuntimeStart()) return

    const startup = await startWindowFirstStartup({
      initializeShell: initializeWindowShell,
      registerShellIpc,
      transitionShellReady: () => mainState.startupState.transition('shell_ready'),
      createWindow: (settings) => {
        createWorkbenchWindow({
          suppressInitialShow: shouldStartHidden(settings),
          useSystemTitleBar: settings.appBehavior.useSystemTitleBar
        })
        traceStartup('createWindow:returned')
      },
      windowAvailable: () => activation.windowAvailable(),
      syncTray,
      startBackground: async (shell) => {
        mainState.startupState.transition('services_starting', 'Preparing the desktop-owned Kun Runtime...')
        return initializeMainServices({
          productionSettingsPath: shell.productionSettingsPath,
          onPhase: (phase, detail) => {
            try {
              mainState.startupState.transition(phase, detail)
            } catch {
              // A later phase may already have been published; keep the latest.
            }
          }
        })
      }
    })
    if (!startup?.background) return

    const { initial } = startup.background
    registerMainIpc(startup.background)

    void pruneOnStartup().catch((err) => {
      console.warn('[kun-gui] prune logs:', err)
    })

    // Persist the models.dev catalog across restarts so provider metadata is
    // available immediately and offline launches reuse the last fetch.
    attachModelsDevDiskCache(join(app.getPath('userData'), 'cache', 'models-dev.json'))
    void prefetchCatalogPricing(mainState.store).catch((err) => {
      console.warn('[kun-gui] catalog pricing prefetch failed:', err)
    })

    await runPostWindowRuntimeStartup(initial, {
      startupState: mainState.startupState,
      reconcileBundledRuntimeAfterInstall,
      resolveManagedRuntimeStartupTarget,
      managedKunHostCanAutoStart,
      ensureKunServeFreshOnStartup,
      resolveRuntimeConnection: (settings) => kunRuntimeAdapter.resolveConnection(settings),
      enqueueStartupSettingsApply: (settings) => createStartupSettingsApply(settings, {
        runtimeSupervisor,
        settledRuntimeSettings: mainState.settledRuntimeSettings,
        applyManagedRuntimeSettingsHot,
        logWarn
      }),
      loadGuiUpdaterModule,
      showCliInstallPrompt: () => maybePromptCliInstall(() => mainState.mainWindow),
      logWarn
    })

    app.on('activate', () => {
      if (runtimeShutdown.isQuitInProgress) return
      if (!mainState.startupState.isReady()) {
        activation.requestReveal()
        return
      }
      if (!mainState.mainWindow || mainState.mainWindow.isDestroyed()) createWorkbenchWindow()
      else revealMainWindow()
    })
  }).catch(handleStartupFailure)
}

function currentDesktopInstanceIdentity() {
  return captureDesktopInstanceIdentity({
    pid: process.pid,
    execPath: process.execPath,
    appPath: app.getAppPath(),
    appVersion: app.getVersion()
  })
}

function publishDesktopInstanceIdentity(): void {
  try {
    writeDesktopInstanceIdentity(app.getPath('userData'), currentDesktopInstanceIdentity())
  } catch (error) {
    logWarn('startup', 'Failed to record desktop instance identity.', {
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

async function explainConflictingDesktopInstance(): Promise<void> {
  const current = currentDesktopInstanceIdentity()
  const recorded = readDesktopInstanceIdentity(app.getPath('userData'))
  const decision = decideDesktopInstanceLock(current, recorded)
  if (decision.action !== 'conflict') return
  await dialog.showMessageBox({
    type: 'warning',
    title: 'Kun is already running',
    message: 'Kun is already running from a different app.',
    detail: formatDesktopInstanceConflictMessage(decision.current, decision.recorded),
    buttons: ['OK']
  }).catch((error) => {
    logWarn('startup', 'Failed to explain a conflicting Kun instance.', {
      message: error instanceof Error ? error.message : String(error)
    })
  })
}
