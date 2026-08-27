import { app } from 'electron'
import { win32 as win32Path } from 'node:path'
import type { GuiUpdateChannel, GuiUpdateInfo, GuiUpdateInstallResult, GuiUpdateState } from '../shared/gui-update'
import { setWindowsInstallerUpdateSource } from './gui-updater-support'
import { runUpdateTransactionHelper, scheduleUpdateRollbackAfterExit } from './update-transaction-helper'
import {
  GUI_UPDATE_BACKUP_GRACE_MS,
  GUI_UPDATE_HEALTH_RETRY_MS,
  GUI_UPDATE_MAX_HEALTH_ATTEMPTS,
  clearGuiUpdateRecovery,
  clearPendingUpdate,
  clearPendingUpdateResult,
  cleanupPendingUpdateBackup,
  readGuiUpdateRecovery,
  readPendingUpdate,
  readPendingUpdateResult,
  setPendingUpdateEnvironment,
  writeGuiUpdateRecovery,
  writePendingUpdate,
  writePendingUpdateResult
} from './gui-updater-pending'

type InstallerDetails = {
  hasDownloaded: boolean
  targetVersion: string
  channel: GuiUpdateChannel
}

type GuiUpdateInstallerDeps = {
  runExclusive: <T>(task: () => Promise<T>) => Promise<T>
  details: () => InstallerDetails
  stateInfo: () => Extract<GuiUpdateInfo, { ok: true }> | undefined
  emit: (state: GuiUpdateState) => void
  prepare: () => Promise<void>
  clearPreparation: () => void
  setQuitting: (active: boolean) => void
  quitAndInstall: () => void
  isSessionEnding: () => boolean
}

export class GuiUpdateInstaller {
  private installPromise: Promise<GuiUpdateInstallResult> | null = null
  private handoffPending = false
  private handoffStarted = false
  private attemptActive = false
  private launchError: Error | null = null
  private recoveryScheduled = false
  private recoveryTriggered = false
  private healthRetryTimer: ReturnType<typeof setTimeout> | null = null
  private healthCheck?: () => Promise<boolean>
  private installerPath = ''
  private installerSha512 = ''

  constructor(private readonly deps: GuiUpdateInstallerDeps) {}

  setDownloadedInstaller(paths: string[], sha512: string): void {
    this.installerPath = paths[0] ?? ''
    this.installerSha512 = sha512
  }

  clearDownloadedInstaller(): void {
    this.installerPath = ''
    this.installerSha512 = ''
  }

  install(): Promise<GuiUpdateInstallResult> {
    if (this.installPromise) return this.installPromise
    if (this.attemptActive || this.handoffPending || this.handoffStarted) return Promise.resolve({ ok: true })
    const operation = this.deps.runExclusive(() => this.installOnce())
    this.installPromise = operation
    void operation.finally(() => {
      if (this.installPromise === operation) this.installPromise = null
    })
    return operation
  }

  onBeforeQuitForUpdate(): void {
    this.clearHealthRetry()
    if (this.handoffPending) {
      this.handoffStarted = true
      this.handoffPending = false
    }
    this.deps.setQuitting(true)
    void this.deps.prepare().catch((error) => {
      this.deps.clearPreparation()
      this.deps.setQuitting(false)
      console.warn('[kun-gui updater] failed to stop runtimes before update quit:', error)
    })
  }

  onUpdaterError(error: unknown): boolean {
    if (!this.attemptActive) return false
    this.launchError = error instanceof Error ? error : new Error(String(error))
    this.scheduleRecovery()
    return true
  }

  async reconcile(healthCheck?: () => Promise<boolean>): Promise<void> {
    if (healthCheck) this.healthCheck = healthCheck
    let recovery = await readGuiUpdateRecovery()
    const pending = await readPendingUpdate()
    const result = await readPendingUpdateResult()

    if (pending && result?.outcome === 'success') {
      const installed = app.getVersion() === pending.newVersion
      const completedStates = new Set(['committed', 'cleanup_pending', 'payload_switched', 'awaiting_health'])
      const committed = result.schemaVersion === 1 || completedStates.has(result.transactionState ?? '')
      if (installed && committed) {
        if (result.transactionState !== 'committed' && result.schemaVersion !== 1) {
          console.warn('[kun-gui updater] reconciling incomplete installer cleanup:', result.transactionState)
        }
        recovery ??= await this.startHealthRecovery(pending, result)
        // Keep both records through the first complete Runtime health check.
        // Bootstrap needs the installer-authored recovery environment if the
        // next startup crashes before this updater is initialized.
      } else if (!installed) {
        this.emitInstallFailure('The update installer reported success, but the running version does not match the update.')
        return
      }
    }

    if (result?.outcome === 'aborted') {
      const rollbackComplete = result.transactionState === 'rolled_back' && result.rollbackOutcome === 'succeeded'
      const oldVersionRunning = pending && app.getVersion() === pending.oldVersion
      if (rollbackComplete || oldVersionRunning) {
        await this.cleanupBackup(result.backupDir)
        await this.removeTransactionRecords()
      } else if (pending) {
        const attempts = (result.recoveryAttempts ?? 0) + 1
        const message = result.message || `The update installer stopped during ${result.phase ?? result.code}.`
        if (attempts >= GUI_UPDATE_MAX_HEALTH_ATTEMPTS) {
          await this.removeTransactionRecords()
        } else {
          await writePendingUpdateResult({ ...result, recoveryAttempts: attempts })
        }
        this.emitInstallFailure(message)
        return
      }
      this.emitInstallFailure(result.message || `The update installer stopped during ${result.phase ?? result.code}.`)
      return
    }

    if (pending && !result) {
      if (app.getVersion() === pending.oldVersion) {
        await clearPendingUpdate()
        this.emitInstallFailure('The update installer did not finish. The downloaded update can be retried.')
        return
      }
      if (app.getVersion() === pending.newVersion) {
        recovery ??= await this.startHealthRecovery(pending, {
          backupDir: pending.backupDir,
          recoveryEnvironment: undefined
        })
      }
    }

    if (!recovery) return
    if (Date.now() >= Date.parse(recovery.backupExpiresAt)) {
      this.clearHealthRetry()
      await this.cleanupBackup(recovery.backupDir)
      await clearGuiUpdateRecovery()
      return
    }
    const retryAt = recovery.nextHealthCheckAt ? Date.parse(recovery.nextHealthCheckAt) : 0
    if (recovery.healthAttempts >= GUI_UPDATE_MAX_HEALTH_ATTEMPTS) {
      this.clearHealthRetry()
      await this.rollbackAfterHealthFailure(recovery)
      return
    }
    if (retryAt > Date.now()) {
      this.armHealthRetry(retryAt)
      this.emitDegraded(recovery.healthAttempts, recovery.lastError)
      return
    }
    const healthy = await (this.healthCheck?.() ?? Promise.resolve(true)).catch(() => false)
    if (healthy) {
      this.clearHealthRetry()
      if (recovery.recoveryEnvironment) {
        await runUpdateTransactionHelper('FinalizeUpdateTransaction', recovery.recoveryEnvironment)
      }
      await this.cleanupBackup(recovery.backupDir)
      await clearGuiUpdateRecovery()
      await this.removeTransactionRecords()
      return
    }
    const attempts = recovery.healthAttempts + 1
    const message = 'GUI update installed, but Kun Runtime health checks are still failing.'
    const nextRecovery = await writeGuiUpdateRecovery({ ...recovery, healthAttempts: attempts,
      nextHealthCheckAt: new Date(Date.now() + GUI_UPDATE_HEALTH_RETRY_MS).toISOString(), lastError: message })
    if (attempts >= GUI_UPDATE_MAX_HEALTH_ATTEMPTS) {
      this.clearHealthRetry()
      await this.rollbackAfterHealthFailure(nextRecovery)
      return
    }
    this.armHealthRetry(Date.parse(nextRecovery.nextHealthCheckAt ?? ''))
    this.emitDegraded(attempts, message)
  }

  private async rollbackAfterHealthFailure(recovery: import('./gui-updater-pending').GuiUpdateRecovery): Promise<void> {
    if (!recovery.recoveryEnvironment) {
      this.emitDegraded(recovery.healthAttempts, recovery.lastError)
      return
    }
    try {
      await scheduleUpdateRollbackAfterExit(recovery.recoveryEnvironment)
      this.deps.emit({ status: 'error', info: this.deps.stateInfo(), code: 'install_failed',
        message: 'Kun Runtime health checks failed repeatedly. Restoring the previous version.' })
      app.exit(0)
    } catch (error) {
      console.error('[kun-gui updater] failed to schedule update rollback:', error)
      this.emitDegraded(recovery.healthAttempts, recovery.lastError)
    }
  }

  private async startHealthRecovery(
    pending: { newVersion: string, oldVersion: string, channel: GuiUpdateChannel },
    result: { backupDir?: string, recoveryEnvironment?: import('./gui-updater-pending').InstallerRecoveryEnvironment }
  ) {
    return writeGuiUpdateRecovery({
      installedVersion: pending.newVersion,
      oldVersion: pending.oldVersion,
      channel: pending.channel,
      verifiedAt: new Date().toISOString(),
      healthAttempts: 0,
      bootAttempts: 0,
      backupDir: result.backupDir,
      recoveryEnvironment: result.recoveryEnvironment,
      backupExpiresAt: new Date(Date.now() + GUI_UPDATE_BACKUP_GRACE_MS).toISOString()
    })
  }

  private async removeTransactionRecords(): Promise<void> {
    await clearPendingUpdateResult()
    await clearPendingUpdate()
  }

  private async cleanupBackup(backupDir?: string): Promise<void> {
    await cleanupPendingUpdateBackup(backupDir).catch((error) => {
      console.warn('[kun-gui updater] could not clean update backup:', error)
    })
  }

  private armHealthRetry(retryAt: number): void {
    this.clearHealthRetry()
    const delay = Math.max(0, retryAt - Date.now())
    this.healthRetryTimer = setTimeout(() => {
      this.healthRetryTimer = null
      void this.reconcile().catch((error) => {
        console.warn('[kun-gui updater] could not retry pending update health check:', error)
      })
    }, delay)
    this.healthRetryTimer.unref?.()
  }

  private clearHealthRetry(): void {
    if (this.healthRetryTimer) clearTimeout(this.healthRetryTimer)
    this.healthRetryTimer = null
  }

  private emitInstallFailure(message: string): void {
    this.deps.emit({ status: 'error', info: this.deps.stateInfo(), code: 'install_failed', message })
  }

  private emitDegraded(attempts: number, message?: string): void {
    this.deps.emit({ status: 'error', info: this.deps.stateInfo(), code: 'install_failed',
      message: `${message || 'Kun Runtime needs repair after the GUI update.'} Health attempts: ${attempts}.` })
  }

  private async installOnce(): Promise<GuiUpdateInstallResult> {
    if (this.deps.isSessionEnding()) return deferredResult()
    const details = this.deps.details()
    if (!details.hasDownloaded) return failedResult('The update has not finished downloading yet.')
    this.deps.emit({ status: 'installing', info: this.deps.stateInfo() })
    this.deps.setQuitting(true)
    let quittingMarked = true
    let restoreEnvironment = (): void => undefined
    try {
      await this.deps.prepare()
      const current = this.deps.details()
      if (!current.hasDownloaded) {
        this.deps.clearPreparation()
        this.deps.setQuitting(false)
        quittingMarked = false
        return failedResult('The selected update is no longer eligible for installation.')
      }
      if (this.deps.isSessionEnding()) {
        throw Object.assign(new Error('Windows is ending this session. The downloaded update will remain available next launch.'), {
          code: 'install_deferred'
        })
      }
      if (!this.installerPath) throw new Error('The downloaded installer path is unavailable.')
      const restoreUpdateSource = setWindowsInstallerUpdateSource()
      const restorePendingEnvironment = setPendingUpdateEnvironment(
        undefined,
        undefined,
        app.getVersion(),
        current.targetVersion
      )
      restoreEnvironment = () => {
        restorePendingEnvironment()
        restoreUpdateSource()
      }
      await clearPendingUpdateResult()
      await writePendingUpdate({
        oldVersion: app.getVersion(),
        newVersion: current.targetVersion,
        installDir: process.platform === 'win32' ? win32Path.dirname(process.execPath) : '',
        installerPath: this.installerPath,
        installerSha512: this.installerSha512 || undefined,
        channel: current.channel
      })
      this.attemptActive = true
      this.handoffPending = true
      this.handoffStarted = false
      this.launchError = null
      this.deps.quitAndInstall()
      if (this.launchError) throw this.launchError
      return { ok: true }
    } catch (error) {
      const deferred = (error as { code?: unknown })?.code === 'install_deferred'
      restoreEnvironment()
      this.reset()
      if (quittingMarked) {
        this.deps.clearPreparation()
        this.deps.setQuitting(false)
      }
      if (!deferred) await clearPendingUpdate()
      const message = error instanceof Error ? error.message : String(error)
      this.deps.emit({ status: 'error', info: this.deps.stateInfo(), message, code: deferred ? 'install_deferred' : 'install_failed' })
      if (quittingMarked && !deferred) this.scheduleRecovery()
      return deferred ? deferredResult() : failedResult(message)
    }
  }

  private reset(): void {
    this.attemptActive = false
    this.handoffPending = false
    this.handoffStarted = false
    this.launchError = null
  }

  private scheduleRecovery(): void {
    if (this.recoveryScheduled || this.recoveryTriggered) return
    this.recoveryScheduled = true
    this.recoveryTriggered = true
    queueMicrotask(() => {
      void this.relaunchAfterClearingPending()
    })
  }

  private async relaunchAfterClearingPending(): Promise<void> {
    this.recoveryScheduled = false
    await clearPendingUpdate().catch((error) => {
      console.warn('[kun-gui updater] could not clear pending update before relaunch:', error)
    })
    this.reset()
    this.deps.clearPreparation()
    this.deps.setQuitting(false)
    try {
      app.relaunch()
      app.exit(0)
    } catch (error) {
      console.error('[kun-gui updater] failed to relaunch after update install failure:', error)
    }
  }
}

function failedResult(message: string): GuiUpdateInstallResult {
  return { ok: false, currentVersion: app.getVersion(), code: 'install_failed', message }
}

function deferredResult(): GuiUpdateInstallResult {
  return {
    ok: false,
    currentVersion: app.getVersion(),
    code: 'install_deferred',
    message: 'Windows is ending this session. The downloaded update will remain available next launch.'
  }
}
