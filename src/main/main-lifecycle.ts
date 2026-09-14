import { revokeBrowserBindingBeforeQuit } from './runtime/partial-startup-quit'
import { desktopProcessStack } from './runtime/desktop-process-stack'
import { DesktopShutdownSteps } from './runtime/desktop-shutdown-steps'
import { beginOwnedProcessShutdown, shutdownOwnedProcesses } from '../../kun/src/process/owned-process.js'
import { closeManagerClientAdmission } from '../../kun/src/manager/manager-client-lifetime.js'
import {
  app,
  protocol,
  session
} from 'electron'
import {
  resolveNamedPreloadPath
} from './main-paths'
import {
  resolveKunRuntimeSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import type {
  GuiUpdateState
} from '../shared/gui-update'
import {
  isAllowedDevPreviewUrl
} from '../shared/dev-preview-url'
import {
  isAuthorizedPrototypeFileUrl
} from './services/prototype-embed-registry'
import {
  kunRuntimeAdapter
} from './runtime/kun-adapter'
import {
  resolveKunDataDir
} from './kun-process'
import {
  expandHomePath
} from './settings-store'
import {
  logWarn
} from './logger'
import {
  cleanupUnusedGitCheckpointsIfDue
} from './services/git-checkpoint-service'
import { evictForQuota } from './services/git-checkpoint-quota'
import {
  stopWeixinBridgeRuntime
} from './weixin-bridge-runtime'
import {
  shutdownLocalWhisperService
} from './services/local-whisper-service'
import { shutdownLocalKokoroDownloads } from './services/local-kokoro-download-service'
import { shutdownLocalKokoroSynthesis } from './services/local-kokoro-synthesis-service'
import {
  ManagedRuntimeShutdownCoordinator
} from './runtime/managed-runtime-shutdown-coordinator'
import {
  requestProviderMutationFlush
} from './provider-mutation-barrier'
import {
  revokeManagedRuntimeBrowserUseBinding
} from './runtime/browser-use-binding-revoke'
import {
  ExtensionViewProtocolRegistry
} from './extensions/extension-view-protocol-registry'
import {
  installWebviewSecurityGuards
} from './extensions/extension-webview-security'
import { probeRuntimeApi } from './main-runtime-health'
import {
  beginBrowserUseHostShutdown,
  stopBrowserUseHost,
  waitForBrowserUseHostLifecycle
} from './browser-use/browser-use-host'
import {
  stopComputerUseHost
} from './computer-use/computer-use-host'
import {
  __dirname,
  developmentRendererUrl,
  extensionViewSessions,
  mainState,
  type GuiUpdaterModule
} from './main-app-context'

export function emitClawChannelActivity(payload: { channelId: string; threadId: string }): void {
  if (!mainState.mainWindow || mainState.mainWindow.isDestroyed()) return
  mainState.mainWindow.webContents.send('claw:channel-activity', payload)
}

export function stopCheckpointCleanupTimer(): void {
  if (mainState.checkpointCleanupTimer) {
    clearInterval(mainState.checkpointCleanupTimer)
    mainState.checkpointCleanupTimer = null
  }
}

export function isAppQuitInProgress(): boolean {
  return runtimeShutdown.isQuitInProgress
}

export function setUpdateInstallQuitting(active: boolean): void {
  runtimeShutdown.setUpdateInstallQuit(active)
  // Failed installers relaunch through GuiUpdateInstaller and the ordinary
  // quit barrier. Closed resources/admission must never reopen in this process.
}

export async function runCheckpointCleanup(
  settings: AppSettingsV1,
  options: { force?: boolean; reason?: string } = {}
): Promise<void> {
  try {
    mainState.assertCanonicalRuntimeMigrationReady()
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
    // Enforce the global disk quota (issue #1156): evict oldest checkpoints —
    // referenced or not — until the store fits maxTotalBytes. This is what
    // finally reclaims stores that grew to tens of GB before the hard caps.
    if (checkpointsRoot) {
      const quotaEviction = await evictForQuota({
        root: checkpointsRoot,
        ...(settings.checkpointCleanup.maxTotalBytes !== undefined
          ? { maxTotalBytes: settings.checkpointCleanup.maxTotalBytes }
          : {})
      })
      if (quotaEviction.deleted.length > 0) {
        console.info(
          `[kun-gui] git checkpoint quota eviction removed ${quotaEviction.deleted.length} checkpoint(s): ` +
          `${quotaEviction.totalBytesBefore} -> ${quotaEviction.totalBytesAfter} bytes`
        )
      }
    }
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

export function syncCheckpointCleanupTimer(settings: AppSettingsV1): void {
  stopCheckpointCleanupTimer()
  if (!settings.checkpointCleanup.enabled) return
  const intervalMs = settings.checkpointCleanup.intervalDays * 24 * 60 * 60 * 1_000
  // Interval / version-upgrade passes only. The forced startup pass is scheduled
  // earlier in app.whenReady so retention does not wait on the interval gate.
  mainState.checkpointCleanupTimer = setInterval(() => {
    void runCheckpointCleanup(settings, { reason: 'interval' })
  }, intervalMs)
  mainState.checkpointCleanupTimer.unref?.()
}

export const runtimeShutdown = new ManagedRuntimeShutdownCoordinator(async () => {
  const terminal = runtimeShutdown.isQuitRequested || runtimeShutdown.isStorageRelocationQuit
  desktopProcessStack.beginStop(terminal)
  beginOwnedProcessShutdown()
  const cleanup = new DesktopShutdownSteps(runtimeShutdown.shutdownStartedAt, (name, error) => {
    logWarn('application-shutdown', `${name}: ${error.message}`)
  })
  let browserUseBinding: ReturnType<typeof beginBrowserUseHostShutdown> | undefined
  await cleanup.group([
    { name: 'browser-admission', run: () => { browserUseBinding = beginBrowserUseHostShutdown() } },
    { name: 'kokoro-downloads', run: shutdownLocalKokoroDownloads }
  ], cleanup.deadline(1_000))
  await cleanup.settle({
    name: 'browser-authority',
    run: () => revokeBrowserBindingBeforeQuit({
        store: mainState.store,
        hasBinding: Boolean(browserUseBinding),
        runtimeIsLive: kunRuntimeAdapter.isChildRunning(),
        revoke: (settings) => revokeManagedRuntimeBrowserUseBinding(settings, browserUseBinding)
      })
  }, cleanup.deadline(2_000))
  const releaseLeases = mainState.shutdownDesktopResourceLeases
  const {
    scheduleRuntime: schedule, workflowRuntime: workflow, clawRuntime: phone,
    telegramRuntime: telegram, daemonRuntime: daemon, terminalPtyController: terminalPty
  } = mainState
  mainState.shutdownDesktopResourceLeases = null
  await cleanup.group([
    { name: 'desktop-leases', run: () => releaseLeases?.() },
    { name: 'schedule', run: () => schedule?.stop() },
    { name: 'workflow', run: () => workflow?.stop() },
    { name: 'phone', run: () => phone?.stop() },
    { name: 'telegram', run: () => telegram?.stop() },
    { name: 'weixin', run: stopWeixinBridgeRuntime },
    { name: 'daemon', run: () => daemon?.stop() },
    { name: 'terminal', run: () => terminalPty?.disposeAllAndWait() },
    { name: 'whisper', run: shutdownLocalWhisperService },
    { name: 'kokoro', run: shutdownLocalKokoroSynthesis },
    { name: 'browser-startup', run: waitForBrowserUseHostLifecycle },
    { name: 'runtime-operations', run: () => mainState.waitForRuntimeOperationsIdle?.() },
    { name: 'runtime', run: () => kunRuntimeAdapter.stopAndWait({ deadline: cleanup.deadline(20_000) }) }
  ], cleanup.deadline(12_000))
  // Main cannot be killed before its writer: fence every in-flight and future
  // Manager request from delayed callbacks before closing the physical stores.
  closeManagerClientAdmission()
  const managerChild = desktopProcessStack.managerChild()
  const workersStopped = await cleanup.settle({
    name: 'worker-processes',
    run: () => shutdownOwnedProcesses({
      graceMs: 0,
      timeoutMs: Math.max(1, cleanup.deadline(20_000) - Date.now()),
      exclude: managerChild ? [managerChild] : []
    })
  }, cleanup.deadline(20_000))
  await cleanup.group([
    { name: 'browser', run: stopBrowserUseHost },
    { name: 'computer', run: stopComputerUseHost }
  ], cleanup.deadline(20_000))
  // A live execution process must not lose its data writer or let another
  // application claim that data directory. Keep ownership if containment failed.
  if (workersStopped) {
    const managerStopped = await cleanup.settle({
      name: 'service-manager',
      run: () => desktopProcessStack.stopManager(cleanup.deadline(29_000), terminal)
    }, cleanup.deadline(29_000))
    if (managerStopped) mainState.activeServiceManager = null
    await cleanup.settle({
      name: 'process-guard',
      run: () => shutdownOwnedProcesses({ graceMs: 0, timeoutMs: Math.max(1, cleanup.deadline(30_000) - Date.now()) })
    }, cleanup.deadline(30_000))
  }
  cleanup.assertComplete()
})

export async function stopManagedRuntimesForQuit(): Promise<void> {
  await runtimeShutdown.stopForQuit()
  // Update preparation stops processes but keeps the session reservation for
  // a failed-installer retry. Real quit releases that final reservation too.
  await desktopProcessStack.stopManager(runtimeShutdown.shutdownStartedAt + 30_000, true)
}

export function stopManagedRuntimes(): Promise<void> {
  return runtimeShutdown.stop()
}

export async function checkProviderMutationsBeforeUpdate(): Promise<void> {
  const mutationFlush = await requestProviderMutationFlush(() => mainState.mainWindow)
  if (!mutationFlush.ok) {
    throw new Error(`Provider mutations could not be flushed before update (${mutationFlush.errorCode ?? 'unknown'})`)
  }
}

export function prepareManagedRuntimesForUpdate(): Promise<void> {
  return runtimeShutdown.prepareForUpdate()
}

export function isPackagedExtensionDesktopSmoke(): boolean {
  return process.env.KUN_PACKAGED_EXTENSION_DESKTOP_SMOKE === '1'
}

export async function loadGuiUpdaterModule(): Promise<GuiUpdaterModule> {
  // The packaged Extension smoke owns an isolated profile and must not make a
  // networked update check while it is validating the renderer process.
  if (isPackagedExtensionDesktopSmoke()) return import('./gui-updater')
  if (!mainState.guiUpdaterModulePromise) {
    mainState.guiUpdaterModulePromise = import('./gui-updater')
      .then((module) => {
        if (!mainState.guiUpdaterInitialized) {
          module.initializeGuiUpdater(
            () => mainState.mainWindow,
            async () => (await mainState.store.load()).guiUpdate.channel,
            prepareManagedRuntimesForUpdate,
            async () => (await mainState.store.load()).locale,
            setUpdateInstallQuitting,
            async () => (await probeRuntimeApi(await mainState.store.load())).ok,
            checkProviderMutationsBeforeUpdate
          )
          mainState.guiUpdaterInitialized = true
        }
        return module
      })
      .catch((error) => {
        mainState.guiUpdaterModulePromise = null
        throw error
      })
  }
  return mainState.guiUpdaterModulePromise
}

export async function readGuiUpdateState(): Promise<GuiUpdateState> {
  if (!mainState.guiUpdaterModulePromise) return { status: 'idle' }
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


export function installDevPreviewWebviewGuards(options: {
  viewProtocols: ExtensionViewProtocolRegistry
}): void {
  installWebviewSecurityGuards({
    app,
    existingWebContents: mainState.mainWindow && !mainState.mainWindow.isDestroyed()
      ? [mainState.mainWindow.webContents]
      : [],
    sessions: extensionViewSessions,
    extensionPreloadPath: resolveNamedPreloadPath(__dirname, 'extension-view'),
    assertExtensionPartitionPrepared: (record) => options.viewProtocols.assertPrepared(record),
    isPreparedExtensionNavigation: (contents, url) =>
      options.viewProtocols.isPreparedInitialNavigation(contents.session.protocol, url),
    isTrustedWorkbench: (contents) => Boolean(
      mainState.mainWindow && !mainState.mainWindow.isDestroyed() && contents.id === mainState.mainWindow.webContents.id
    ),
    isAllowedDevPreviewUrl,
    isAuthorizedPrototypeFileUrl,
    onDenied: ({ code }) => {
      logWarn('extension-webview', 'Denied extension Webview operation.', { code })
    }
  })
}
