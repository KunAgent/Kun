import { app } from 'electron'
import {
  mainState,
  runningClawScheduleMcpServer
} from './main-app-context'
import {
  runClawScheduleMcpServerFromArgv
} from './claw-schedule-mcp-server'
import {
  releaseRuntimeDataRecoveryMigrationLock
} from './main-migrations'
import {
  runtimeShutdown,
  stopCheckpointCleanupTimer,
  stopManagedRuntimes,
  stopManagedRuntimesForQuit
} from './main-lifecycle'
import { stopRuntimeWatchdog } from './main-runtime-health'
import { requestProviderMutationFlush } from './provider-mutation-barrier'
import { startMainApp } from './main-ready'
import { readUpdateHealthRequest, runUpdateHealthCheck } from './update-health-check'
import {
  packagedUpdateHandoffSmokeFailure,
  packagedUpdateHandoffSmokeRequested,
  runPackagedUpdateHandoffSmoke
} from './packaged-update-handoff-smoke'

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
  const updateHealthRequest = readUpdateHealthRequest()
  if (updateHealthRequest) {
    mainState.updateHealthProbeOnly = true
    void runUpdateHealthCheck(updateHealthRequest).then(
      () => app.exit(0),
      (error) => {
        console.error('[kun-gui update health] failed:', error)
        app.exit(71)
      }
    )
  } else {
    void startMainApp()
  }
}

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return
  void stopManagedRuntimes().catch((error) => {
    console.warn('[kun-gui] failed to stop Kun runtime:', error)
  })
  app.quit()
})

let quitBarrierPromise: Promise<void> | null = null
let quitBarrierCompleted = false

app.on('before-quit', (event) => {
  if (quitBarrierCompleted) return
  event.preventDefault()
  if (quitBarrierPromise) return
  quitBarrierPromise = (async () => {
    try {
      releaseRuntimeDataRecoveryMigrationLock()
    } catch (error) {
      console.error('[kun-gui] failed to release Runtime data recovery lock during quit:', error)
    }
    runtimeShutdown.requestQuit()
    mainState.protectedCredentialSurface?.dispose()
    const mutationFlush = await requestProviderMutationFlush(() => mainState.mainWindow)
    if (!mutationFlush.ok) {
      console.warn('[kun-gui] provider mutation flush did not complete before quit:', {
        errorCode: mutationFlush.errorCode,
        pendingProviderIds: mutationFlush.pendingProviderIds,
        mutationKinds: mutationFlush.mutationKinds
      })
    }
    stopRuntimeWatchdog()
    stopCheckpointCleanupTimer()
    if (!runtimeShutdown.isStoppedForQuit) {
      await stopManagedRuntimesForQuit().catch((error) => {
        console.warn('[kun-gui] failed to stop Kun runtime:', error)
      })
    }
    quitBarrierCompleted = true
    app.quit()
  })()
})
