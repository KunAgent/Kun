import { EventEmitter } from 'node:events'
import type { spawn as nodeSpawn } from 'node:child_process'
import type { Socket } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstallerRecoveryEnvironment } from './gui-updater-pending'
import { runBoundedUpdateTransaction, scheduleBoundedUpdateRollback } from './update-transaction-helper'
import * as readinessModule from './update-rollback-readiness'

const { createServer } = vi.hoisted(() => ({ createServer: vi.fn() }))
vi.mock('node:net', () => ({ createServer }))
vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./gui-updater-pending', () => ({ clearGuiUpdateRecovery: vi.fn(), clearPendingUpdate: vi.fn(),
  clearPendingUpdateResult: vi.fn(), cleanupPendingUpdateBackup: vi.fn() }))

function fixture() {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn(), kill: vi.fn() })
  const spawn = vi.fn(() => child)
  return { child, spawn, spawnHelper: spawn as unknown as typeof nodeSpawn }
}
const environment = { KUN_INSTALLER_TRANSACTION: 'C:\\temp\\transaction.json', KUN_INSTALLER_INSTALL_MODE: 'current' } as InstallerRecoveryEnvironment

let connect: (socket: Socket) => void
beforeEach(() => {
  createServer.mockImplementation((onConnection) => {
    connect = onConnection
    return Object.assign(new EventEmitter(), {
      listen: vi.fn((_path, listening: () => void) => queueMicrotask(listening)),
      close: vi.fn()
    })
  })
})
afterEach(() => vi.restoreAllMocks())

async function launched(test: ReturnType<typeof fixture>, elevated = false) {
  await vi.waitFor(() => expect(test.spawn).toHaveBeenCalledOnce(), { interval: 1 })
  const call = test.spawn.mock.calls[0] as unknown as [string, string[], { detached: boolean }]
  const encoded = elevated ? call[1].at(-1)!.match(/'-EncodedCommand','([^']+)'/)![1] : call[1].at(-1)!
  return { call, command: Buffer.from(encoded, 'base64').toString('utf16le') }
}

async function acknowledge(command: string, stale = false) {
  const token = command.match(/WriteLine\('ready:([^']+)'/)![1]
  const socket = Object.assign(new EventEmitter(), {
    setEncoding: vi.fn(), destroy: vi.fn(), end: vi.fn(),
    write: vi.fn((data: string) => {
      expect(data.trim()).toBe(`accepted:${token}`)
      queueMicrotask(() => socket.emit('data', `armed:${token}\n`))
    })
  })
  connect(socket as unknown as Socket)
  socket.emit('data', `ready:${stale ? 'stale-nonce' : token}\n`)
  await Promise.resolve()
}

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

  it('validates and acknowledges readiness before waiting for the GUI, without awaiting full rollback', async () => {
    const test = fixture()
    let ready = false
    const scheduled = scheduleBoundedUpdateRollback('C:\\Kun\\recover.ps1', environment, 123, test.spawnHelper)
    scheduled.then(() => { ready = true })
    const { call, command } = await launched(test)
    expect(command).toContain('Wait-Process -Id $waitPid -Timeout 90 -ErrorAction Stop')
    expect(command).toContain('Start-Process -FilePath $exe -ErrorAction Stop; exit 0')
    expect(command).toContain('[KunOneShotDeadline]::Start(300000, $false)')
    expect(command.indexOf('-Action ValidateUpdateRollback')).toBeLessThan(command.indexOf("WriteLine('ready:"))
    expect(command.indexOf("WriteLine('armed:")).toBeLessThan(command.indexOf('Wait-Process'))
    expect(command).toContain('$accepted.Wait(5000)')
    expect(call[2].detached).toBe(true)
    test.child.emit('spawn')
    await Promise.resolve()
    expect(ready).toBe(false)
    await acknowledge(command)
    await scheduled
    expect(test.child.unref).toHaveBeenCalledOnce()
    expect(test.child.kill).not.toHaveBeenCalled()
  })

  it('does not authorize GUI exit when only the elevation launcher spawned or exited successfully', async () => {
    const test = fixture()
    let ready = false
    const scheduled = scheduleBoundedUpdateRollback('C:\\Kun\\recover.ps1', { ...environment, KUN_INSTALLER_INSTALL_MODE: 'all' }, 123, test.spawnHelper)
    scheduled.then(() => { ready = true })
    const { command } = await launched(test, true)
    test.child.emit('spawn')
    test.child.emit('exit', 0)
    await Promise.resolve()
    expect(ready).toBe(false)
    await acknowledge(command)
    await scheduled
    expect(ready).toBe(true)
  })

  it('also bounds the elevation launcher and rejects an OS spawn error', async () => {
    const test = fixture()
    const scheduled = scheduleBoundedUpdateRollback('C:\\Kun\\recover.ps1', { ...environment, KUN_INSTALLER_INSTALL_MODE: 'all' }, 123, test.spawnHelper)
    const { call } = await launched(test, true)
    expect(call[1].at(-1)).toContain('[KunOneShotDeadline]::Start(300000, $false)')
    expect(call[1].at(-1)).toContain('-Verb RunAs')
    test.child.emit('error', new Error('spawn unavailable'))
    await expect(scheduled).rejects.toThrow('spawn unavailable')
    expect(test.child.unref).not.toHaveBeenCalled()
  })

  it.each(['current', 'all'])('rejects %s script startup failure or denied UAC', async (mode) => {
    const test = fixture()
    const scheduled = scheduleBoundedUpdateRollback('recover.ps1', { ...environment, KUN_INSTALLER_INSTALL_MODE: mode }, 123, test.spawnHelper)
    await launched(test, mode === 'all')
    test.child.emit('spawn')
    test.child.emit('exit', 1)
    await expect(scheduled).rejects.toThrow('exited with 1 before readiness')
    expect(test.child.unref).not.toHaveBeenCalled()
  })

  it('times out when elevation succeeded but the actual helper never acknowledges', async () => {
    const open = readinessModule.openUpdateRollbackReadiness
    vi.spyOn(readinessModule, 'openUpdateRollbackReadiness').mockImplementation(() => open(40))
    const test = fixture()
    const scheduled = scheduleBoundedUpdateRollback('recover.ps1', { ...environment, KUN_INSTALLER_INSTALL_MODE: 'all' }, 123, test.spawnHelper)
    const rejected = expect(scheduled).rejects.toThrow('readiness timed out')
    await launched(test, true)
    test.child.emit('exit', 0)
    await rejected
    expect(test.child.unref).not.toHaveBeenCalled()
    expect(test.child.kill).toHaveBeenCalledOnce()
  })

  it('rejects stale readiness acknowledgments', async () => {
    const test = fixture()
    const scheduled = scheduleBoundedUpdateRollback('recover.ps1', environment, 123, test.spawnHelper)
    const rejected = expect(scheduled).rejects.toThrow('stale update rollback readiness')
    const { command } = await launched(test)
    await acknowledge(command, true)
    await rejected
    expect(test.child.unref).not.toHaveBeenCalled()
  })
})
