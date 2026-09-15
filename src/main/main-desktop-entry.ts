import { app } from 'electron'
import {
  mainState,
  runningClawScheduleMcpServer
} from './main-app-context'
import { installRemoteIpcRegistry } from './remote/remote-ipc-registry'
import { runClawScheduleMcpServerFromArgv } from './claw-schedule-mcp-server'
import { releaseRuntimeDataRecoveryMigrationLock } from './main-migrations'
import {
  runtimeShutdown,
  stopCheckpointCleanupTimer,
  stopManagedRuntimesForQuit
} from './main-lifecycle'
import { stopRuntimeWatchdog } from './main-runtime-health'
import { requestProviderMutationFlush } from './provider-mutation-barrier'
import { startMainApp } from './main-ready'
import { desktopProcessStack } from './runtime/desktop-process-stack'
import { beginOwnedProcessShutdown } from '../../kun/src/process/owned-process.js'
import {
  packagedUpdateHandoffSmokeFailure,
  packagedUpdateHandoffSmokeRequested,
  runPackagedUpdateHandoffSmoke
} from './packaged-update-handoff-smoke'

export function startDesktopMainEntry(): void {
  // Record every ipcMain.handle channel before any registration so the Remote
  // gateway can dispatch browser invokes through the same handlers.
  installRemoteIpcRegistry()
  if (runningClawScheduleMcpServer) {
    void runClawScheduleMcpServerFromArgv(process.argv).catch((error) => {
      console.error('[claw-schedule-mcp] server failed:', error)
      process.exit(1)
    })
  } else if (packagedUpdateHandoffSmokeRequested()) {
    void runPackagedUpdateHandoffSmoke().then(
      () => app.exit(0),
      (error) => {
        process.stderr.write(`${packagedUpdateHandoffSmokeFailure(error)}\n`)
        app.exit(70)
      }
    )
  } else {
    void startMainApp()
  }

  app.on('window-all-closed', () => {
    app.quit()
  })

  let quitBarrierPromise: Promise<void> | null = null
  let quitBarrierCompleted = false

  app.on('before-quit', (event) => {
    if (quitBarrierCompleted) return
    event.preventDefault()
    if (quitBarrierPromise) return
    runtimeShutdown.requestQuit()
    desktopProcessStack.beginStop(true)
    beginOwnedProcessShutdown()
    stopRuntimeWatchdog()
    stopCheckpointCleanupTimer()
    quitBarrierPromise = (async () => {
      try {
        mainState.protectedCredentialSurface?.dispose()
      } catch (error) {
        console.warn('[kun-gui] credential surface cleanup failed:', error)
      }
      try {
        const mutationFlush = await requestProviderMutationFlush(() => mainState.mainWindow)
        if (!mutationFlush.ok) {
          console.warn('[kun-gui] provider mutation flush did not complete before quit:', {
            errorCode: mutationFlush.errorCode,
            pendingProviderIds: mutationFlush.pendingProviderIds,
            mutationKinds: mutationFlush.mutationKinds
          })
        }
      } catch (error) {
        console.warn('[kun-gui] pre-quit resource cleanup failed:', error)
      }
      stopRuntimeWatchdog()
      stopCheckpointCleanupTimer()
      if (!runtimeShutdown.isStoppedForQuit) {
        await stopManagedRuntimesForQuit().catch((error) => {
          console.warn('[kun-gui] failed to stop Kun runtime:', error)
        })
      }
      if (runtimeShutdown.isStoppedForQuit) {
        try { releaseRuntimeDataRecoveryMigrationLock() } catch (error) {
          console.error('[kun-gui] failed to release Runtime data recovery lock during quit:', error)
        }
      }
      quitBarrierCompleted = true
      app.quit()
    })()
  })
}
