import { app, type BrowserWindow } from 'electron'
import { shouldStartHidden } from './desktop-behavior'
import { disposeProxyAgents } from './proxy-fetch'
import { maybePromptCliInstall } from './cli-install-service'
import { managedKunHostCanAutoStart } from './managed-runtime-startup-policy'
import { kunRuntimeAdapter } from './runtime/kun-adapter'
import { configureLogger, logError, logInfo, pruneOnStartup, logWarn } from './logger'
import {
  gotSingleInstanceLock,
  mainState,
  traceStartup
} from './main-app-context'
import {
  loadGuiUpdaterModule
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
import { resolveManagedRuntimeStartupTarget } from './runtime/managed-runtime-startup-attach'
import { prefetchCatalogPricing } from './catalog-prefetch'
import { recoverUpdateBeforeRuntimeStart } from './update-bootstrap-recovery'
import { installHostPowerRecovery } from './host-power-recovery'

export function startMainApp(): Promise<void> {
  mainState.createWindow = createWindow
  mainState.ensureRuntime = ensureRuntime
  mainState.restartRuntime = restartRuntime
  mainState.assertCanonicalRuntimeMigrationReady = assertCanonicalRuntimeMigrationReady
  mainState.shutdownActiveServiceManagerForUpdate = shutdownActiveServiceManagerForUpdate

  try {
    mainState.logDir = resolveLogDirectory(app)
    configureLogger({ dir: mainState.logDir, enabled: true })
    logInfo('startup', 'Desktop startup entered.', {
      platform: process.platform,
      packaged: app.isPackaged
    })
  } catch (error) {
    console.warn('[kun-gui] failed to configure bootstrap startup logging:', error)
  }

  const activation = new MainWindowActivationCoordinator(
    () => mainState.mainWindow,
    revealMainWindow
  )
  app.on('second-instance', () => activation.requestReveal())

  const handleStartupFailure = (error: unknown): void => {
    if (!mainState.startupState.isReady()) {
      try {
        mainState.startupState.transition('recovery_required')
      } catch {
        // Keep the recovery path total even if a test or future caller reaches
        // failure from an unexpected state.
      }
    }
    const earlyWindow = mainState.mainWindow
    const message = sanitizeStartupFailureMessage(error)
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
    const publishState = (): void => mainState.startupState.publish()
    if (window.webContents.isLoadingMainFrame()) {
      window.webContents.once('did-finish-load', publishState)
    } else {
      publishState()
    }
  }

  return app.whenReady().then(async () => {
    traceStartup('app.whenReady:start')
    if (!gotSingleInstanceLock) return
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
      if (!mainState.startupState.isReady()) {
        activation.requestReveal()
        return
      }
      if (!mainState.mainWindow || mainState.mainWindow.isDestroyed()) createWorkbenchWindow()
      else revealMainWindow()
    })
  }).catch(handleStartupFailure)
}
