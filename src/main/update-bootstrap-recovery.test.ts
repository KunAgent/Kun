import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getVersion: () => '0.2.0', relaunch: vi.fn(), exit: vi.fn() }
}))

let pending: Record<string, unknown> | null
let result: Record<string, unknown> | null
let recovery: Record<string, unknown> | null
let transaction: Record<string, unknown> | null

vi.mock('./gui-updater-pending', () => ({
  GUI_UPDATE_BACKUP_GRACE_MS: 7 * 86_400_000,
  GUI_UPDATE_MAX_HEALTH_ATTEMPTS: 3,
  clearGuiUpdateRecovery: vi.fn(async () => { recovery = null }),
  clearPendingUpdate: vi.fn(async () => { pending = null }),
  clearPendingUpdateResult: vi.fn(async () => { result = null }),
  readGuiUpdateRecovery: vi.fn(async () => recovery),
  readPendingUpdate: vi.fn(async () => pending),
  readPendingUpdateResult: vi.fn(async () => result),
  readInstallerUpdateTransaction: vi.fn(async () => transaction),
  writeGuiUpdateRecovery: vi.fn(async (value) => {
    recovery = { schemaVersion: 2, ...value }
    return recovery
  })
}))

describe('recoverUpdateBeforeRuntimeStart', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    pending = {
      oldVersion: '0.1.0', newVersion: '0.2.0', channel: 'stable'
    }
    result = {
      outcome: 'success', transactionState: 'committed',
      backupDir: 'C:\\Users\\test\\AppData\\Roaming\\KunInstallerRecovery\\update-backup-1',
      recoveryEnvironment: {
        KUN_INSTALLER_TRANSACTION: 'C:\\Users\\test\\AppData\\Roaming\\KunInstallerRecovery\\abc-update.json',
        KUN_INSTALLER_JOURNAL: 'C:\\Users\\test\\AppData\\Roaming\\KunInstallerRecovery\\abc.json'
      }
    }
    recovery = null
    transaction = null
  })

  it('records every incomplete first startup before rolling back at the threshold', async () => {
    const scheduleRollback = vi.fn(async () => undefined)
    const exit = vi.fn()
    const { recoverUpdateBeforeRuntimeStart } = await import('./update-bootstrap-recovery')
    const deps = { platform: 'win32' as const, version: () => '0.2.0', scheduleRollback, relaunch: vi.fn(), exit }

    await expect(recoverUpdateBeforeRuntimeStart(deps)).resolves.toBe(false)
    expect(recovery).toMatchObject({ bootAttempts: 1 })
    await expect(recoverUpdateBeforeRuntimeStart(deps)).resolves.toBe(false)
    expect(recovery).toMatchObject({ bootAttempts: 2 })
    await expect(recoverUpdateBeforeRuntimeStart(deps)).resolves.toBe(true)

    expect(scheduleRollback).toHaveBeenCalledWith(expect.objectContaining({
      KUN_INSTALLER_TRANSACTION: expect.stringContaining('abc-update.json')
    }))
    expect(exit).toHaveBeenCalledWith(0)
    expect(recovery).toMatchObject({ bootAttempts: 3 })
  })

  it('recovers payload_switched and awaiting_health through the shared state table', async () => {
    const scheduleRollback = vi.fn(async () => undefined)
    const { recoverUpdateBeforeRuntimeStart } = await import('./update-bootstrap-recovery')
    const deps = { platform: 'win32' as const, version: () => '0.2.0', scheduleRollback, relaunch: vi.fn(), exit: vi.fn() }

    for (const transactionState of ['payload_switched', 'awaiting_health'] as const) {
      recovery = null
      result = {
        outcome: 'success', transactionState,
        backupDir: 'C:\\Users\\test\\AppData\\Roaming\\KunInstallerRecovery\\update-backup-1',
        recoveryEnvironment: {
          KUN_INSTALLER_TRANSACTION: 'C:\\recovery\\abc-update.json',
          KUN_INSTALLER_JOURNAL: 'C:\\recovery\\abc.json'
        }
      }
      await expect(recoverUpdateBeforeRuntimeStart(deps)).resolves.toBe(false)
      expect(recovery).toMatchObject({ bootAttempts: 1 })
    }
  })

  it('falls back to the installer transaction file when the result is missing', async () => {
    result = null
    transaction = {
      transactionPath: 'C:\\recovery\\abc-update.json',
      schemaVersion: 4,
      phase: 'awaiting_health',
      oldVersion: '0.1.0',
      newVersion: '0.2.0',
      backupDir: 'C:\\recovery\\update-backup-2',
      journalPath: 'C:\\recovery\\abc.json',
      transactionRoot: 'C:\\recovery',
      recoveryEnvironment: {
        KUN_INSTALLER_TRANSACTION: 'C:\\recovery\\abc-update.json',
        KUN_INSTALLER_JOURNAL: 'C:\\recovery\\abc.json',
        KUN_INSTALLER_TARGET: 'C:\\Kun'
      }
    }
    const { recoverUpdateBeforeRuntimeStart } = await import('./update-bootstrap-recovery')

    await expect(recoverUpdateBeforeRuntimeStart({
      platform: 'win32', version: () => '0.2.0', scheduleRollback: vi.fn(), relaunch: vi.fn(), exit: vi.fn()
    })).resolves.toBe(false)
    expect(recovery).toMatchObject({
      bootAttempts: 1,
      recoveryEnvironment: {
        KUN_INSTALLER_TRANSACTION: 'C:\\recovery\\abc-update.json',
        KUN_INSTALLER_JOURNAL: 'C:\\recovery\\abc.json'
      }
    })
  })

  it('does not create a recovery record without any rollback context', async () => {
    result = null
    transaction = null
    const { recoverUpdateBeforeRuntimeStart } = await import('./update-bootstrap-recovery')

    await expect(recoverUpdateBeforeRuntimeStart({
      platform: 'win32', version: () => '0.2.0', scheduleRollback: vi.fn(), relaunch: vi.fn(), exit: vi.fn()
    })).resolves.toBe(false)
    expect(recovery).toBeNull()
  })

  it('keeps the recovery record when the grace window has expired', async () => {
    const clearGuiUpdateRecovery = (await import('./gui-updater-pending')).clearGuiUpdateRecovery
    recovery = {
      schemaVersion: 2, installedVersion: '0.2.0', channel: 'stable', verifiedAt: new Date().toISOString(),
      healthAttempts: 0, bootAttempts: 1,
      backupExpiresAt: new Date(Date.now() - 1_000).toISOString(),
      recoveryEnvironment: { KUN_INSTALLER_TRANSACTION: 'C:\\recovery\\abc-update.json' }
    }
    const { recoverUpdateBeforeRuntimeStart } = await import('./update-bootstrap-recovery')

    await expect(recoverUpdateBeforeRuntimeStart({
      platform: 'win32', version: () => '0.2.0', scheduleRollback: vi.fn(), relaunch: vi.fn(), exit: vi.fn()
    })).resolves.toBe(false)
    expect(clearGuiUpdateRecovery).not.toHaveBeenCalled()
  })
})
