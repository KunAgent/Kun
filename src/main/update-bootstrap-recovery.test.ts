import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getVersion: () => '0.2.0', relaunch: vi.fn(), exit: vi.fn() }
}))

let pending: Record<string, unknown> | null
let result: Record<string, unknown> | null
let recovery: Record<string, unknown> | null

vi.mock('./gui-updater-pending', () => ({
  GUI_UPDATE_BACKUP_GRACE_MS: 7 * 86_400_000,
  GUI_UPDATE_MAX_HEALTH_ATTEMPTS: 3,
  clearGuiUpdateRecovery: vi.fn(async () => { recovery = null }),
  clearPendingUpdate: vi.fn(async () => { pending = null }),
  clearPendingUpdateResult: vi.fn(async () => { result = null }),
  readGuiUpdateRecovery: vi.fn(async () => recovery),
  readPendingUpdate: vi.fn(async () => pending),
  readPendingUpdateResult: vi.fn(async () => result),
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

  it('does not create a recovery record without installer-authored recovery context', async () => {
    result = { outcome: 'success', transactionState: 'committed' }
    const { recoverUpdateBeforeRuntimeStart } = await import('./update-bootstrap-recovery')

    await expect(recoverUpdateBeforeRuntimeStart({
      platform: 'win32', version: () => '0.2.0', scheduleRollback: vi.fn(), relaunch: vi.fn(), exit: vi.fn()
    })).resolves.toBe(false)
    expect(recovery).toBeNull()
  })
})
