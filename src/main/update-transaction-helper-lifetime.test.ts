import { EventEmitter } from 'node:events'
import type { spawn as nodeSpawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import type { InstallerRecoveryEnvironment } from './gui-updater-pending'
import { runBoundedUpdateTransaction, scheduleBoundedUpdateRollback } from './update-transaction-helper'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./gui-updater-pending', () => ({ clearGuiUpdateRecovery: vi.fn(), clearPendingUpdate: vi.fn(),
  clearPendingUpdateResult: vi.fn(), cleanupPendingUpdateBackup: vi.fn() }))

function fixture() {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
  const spawn = vi.fn(() => child)
  return { child, spawn, spawnHelper: spawn as unknown as typeof nodeSpawn }
}
const environment = { KUN_INSTALLER_TRANSACTION: 'C:\\temp\\transaction.json', KUN_INSTALLER_INSTALL_MODE: 'current' } as InstallerRecoveryEnvironment

describe('one-shot update helper deadlines', () => {
  it('bounds the helper independently of Main and propagates transaction failure', async () => {
    const test = fixture()
    const completed = runBoundedUpdateTransaction('C:\\Program Files\\Kun\\recover.ps1', 'FinalizeUpdateTransaction', environment, test.spawnHelper)
    const call = test.spawn.mock.calls[0] as unknown as [string, string[], { timeout: number }]
    const command = Buffer.from(call[1].at(-1)!, 'base64').toString('utf16le')
    expect(command).toContain('[KunOneShotDeadline]::Start(300000, $false)')
    expect(command).toContain('Environment.Exit(124)')
    expect(command).toContain('exit $LASTEXITCODE')
    expect(call[2].timeout).toBe(310_000)
    test.child.emit('exit', 1)
    await expect(completed).rejects.toThrow('exited with 1')
  })

  it('bounds parent waiting and ends immediately after launching the new independent app', async () => {
    const test = fixture()
    const scheduled = scheduleBoundedUpdateRollback('C:\\Kun\\recover.ps1', environment, 123, test.spawnHelper)
    const call = test.spawn.mock.calls[0] as unknown as [string, string[], { detached: boolean }]
    const command = Buffer.from(call[1].at(-1)!, 'base64').toString('utf16le')
    expect(command).toContain('Wait-Process -Id $waitPid -Timeout 90 -ErrorAction Stop')
    expect(command).toContain('Start-Process -FilePath $exe -ErrorAction Stop; exit 0')
    expect(command).toContain('[KunOneShotDeadline]::Start(300000, $false)')
    expect(call[2].detached).toBe(true)
    test.child.emit('spawn')
    await scheduled
    expect(test.child.unref).toHaveBeenCalledOnce()
  })

  it('also bounds the elevation launcher and rejects an OS spawn error', async () => {
    const test = fixture()
    const scheduled = scheduleBoundedUpdateRollback('C:\\Kun\\recover.ps1', { ...environment, KUN_INSTALLER_INSTALL_MODE: 'all' }, 123, test.spawnHelper)
    const call = test.spawn.mock.calls[0] as unknown as [string, string[]]
    expect(call[1].at(-1)).toContain('[KunOneShotDeadline]::Start(300000, $false)')
    expect(call[1].at(-1)).toContain('-Verb RunAs')
    test.child.emit('error', new Error('spawn unavailable'))
    await expect(scheduled).rejects.toThrow('spawn unavailable')
    expect(test.child.unref).not.toHaveBeenCalled()
  })
})
