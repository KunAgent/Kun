import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
  const bootstrap = call[1].at(-1)!
  const encoded = bootstrap.match(/'-EncodedCommand','([^']+)'/)![1]
  expect(bootstrap.includes('-Verb RunAs')).toBe(elevated)
  return { call, bootstrap, command: Buffer.from(encoded, 'base64').toString('utf16le') }
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
    const { call, command, bootstrap } = await launched(test)
    expect(call[0]).toMatch(/WindowsPowerShell\\v1\.0\\powershell\.exe$/u)
    expect(bootstrap).toContain('-WindowStyle Hidden -PassThru')
    expect(bootstrap).toContain('$coordinator.WaitForExit()')
    expect(bootstrap).toContain('$null=$coordinator.Handle')
    expect(bootstrap).toContain('if ($null -eq $exitCode) { exit 1 }')
    expect(bootstrap).toContain('exit $exitCode')
    expect(bootstrap).not.toContain('-NoNewWindow')
    expect(command).toContain('$gui=[Diagnostics.Process]::GetProcessById($waitPid)')
    expect(command).toContain('$null=$gui.Handle')
    expect(command).toContain('$gui.WaitForExit(90000)')
    expect(command).toContain('finally { $gui.Dispose() }')
    expect(command.indexOf('$null=$gui.Handle')).toBeLessThan(command.indexOf("WriteLine('ready:"))
    expect(command).not.toContain('Wait-Process -Id $waitPid')
    expect(command).toContain('Start-Process -FilePath $exe -ErrorAction Stop; exit 0')
    expect(command).toContain('[KunOneShotDeadline]::Start(300000, $false)')
    expect(command.indexOf('-Action ValidateUpdateRollback')).toBeLessThan(command.indexOf("WriteLine('ready:"))
    expect(command.indexOf("WriteLine('armed:")).toBeLessThan(command.indexOf('$gui.WaitForExit(90000)'))
    expect(command).toContain('$accepted.Wait(5000)')
    expect(call[2].detached).toBe(false)
    test.child.emit('spawn')
    await Promise.resolve()
    expect(ready).toBe(false)
    await acknowledge(command)
    await scheduled
    expect(test.child.unref).toHaveBeenCalledOnce()
    expect(test.child.kill).not.toHaveBeenCalled()
  })

  it('isolates every migration exit and reads the executable from its Unicode result file', async () => {
    const test = fixture()
    const scheduled = scheduleBoundedUpdateRollback('C:\\Kun\\recover.ps1', environment, 123, test.spawnHelper)
    const { command } = await launched(test)
    try {
      expect(command).toContain("$powershell=Join-Path $PSHOME 'powershell.exe'")
      for (const action of ['ValidateUpdateRollback', 'RecoverUpdateTransaction', 'ResolveRecoveryExecutable', 'FinalizeUpdateTransaction']) {
        expect(command).toContain(`& $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script -Action ${action} -Bounded`)
      }
      expect(command).not.toContain('& $script -Action')
      expect(command).toContain('$resultPath=[IO.Path]::GetTempFileName()')
      expect(command).toContain('-Action ResolveRecoveryExecutable -Bounded -ResultPath $resultPath')
      expect(command).toContain('[IO.File]::ReadAllText($resultPath, [Text.Encoding]::Unicode)')
      expect(command).toContain('finally { Remove-Item -LiteralPath $resultPath -Force')
      expect(command).not.toContain('Select-Object -Last 1')
    } finally {
      // Settle the simulated helper even when a command assertion fails.
      await acknowledge(command)
      await scheduled
    }
  })

  it('keeps every native action independently bounded without limiting ordinary installer runs', () => {
    const script = readFileSync(join(process.cwd(), 'build/windows-installer-migration.ps1'), 'utf8')
    expect(script).toContain('[switch]$Bounded')
    expect(script).toMatch(/if \(\$Bounded\) \{[\s\S]*?Environment\.Exit\(124\)[\s\S]*?300000[\s\S]*?\[KunInstallerActionDeadline\]::Start\(\)/)
  })

  it.each(['current', 'all'])('never treats a zero-exit %s coordinator as ready without its handshake', async (mode) => {
    const test = fixture()
    const scheduled = scheduleBoundedUpdateRollback('recover.ps1', { ...environment, KUN_INSTALLER_INSTALL_MODE: mode }, 123, test.spawnHelper)
    const rejected = expect(scheduled).rejects.toThrow('exited with 0 before readiness')
    await launched(test, mode === 'all')
    test.child.emit('exit', 0)
    await rejected
    expect(test.child.unref).not.toHaveBeenCalled()
  })

  it('does not authorize GUI exit when only the elevation bootstrap spawned', async () => {
    const test = fixture()
    let ready = false
    const scheduled = scheduleBoundedUpdateRollback('C:\\Kun\\recover.ps1', { ...environment, KUN_INSTALLER_INSTALL_MODE: 'all' }, 123, test.spawnHelper)
    scheduled.then(() => { ready = true })
    const { command } = await launched(test, true)
    test.child.emit('spawn')
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
    test.child.emit('spawn')
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
