import { beforeEach, describe, expect, it, vi } from 'vitest'

let version = '0.2.0'
let pending: Record<string, unknown> | null
let result: Record<string, unknown> | null
let recovery: Record<string, unknown> | null
let healthCheck = vi.fn(async () => true)
const emit = vi.fn()
const clearPending = vi.fn(async () => { pending = null })
const clearResult = vi.fn(async () => { result = null })
const cleanupBackup = vi.fn(async () => undefined)

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
  clearGuiUpdateRecovery: vi.fn(async () => { recovery = null }),
  clearPendingUpdate: clearPending,
  clearPendingUpdateResult: clearResult,
  cleanupPendingUpdateBackup: cleanupBackup,
  readGuiUpdateRecovery: vi.fn(async () => recovery),
  readPendingUpdate: vi.fn(async () => pending),
  readPendingUpdateResult: vi.fn(async () => result),
  setPendingUpdateEnvironment: vi.fn(() => () => undefined),
  writeGuiUpdateRecovery: vi.fn(async (value) => { recovery = value; return value }),
  writePendingUpdate: vi.fn(),
  writePendingUpdateResult: vi.fn(async (value) => { result = value; return value })
}))

vi.mock('./gui-updater-support', () => ({ setWindowsInstallerUpdateSource: vi.fn(() => () => undefined) }))
vi.mock('./update-transaction-helper', () => ({
  runUpdateTransactionHelper: vi.fn(async () => undefined),
  scheduleUpdateRollbackAfterExit: vi.fn(async () => undefined)
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
  healthCheck = vi.fn(async () => true)
})

describe('GuiUpdateInstaller reconciliation', () => {
  it('converges a successful cleanup_pending transaction', async () => {
    result = {
      schemaVersion: 2, outcome: 'success', code: 'success', message: '', at: new Date().toISOString(),
      transactionState: 'cleanup_pending', backupDir: 'C:\\Users\\test\\AppData\\Roaming\\KunInstallerRecovery\\update-backup-1'
    }

    await (await installer()).reconcile(healthCheck)

    expect(cleanupBackup).toHaveBeenCalledWith(expect.stringContaining('update-backup-1'))
    expect(pending).toBeNull()
    expect(result).toBeNull()
    expect(recovery).toBeNull()
  })

  it('converges an incomplete rollback when the old application is running', async () => {
    version = '0.1.0'
    result = {
      schemaVersion: 2, outcome: 'aborted', code: 'rollback_failed', message: 'rollback interrupted', at: new Date().toISOString(),
      transactionState: 'rollback_incomplete', rollbackOutcome: 'failed'
    }

    await (await installer()).reconcile(healthCheck)

    expect(pending).toBeNull()
    expect(result).toBeNull()
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ code: 'install_failed', message: 'rollback interrupted' }))
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
