import { app } from 'electron'
import {
  GUI_UPDATE_BACKUP_GRACE_MS,
  GUI_UPDATE_MAX_HEALTH_ATTEMPTS,
  clearGuiUpdateRecovery,
  clearPendingUpdate,
  clearPendingUpdateResult,
  readGuiUpdateRecovery,
  readPendingUpdate,
  readPendingUpdateResult,
  writeGuiUpdateRecovery
} from './gui-updater-pending'
import { scheduleUpdateRollbackAfterExit } from './update-transaction-helper'

export type UpdateBootstrapRecoveryDeps = {
  platform: NodeJS.Platform
  version: () => string
  scheduleRollback: typeof scheduleUpdateRollbackAfterExit
  relaunch: () => void
  exit: (code: number) => void
}

const defaultDeps: UpdateBootstrapRecoveryDeps = {
  platform: process.platform,
  version: () => app.getVersion(),
  scheduleRollback: scheduleUpdateRollbackAfterExit,
  relaunch: () => app.relaunch(),
  exit: (code) => app.exit(code)
}

async function startRecoveryFromCommittedUpdate(deps: UpdateBootstrapRecoveryDeps) {
  const [pending, result] = await Promise.all([readPendingUpdate(), readPendingUpdateResult()])
  if (!pending || !result?.recoveryEnvironment || result.outcome !== 'success' ||
      !['cleanup_pending', 'committed'].includes(result.transactionState ?? '') ||
      deps.version() !== pending.newVersion) return null
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

/** Runs before services and the Kun runtime load so startup crashes count. */
export async function recoverUpdateBeforeRuntimeStart(
  deps: UpdateBootstrapRecoveryDeps = defaultDeps
): Promise<boolean> {
  if (deps.platform !== 'win32') return false
  const [pending, result] = await Promise.all([readPendingUpdate(), readPendingUpdateResult()])
  if (pending && result?.outcome === 'success' && deps.version() === pending.oldVersion) {
    await Promise.all([clearGuiUpdateRecovery(), clearPendingUpdate(), clearPendingUpdateResult()])
    return false
  }
  const recovery = await readGuiUpdateRecovery() ?? await startRecoveryFromCommittedUpdate(deps)
  if (!recovery || Date.now() >= Date.parse(recovery.backupExpiresAt)) return false

  const bootAttempts = (recovery.bootAttempts ?? 0) + 1
  await writeGuiUpdateRecovery({ ...recovery, bootAttempts })
  if (bootAttempts < GUI_UPDATE_MAX_HEALTH_ATTEMPTS || !recovery.recoveryEnvironment) return false

  try {
    await deps.scheduleRollback(recovery.recoveryEnvironment)
  } catch (error) {
    console.error('[kun-gui updater] failed to recover update before runtime start:', error)
    return false
  }
  deps.exit(0)
  return true
}
