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
  stopSharedRuntime
} from '../../kun/src/cli/shared-runtime.js'
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
  const browserUseBinding = beginBrowserUseHostShutdown()
  mainState.terminalPtyController?.disposeAll()
  await mainState.shutdownDesktopResourceLeases?.()
  mainState.shutdownDesktopResourceLeases = null
  await mainState.scheduleRuntime?.stop()
  await mainState.workflowRuntime?.stop()
  await Promise.all([
    mainState.clawRuntime?.stop(),
    mainState.telegramRuntime?.stop()
  ])
  await stopWeixinBridgeRuntime()
  await shutdownLocalWhisperService()
  await Promise.all([
    waitForBrowserUseHostLifecycle(),
    mainState.waitForRuntimeOperationsIdle?.() ?? Promise.resolve()
  ])
  // The shared Kun service outlives ordinary GUI/TUI clients. Only an update
  // install must stop it so old application files can be replaced safely.
  if (runtimeShutdown.isUpdateInstallQuit || runtimeShutdown.isStorageRelocationQuit) {
    const settings = await mainState.store.load()
    if (runtimeShutdown.isUpdateInstallQuit) {
      await kunRuntimeAdapter.stopSharedForReplacementAndWait(settings)
    } else {
      await kunRuntimeAdapter.stopSharedAndWait(settings)
    }
    if (runtimeShutdown.isUpdateInstallQuit) {
      await mainState.shutdownActiveServiceManagerForUpdate()
    }
    if (runtimeShutdown.isStorageRelocationQuit) {
      const dataDir = resolveKunDataDir(resolveKunRuntimeSettings(settings))
      await Promise.all([
        stopSharedRuntime(dataDir, fetch, { runtimeFlavor: 'production' }),
        stopSharedRuntime(dataDir, fetch, { runtimeFlavor: 'development' })
      ])
    }
  } else {
    // The shared Kun daemon intentionally outlives an ordinary desktop client.
    // Revoke its ephemeral Browser host authority before freeing the loopback
    // port so a stale launch binding cannot survive a graceful GUI exit.
    try {
      const settings = await mainState.store.load()
      await revokeManagedRuntimeBrowserUseBinding(settings, browserUseBinding)
    } catch (error) {
      logWarn('browser-use-shutdown', 'Kun Browser Use authority revoke failed closed', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
  await Promise.all([
    stopBrowserUseHost(),
    stopComputerUseHost()
  ])
})

export function stopManagedRuntimesForQuit(): Promise<void> {
  return runtimeShutdown.stopForQuit()
}

export function stopManagedRuntimes(): Promise<void> {
  return runtimeShutdown.stop()
}

export async function prepareManagedRuntimesForUpdate(): Promise<void> {
  const mutationFlush = await requestProviderMutationFlush(() => mainState.mainWindow)
  if (!mutationFlush.ok) {
    throw new Error(`Provider mutations could not be flushed before update (${mutationFlush.errorCode ?? 'unknown'})`)
  }
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
            async () => (await probeRuntimeApi(await mainState.store.load())).ok
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
