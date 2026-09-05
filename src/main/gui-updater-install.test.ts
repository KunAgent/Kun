import { beforeEach, describe, expect, it, vi } from 'vitest'

let version = '0.2.0'
let pending: Record<string, unknown> | null
let result: Record<string, unknown> | null
let recovery: Record<string, unknown> | null
let transaction: Record<string, unknown> | null
let healthCheck = vi.fn(async () => true)
const emit = vi.fn()
const clearPending = vi.fn(async () => { pending = null })
const clearResult = vi.fn(async () => { result = null })
const clearRecovery = vi.fn(async () => { recovery = null })
const cleanupBackup = vi.fn(async () => undefined)
const runUpdateTransactionHelper = vi.fn(async () => undefined)
const scheduleUpdateRollbackAfterExit = vi.fn(async () => undefined)
const writeGuiUpdateRecoveryRecord = vi.fn(async (value: Record<string, unknown>) => {
  recovery = value
  return value
})
// Mirror the real helper: a confirmed finalize clears the GUI records.
const finalizeUpdateTransactionAndCleanup = vi.fn<
  (input: { environment: unknown, backupDir?: string }) => Promise<{
    kind: 'finalized' | 'already-finalized' | 'unconfirmed'
    phase?: string
    reason?: string
  }>
>(async () => {
  result = null
  pending = null
  recovery = null
  return { kind: 'finalized', phase: 'finalized' }
})

vi.mock('electron', () => ({
  app: {
    getVersion: () => version,
    relaunch: vi.fn(),
    exit: vi.fn()
  }
}))

vi.mock('./gui-updater-pending', () => ({
  GUI_UPDATE_BACKUP_GRACE_MS: 7 * 86_400_000,
  GUI_UPDATE_HEALTH_RETRY_MS: 6 * 60 * 60 * 1_000,
  GUI_UPDATE_MAX_HEALTH_ATTEMPTS: 3,
  clearGuiUpdateRecovery: clearRecovery,
  clearPendingUpdate: clearPending,
  clearPendingUpdateResult: clearResult,
  cleanupPendingUpdateBackup: cleanupBackup,
  readGuiUpdateRecovery: vi.fn(async () => recovery),
  readInstallerUpdateTransaction: vi.fn(async () => transaction),
  readPendingUpdate: vi.fn(async () => pending),
  readPendingUpdateResult: vi.fn(async () => result),
  setPendingUpdateEnvironment: vi.fn(() => () => undefined),
  writeGuiUpdateRecovery: writeGuiUpdateRecoveryRecord,
  writePendingUpdate: vi.fn(),
  writePendingUpdateResult: vi.fn(async (value) => { result = value; return value })
}))

vi.mock('./gui-updater-support', () => ({ setWindowsInstallerUpdateSource: vi.fn(() => () => undefined) }))
vi.mock('./update-transaction-helper', () => ({
  runUpdateTransactionHelper,
  scheduleUpdateRollbackAfterExit,
  finalizeUpdateTransactionAndCleanup
}))

async function installer() {
  const { GuiUpdateInstaller } = await import('./gui-updater-install')
  return new GuiUpdateInstaller({
    runExclusive: async (task) => task(),
    details: () => ({ hasDownloaded: false, targetVersion: '0.2.0', channel: 'stable' }),
    stateInfo: () => undefined,
    emit,
    prepare: async () => undefined,
    clearPreparation: vi.fn(),
    setQuitting: vi.fn(),
    quitAndInstall: vi.fn(),
    isSessionEnding: () => false
  })
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  version = '0.2.0'
  pending = {
    schemaVersion: 1, state: 'installing', oldVersion: '0.1.0', newVersion: '0.2.0',
    installDir: 'C:\\Kun', installerPath: 'C:\\update.exe', channel: 'stable', writtenAt: new Date().toISOString()
  }
  result = null
  recovery = null
  transaction = null
  healthCheck = vi.fn(async () => true)
  finalizeUpdateTransactionAndCleanup.mockImplementation(async () => {
    result = null
    pending = null
    recovery = null
    return { kind: 'finalized', phase: 'finalized' }
  })
})

describe('GuiUpdateInstaller reconciliation', () => {
  it('converges a successful cleanup_pending transaction', async () => {
    result = {
      schemaVersion: 2, outcome: 'success', code: 'success', message: '', at: new Date().toISOString(),
      transactionState: 'cleanup_pending', backupDir: 'C:\\Users\\test\\AppData\\Roaming\\KunInstallerRecovery\\update-backup-1',
      recoveryEnvironment: { KUN_INSTALLER_TRANSACTION: 'C:\\recovery\\abc-update.json' }
    }

    await (await installer()).reconcile(healthCheck)

    expect(finalizeUpdateTransactionAndCleanup).toHaveBeenCalledWith(expect.objectContaining({
      environment: { KUN_INSTALLER_TRANSACTION: 'C:\\recovery\\abc-update.json' }
    }))
    expect(pending).toBeNull()
    expect(result).toBeNull()
    expect(recovery).toBeNull()
  })

  it('keeps the backup when an incomplete rollback leaves the old exe running', async () => {
    version = '0.1.0'
    result = {
      schemaVersion: 2, outcome: 'aborted', code: 'rollback_failed', message: 'rollback interrupted', at: new Date().toISOString(),
      transactionState: 'rollback_incomplete', rollbackOutcome: 'failed',
      recoveryEnvironment: { KUN_INSTALLER_TRANSACTION: 'C:\\recovery\\abc-update.json' }
    }

    await (await installer()).reconcile(healthCheck)

    expect(cleanupBackup).not.toHaveBeenCalled()
    expect(clearPending).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ code: 'install_failed', message: 'rollback interrupted' }))
  })

  it('recovers from a missing result through the installer transaction file', async () => {
    result = null
    transaction = {
      transactionPath: 'C:\\recovery\\abc-update.json',
      schemaVersion: 4,
      phase: 'payload_switched',
      oldVersion: '0.1.0',
      newVersion: '0.2.0',
      backupDir: 'C:\\Users\\test\\AppData\\Roaming\\KunInstallerRecovery\\update-backup-2',
      journalPath: 'C:\\recovery\\abc.json',
      transactionRoot: 'C:\\recovery',
      recoveryEnvironment: {
        KUN_INSTALLER_TRANSACTION: 'C:\\recovery\\abc-update.json',
        KUN_INSTALLER_JOURNAL: 'C:\\recovery\\abc.json',
        KUN_INSTALLER_TARGET: 'C:\\Kun'
      }
    }

    await (await installer()).reconcile(healthCheck)

    // The recovery record must carry the transaction-derived environment so
    // both rollback and finalize remain possible (#1). The finalize mock
    // captured the environment it was handed before converging the records.
    expect(finalizeUpdateTransactionAndCleanup).toHaveBeenCalledWith(expect.objectContaining({
      environment: {
        KUN_INSTALLER_TRANSACTION: 'C:\\recovery\\abc-update.json',
        KUN_INSTALLER_JOURNAL: 'C:\\recovery\\abc.json',
        KUN_INSTALLER_TARGET: 'C:\\Kun'
      },
      backupDir: 'C:\\Users\\test\\AppData\\Roaming\\KunInstallerRecovery\\update-backup-2'
    }))
    expect(writeGuiUpdateRecoveryRecord).toHaveBeenCalledWith(expect.objectContaining({
      recoveryEnvironment: expect.objectContaining({
        KUN_INSTALLER_TRANSACTION: 'C:\\recovery\\abc-update.json',
        KUN_INSTALLER_JOURNAL: 'C:\\recovery\\abc.json'
      })
    }))
  })

  it('blocks updates when the payload switched but no rollback record exists', async () => {
    result = null
    transaction = null

    const updateInstaller = await installer()
    await updateInstaller.reconcile(healthCheck)

    expect(recovery).toBeNull()
    expect(finalizeUpdateTransactionAndCleanup).not.toHaveBeenCalled()
    await expect(updateInstaller.install()).resolves.toMatchObject({ ok: false })
  })

  it('keeps every artifact when finalize cannot confirm the transaction', async () => {
    result = {
      schemaVersion: 2, outcome: 'success', code: 'success', message: '', at: new Date().toISOString(),
      transactionState: 'committed', backupDir: 'C:\\Users\\test\\AppData\\Roaming\\KunInstallerRecovery\\update-backup-1',
      recoveryEnvironment: { KUN_INSTALLER_TRANSACTION: 'C:\\recovery\\abc-update.json' }
    }
    finalizeUpdateTransactionAndCleanup.mockResolvedValue({
      kind: 'unconfirmed' as const,
      reason: 'helper exited 1'
    })

    await (await installer()).reconcile(healthCheck)

    expect(cleanupBackup).not.toHaveBeenCalled()
    expect(clearPending).not.toHaveBeenCalled()
    expect(clearRecovery).not.toHaveBeenCalled()
  })

  it('rolls back at grace expiry when no health proof exists', async () => {
    pending = null
    recovery = {
      schemaVersion: 2, installedVersion: '0.2.0', channel: 'stable', verifiedAt: new Date().toISOString(),
      healthAttempts: 1, backupExpiresAt: new Date(Date.now() - 1_000).toISOString(),
      backupDir: 'C:\\Users\\test\\AppData\\Roaming\\KunInstallerRecovery\\update-backup-1',
      recoveryEnvironment: { KUN_INSTALLER_TRANSACTION: 'C:\\recovery\\abc-update.json' }
    }
    healthCheck = vi.fn(async () => false)

    await (await installer()).reconcile(healthCheck)

    expect(scheduleUpdateRollbackAfterExit).toHaveBeenCalledWith(
      expect.objectContaining({ KUN_INSTALLER_TRANSACTION: 'C:\\recovery\\abc-update.json' })
    )
    expect(cleanupBackup).not.toHaveBeenCalled()
    expect(clearRecovery).not.toHaveBeenCalled()
  })

  it('finalizes at grace expiry when health is confirmed', async () => {
    pending = null
    recovery = {
      schemaVersion: 2, installedVersion: '0.2.0', channel: 'stable', verifiedAt: new Date().toISOString(),
      healthAttempts: 1, backupExpiresAt: new Date(Date.now() - 1_000).toISOString(),
      backupDir: 'C:\\Users\\test\\AppData\\Roaming\\KunInstallerRecovery\\update-backup-1',
      recoveryEnvironment: { KUN_INSTALLER_TRANSACTION: 'C:\\recovery\\abc-update.json' }
    }

    await (await installer()).reconcile(healthCheck)

    expect(finalizeUpdateTransactionAndCleanup).toHaveBeenCalled()
    expect(scheduleUpdateRollbackAfterExit).not.toHaveBeenCalled()
  })

  it('retries health checks while the process stays open', async () => {
    pending = null
    recovery = {
      schemaVersion: 1, installedVersion: '0.2.0', channel: 'stable', verifiedAt: new Date().toISOString(),
      healthAttempts: 1, nextHealthCheckAt: new Date(Date.now() + 6 * 60 * 60 * 1_000).toISOString(),
      backupExpiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString()
    }

    const updateInstaller = await installer()
    await updateInstaller.reconcile(healthCheck)
    expect(healthCheck).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000)
    expect(healthCheck).toHaveBeenCalledOnce()
  })
})
