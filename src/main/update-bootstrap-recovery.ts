import { app } from 'electron'
import {
  GUI_UPDATE_BACKUP_GRACE_MS,
  GUI_UPDATE_MAX_HEALTH_ATTEMPTS,
  clearGuiUpdateRecovery,
  clearPendingUpdate,
  clearPendingUpdateResult,
  readGuiUpdateRecovery,
  readInstallerUpdateTransaction,
  readPendingUpdate,
  readPendingUpdateResult,
  writeGuiUpdateRecovery,
  type InstallerRecoveryEnvironment,
  type InstallerUpdateTransaction
} from './gui-updater-pending'
import { resolveUpdateTransactionFacts } from './update-transaction-states'
import { scheduleUpdateRollbackAfterExit } from './update-transaction-helper'

export type UpdateBootstrapRecoveryDeps = {
  platform: NodeJS.Platform
  version: () => string
  scheduleRollback: typeof scheduleUpdateRollbackAfterExit
  relaunch: () => void
  exit: (code: number) => void
  readTransaction?: (match: { oldVersion: string, newVersion: string }) => Promise<InstallerUpdateTransaction | null>
  log?: (message: string) => void
}

const defaultDeps: UpdateBootstrapRecoveryDeps = {
  platform: process.platform,
  version: () => app.getVersion(),
  scheduleRollback: scheduleUpdateRollbackAfterExit,
  relaunch: () => app.relaunch(),
  exit: (code) => app.exit(code)
}

type InstallerRecoveryContext = {
  recoveryEnvironment: InstallerRecoveryEnvironment
  backupDir?: string
  transactionState: string
}

/**
 * Resolve the authoritative rollback context. The installer transaction file
 * wins over the GUI result file: a crash between the payload cutover and the
 * installer result write leaves the transaction as the only rollback record.
 */
async function resolveInstallerRecoveryContext(
  deps: UpdateBootstrapRecoveryDeps,
  pending: { oldVersion: string, newVersion: string }
): Promise<InstallerRecoveryContext | null> {
  const result = await readPendingUpdateResult()
  const resultState = result?.outcome === 'success' ? result.transactionState : undefined
  if (result?.outcome === 'success' && result.recoveryEnvironment) {
    return {
      recoveryEnvironment: result.recoveryEnvironment,
      backupDir: result.backupDir,
      transactionState: resultState ?? ''
    }
  }

  const transaction = await (deps.readTransaction ?? readInstallerUpdateTransaction)(pending)
  if (transaction && resolveUpdateTransactionFacts(transaction.phase).countsAsInstalled) {
    return {
      recoveryEnvironment: transaction.recoveryEnvironment,
      backupDir: transaction.backupDir || undefined,
      transactionState: transaction.phase
    }
  }
  return null
}

async function startRecoveryFromCommittedUpdate(deps: UpdateBootstrapRecoveryDeps) {
  const pending = await readPendingUpdate()
  if (!pending || deps.version() !== pending.newVersion) return null
  const context = await resolveInstallerRecoveryContext(deps, pending)
  if (!context) return null
  if (!resolveUpdateTransactionFacts(context.transactionState).countsAsInstalled) return null
  return writeGuiUpdateRecovery({
    installedVersion: pending.newVersion,
    oldVersion: pending.oldVersion,
    channel: pending.channel,
    verifiedAt: new Date().toISOString(),
    healthAttempts: 0,
    bootAttempts: 0,
    backupDir: context.backupDir,
    transactionRoot: undefined,
    journalPath: undefined,
    recoveryEnvironment: context.recoveryEnvironment,
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
  if (!recovery) return false

  if (Date.now() >= Date.parse(recovery.backupExpiresAt)) {
    // An expired grace window must not silently drop the recovery record:
    // without it the running payload loses its only rollback owner. Log and
    // keep the record so runtime reconciliation performs the expiry decision
    // (finalize, rollback, or block) with the full helper available.
    deps.log?.('[kun-gui updater] update backup grace window expired before runtime start')
    return false
  }

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
