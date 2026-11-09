import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'

const state = vi.hoisted(() => ({ directory: '', userData: '', runningVersion: '0.2.0', executable: 'C:\\Program Files\\Kun\\Kun.exe', mode: 'success', record: {} as Record<string, unknown>, machineMatches: true, spawn: vi.fn() }))
const guid = '9a7a0e35-31f3-5cbb-809b-53d8569ab76e'
const installDir = 'C:\\Program Files\\Kun'
const commonRoot = 'C:\\ProgramData\\KunInstallerRecovery'
vi.mock('electron', () => ({ app: { isPackaged: true, getVersion: () => state.runningVersion,
  getPath: (key: string) => key === 'exe' ? state.executable : state.userData, quit: vi.fn() } }))
vi.mock('node:child_process', async (original) => ({ ...await original<typeof import('node:child_process')>(), spawn: state.spawn }))
vi.mock('./installer-recovery-identity', async (original) => ({ ...await original<typeof import('./installer-recovery-identity')>(),
  installerRecoveryIdentity: () => ({ appGuid: '9a7a0e35-31f3-5cbb-809b-53d8569ab76e', executable: state.executable, productName: 'Kun' }),
  trustedCommonRecoveryFile: vi.fn(async () => true), commonInstallerRecoveryRoot: async () => 'C:\\ProgramData\\KunInstallerRecovery',
  registeredInstallerLocations: async () => state.machineMatches ? [{ scope: 'all',
    installDir: 'C:\\Program Files\\Kun' + (state.mode === 'stage' ? '.kun-stage-1' : '') }] :
    [{ scope: 'current', installDir: 'C:\\Program Files\\Kun' }, { scope: 'all', installDir: 'C:\\Other\\Kun' }] }))
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>()
  return { ...fs,
    access: vi.fn(async (file: Parameters<typeof fs.access>[0]) => String(file).includes('installer-recovery') ? undefined : fs.access(file)),
    readdir: vi.fn(async (file: Parameters<typeof fs.readdir>[0]) => String(file) === 'C:\\ProgramData\\KunInstallerRecovery' ?
      ['9a7a0e35-31f3-5cbb-809b-53d8569ab76e-update.json'] : fs.readdir(file)),
    readFile: vi.fn(async (file: Parameters<typeof fs.readFile>[0], options?: Parameters<typeof fs.readFile>[1]) => {
      if (String(file).startsWith('C:\\ProgramData')) throw Object.assign(new Error('protected'), { code: 'EACCES' })
      return fs.readFile(file, options)
    }) }
})
// Only inject the OS platform at this public boundary; execute the real helper.
vi.mock('./update-transaction-helper', async (original) => {
  const actual = await original<typeof import('./update-transaction-helper')>()
  return { ...actual, finalizeUpdateTransactionAndCleanup: (input: Parameters<typeof actual.finalizeUpdateTransactionAndCleanup>[0]) =>
    actual.finalizeUpdateTransactionAndCleanup(input, { platform: 'win32' }) }
})
vi.mock('./gui-updater-support', () => ({ setWindowsInstallerUpdateSource: vi.fn() }))
vi.mock('./logger', () => ({ logInfo: vi.fn() }))
vi.mock('./relaunch-app', () => ({ relaunchApp: vi.fn() }))

import { app } from 'electron'
import * as pending from './gui-updater-pending'
import { GuiUpdateInstaller } from './gui-updater-install'
import { recoverUpdateBeforeRuntimeStart } from './update-bootstrap-recovery'
import { finalizeUpdateTransactionAndCleanup } from './update-transaction-helper'
import { privilegedUpdateOperation } from './update-elevated-transaction'

const environment = { KUN_INSTALLER_INSTALL_MODE: 'all', KUN_INSTALLER_APP_GUID: guid,
  KUN_INSTALLER_SOURCE: installDir, KUN_INSTALLER_TARGET: installDir,
  KUN_INSTALLER_TRANSACTION: win32.join(commonRoot, `${guid}-update.json`) }

function updater() {
  return new GuiUpdateInstaller({ runExclusive: async (operation) => operation(),
    details: () => ({ hasDownloaded: false, targetVersion: '', channel: 'stable' }), stateInfo: () => undefined,
    emit: vi.fn(), preflight: vi.fn(), prepare: vi.fn(), clearPreparation: vi.fn(), setQuitting: vi.fn(),
    quitAndInstall: vi.fn(), isSessionEnding: () => false })
}

beforeEach(async () => {
  vi.clearAllMocks()
  state.directory = await mkdtemp(join(tmpdir(), 'kun-elevated-update-'))
  state.userData = join(state.directory, 'Roaming', 'Kun')
  state.mode = 'success'
  state.runningVersion = '0.2.0'
  state.executable = 'C:\\Program Files\\Kun\\Kun.exe'
  state.machineMatches = true
  state.record = { SchemaVersion: 4, AppGuid: guid, InstallMode: 'all', Phase: 'committed',
    OldVersion: '0.1.0', NewVersion: '0.2.0', Source: installDir, Target: installDir,
    AppExecutable: 'Kun.exe', ProductName: 'Kun', CanonicalLeaf: 'Kun', Shortcuts: [],
    InstallRegistryKey: `Software\\${guid}`, UninstallRegistryKey: `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}`,
    StageRoot: `${installDir}.kun-stage-1`, JournalPath: win32.join(commonRoot, `${guid}.json`),
    BackupRoot: win32.join(commonRoot, 'update-backup-1'), AutomaticUpdate: '1', InPlace: true,
    AssetsRoot: environment.KUN_INSTALLER_TRANSACTION + '.assets', HealthResult: environment.KUN_INSTALLER_TRANSACTION + '.health.json',
    OldPayloadRoot: installDir + '.kun-old-1', FailedPayloadRoot: installDir + '.kun-failed',
    CommonDesktop: 'C:\\Users\\Public\\Desktop', CommonPrograms: 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs' }
  await writeFile(join(state.directory, 'authority.json'), JSON.stringify(state.record))
  await pending.writePendingUpdate({ oldVersion: '0.1.0', newVersion: '0.2.0', installDir, installerPath: 'C:\\update.exe', channel: 'stable' })
  await pending.writeGuiUpdateRecovery({ installedVersion: '0.2.0', oldVersion: '0.1.0', channel: 'stable',
    verifiedAt: new Date().toISOString(), bootAttempts: 0, healthAttempts: 0, recoveryEnvironment: environment,
    backupExpiresAt: new Date(Date.now() + 86400_000).toISOString() })
  state.spawn.mockImplementation((_file: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn(), unref: vi.fn() })
    const bootstrap = Buffer.from(args.at(-1)!, 'base64').toString('utf16le')
    expect(bootstrap).toContain('-Verb RunAs')
    const inner = Buffer.from(bootstrap.match(/-EncodedCommand','([^']+)'/u)![1], 'base64').toString('utf16le')
    const request = JSON.parse(Buffer.from(inner.match(/-RequestBase64 '([^']+)'/u)![1], 'base64').toString())
    const pipeName = inner.match(/-PipeName '([^']+)'/u)![1]
    const token = inner.match(/-Token '([^']+)'/u)![1]
    setImmediate(() => {
      if (state.mode === 'cancel' || (state.mode === 'cancel-finalize' && request.operation === 'finalize')) { child.emit('exit', 1); return }
      if (state.mode === 'timeout') return
      const pipe = createConnection(process.platform === 'win32' ? `\\\\.\\pipe\\${pipeName}`
        : join(tmpdir(), `ku-${pipeName.slice('kun-update-operation-'.length).replaceAll('-', '')}.sock`))
      pipe.on('error', () => undefined)
      pipe.on('connect', () => { void (async () => {
        // Model the elevated side reading the same persisted authority that
        // ordinary GUI reads cannot access, not a hand-authored GUI result.
        const transaction = JSON.parse(await readFile(join(state.directory, 'authority.json'), 'utf8'))
        if (state.mode === 'version') transaction.NewVersion = 'wrong'
        if (state.mode === 'identity') transaction.AppGuid = 'wrong'
        if (state.mode === 'scope') transaction.InstallMode = 'current'
        if (state.mode === 'path') transaction.Target = 'C:\\Another\\Kun'
        if (state.mode === 'nonce') request.nonce = 'stale-nonce'
        if (state.mode === 'operation') request.operation = 'inspect'
        pipe.end(JSON.stringify({ token: state.mode === 'forged' ? 'stale-token' : token,
          request, outcome: request.operation === 'inspect' ? 'inspected' : 'finalized', transaction }) + '\n')
      })().catch((error) => pipe.destroy(error)) })
      pipe.on('close', () => { if (state.mode !== 'noexit') child.emit('exit', 0) })
    })
    return child
  })
})
afterEach(async () => {
  if (vi.isFakeTimers()) vi.clearAllTimers()
  vi.useRealTimers()
  await rm(state.directory, { recursive: true, force: true })
})

describe('protected all-users recovery', () => {
  it('uses the real default RunAs path before any ordinary finalize read and only clears after confirmation', async () => {
    expect(await finalizeUpdateTransactionAndCleanup({ environment })).toMatchObject({ kind: 'finalized' })
    expect(state.spawn).toHaveBeenCalledOnce()
    expect(vi.mocked(readFile).mock.calls.some(([file]) => String(file).startsWith('C:\\ProgramData'))).toBe(false)
    await expect(pending.readGuiUpdateRecovery()).resolves.toBeNull()
    await expect(pending.readPendingUpdate()).resolves.toBeNull()
  })

  it.each(['cancel', 'forged', 'version', 'identity', 'scope', 'path', 'nonce', 'operation'])('keeps real GUI recovery for %s', async (mode) => {
    state.mode = mode
    expect(await finalizeUpdateTransactionAndCleanup({ environment })).toMatchObject({ kind: 'unconfirmed' })
    await expect(pending.readGuiUpdateRecovery()).resolves.not.toBeNull()
    await expect(pending.readPendingUpdate()).resolves.not.toBeNull()
  })

  it.each(['timeout', 'noexit'])('bounds a helper with no completed acknowledgment (%s), retaining recovery', async (mode) => {
    state.mode = mode
    await expect(privilegedUpdateOperation('finalize', { oldVersion: '0.1.0', newVersion: '0.2.0', installDir }, { timeoutMs: 20 })).rejects.toThrow('timed out')
    await expect(pending.readGuiUpdateRecovery()).resolves.not.toBeNull()
  })

  it('does not turn three healthy starts with denied administrative cleanup into startup rollback', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    state.mode = 'cancel'
    const scheduleRollback = vi.fn(async () => undefined)
    const deps = { platform: 'win32' as const, version: () => '0.2.0', scheduleRollback,
      relaunch: vi.fn(), exit: vi.fn(), log: vi.fn() }
    for (let boot = 0; boot < 3; boot++) {
      await expect(recoverUpdateBeforeRuntimeStart(deps)).resolves.toBe(false)
      await expect(pending.readGuiUpdateRecovery()).resolves.toMatchObject({ bootAttempts: 1 })
      await updater().reconcile(async () => true)
      await expect(pending.readGuiUpdateRecovery()).resolves.toMatchObject({ bootAttempts: 0, healthAttempts: 0 })
    }
    expect(scheduleRollback).not.toHaveBeenCalled()
    expect(app.quit).not.toHaveBeenCalled()
    expect(state.spawn.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it.each(['success', 'cancel-finalize'])('allows a restored old payload to inspect/finalize without a bootstrap exit loop (%s)', async (mode) => {
    state.mode = mode
    state.runningVersion = '0.1.0'
    const source = 'C:\\Program Files\\DeepSeek GUI'
    state.executable = win32.join(source, 'Kun.exe')
    const transaction = { ...state.record, Source: source, Phase: 'rolled_back', InPlace: false }
    await writeFile(join(state.directory, 'authority.json'), JSON.stringify(transaction))
    await pending.writePendingUpdate({ oldVersion: '0.1.0', newVersion: '0.2.0', installDir: source,
      installerPath: 'C:\\update.exe', channel: 'stable' })
    await pending.clearGuiUpdateRecovery()
    const scheduleRollback = vi.fn(async () => undefined)
    const deps = { platform: 'win32' as const, version: () => state.runningVersion, scheduleRollback,
      relaunch: vi.fn(), exit: vi.fn(), log: vi.fn() }
    await expect(recoverUpdateBeforeRuntimeStart(deps)).resolves.toBe(false)
    expect(state.spawn).toHaveBeenCalledTimes(2)
    await expect(pending.readGuiUpdateRecovery()).resolves.toBeNull()
    if (mode === 'success') await expect(pending.readPendingUpdate()).resolves.toBeNull()
    else await expect(pending.readPendingUpdate()).resolves.not.toBeNull()
    await expect(recoverUpdateBeforeRuntimeStart(deps)).resolves.toBe(false)
    expect(deps.exit).not.toHaveBeenCalled()
    expect(scheduleRollback).not.toHaveBeenCalled()
  })

  it('keeps cached rollback records when inspection is refused on an old-version startup', async () => {
    state.mode = 'cancel'
    state.runningVersion = '0.1.0'
    const recovery = (await pending.readGuiUpdateRecovery())!
    await pending.writeGuiUpdateRecovery({ ...recovery, bootAttempts: 2 })
    await pending.writePendingUpdateResult({ outcome: 'success', code: 'success', message: 'Installed',
      transactionState: 'committed', recoveryEnvironment: environment })
    const deps = { platform: 'win32' as const, version: () => state.runningVersion,
      scheduleRollback: vi.fn(async () => undefined), relaunch: vi.fn(), exit: vi.fn(), log: vi.fn() }
    await expect(recoverUpdateBeforeRuntimeStart(deps)).resolves.toBe(false)
    await expect(pending.readPendingUpdate()).resolves.not.toBeNull()
    await expect(pending.readPendingUpdateResult()).resolves.not.toBeNull()
    await expect(pending.readGuiUpdateRecovery()).resolves.toMatchObject({ bootAttempts: 2 })
    expect(deps.exit).not.toHaveBeenCalled()
    expect(deps.scheduleRollback).not.toHaveBeenCalled()
  })

  it.each(['0.0.9', '0.2.0'])('rejects a rolled_back reply for the wrong running payload version %s', async (runningVersion) => {
    state.runningVersion = runningVersion
    await writeFile(join(state.directory, 'authority.json'), JSON.stringify({ ...state.record, Phase: 'rolled_back' }))
    await expect(privilegedUpdateOperation('inspect', { oldVersion: '0.1.0', newVersion: '0.2.0', installDir })).rejects.toThrow('Unbound')
    await expect(pending.readPendingUpdate()).resolves.not.toBeNull()
  })

  it('checks a new boot inside the persisted cooldown and clears transient health failures before another startup rollback', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    state.mode = 'cancel'
    const scheduleRollback = vi.fn(async () => undefined)
    const deps = { platform: 'win32' as const, version: () => state.runningVersion, scheduleRollback,
      relaunch: vi.fn(), exit: vi.fn(), log: vi.fn() }
    const first = updater()
    const unhealthy = vi.fn(async () => false)
    await recoverUpdateBeforeRuntimeStart(deps)
    await first.reconcile(unhealthy)
    await expect(pending.readGuiUpdateRecovery()).resolves.toMatchObject({ healthAttempts: 1, bootAttempts: 1 })
    await first.reconcile(unhealthy)
    expect(unhealthy).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    await expect(recoverUpdateBeforeRuntimeStart(deps)).resolves.toBe(false)
    const healthy = vi.fn(async () => true)
    await updater().reconcile(healthy)
    expect(healthy).toHaveBeenCalledOnce()
    await expect(pending.readGuiUpdateRecovery()).resolves.toMatchObject({ healthAttempts: 0, bootAttempts: 0 })
    await expect(recoverUpdateBeforeRuntimeStart(deps)).resolves.toBe(false)
    await updater().reconcile(healthy)
    expect(healthy).toHaveBeenCalledTimes(2)
    expect(scheduleRollback).not.toHaveBeenCalled()
    expect(app.quit).not.toHaveBeenCalled()
  })

  it('retains healthy grace-expired recovery and retries cleanup instead of rolling back when UAC is refused', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    state.mode = 'cancel'
    const record = (await pending.readGuiUpdateRecovery())!
    await pending.writeGuiUpdateRecovery({ ...record, bootAttempts: 2, healthAttempts: 1,
      backupExpiresAt: new Date(Date.now() - 1).toISOString(), nextHealthCheckAt: new Date(Date.now() + 3_600_000).toISOString() })
    const scheduleRollback = vi.fn(async () => undefined)
    const deps = { platform: 'win32' as const, version: () => state.runningVersion, scheduleRollback,
      relaunch: vi.fn(), exit: vi.fn(), log: vi.fn() }
    await expect(recoverUpdateBeforeRuntimeStart(deps)).resolves.toBe(false)
    const instance = updater(), healthy = vi.fn(async () => true)
    await instance.reconcile(healthy)
    const retained = await pending.readGuiUpdateRecovery()
    expect(retained).toMatchObject({ healthAttempts: 0, bootAttempts: 0, recoveryEnvironment: environment })
    expect(Date.parse(retained!.nextHealthCheckAt!)).toBeGreaterThan(Date.now())
    await instance.reconcile(healthy)
    expect(healthy).toHaveBeenCalledOnce()
    expect(scheduleRollback).not.toHaveBeenCalled()
    expect(app.quit).not.toHaveBeenCalled()
    await expect(pending.readPendingUpdate()).resolves.not.toBeNull()
  })

  it('still rolls back after three actual incomplete starts', async () => {
    state.mode = 'cancel'
    const scheduleRollback = vi.fn(async () => undefined)
    const deps = { platform: 'win32' as const, version: () => '0.2.0', scheduleRollback, relaunch: vi.fn(), exit: vi.fn() }
    await recoverUpdateBeforeRuntimeStart(deps)
    await recoverUpdateBeforeRuntimeStart(deps)
    await expect(recoverUpdateBeforeRuntimeStart(deps)).resolves.toBe(true)
    expect(scheduleRollback).toHaveBeenCalledWith(environment)
  })

  it('does not elevate current-user cleanup or inspect a separate machine installation', async () => {
    state.machineMatches = false
    await pending.readInstallerUpdateTransaction({ oldVersion: '0.1.0', newVersion: '0.2.0', installDir }, { platform: 'win32' })
    expect(state.spawn).not.toHaveBeenCalled()
    const current = { KUN_INSTALLER_INSTALL_MODE: 'current', KUN_INSTALLER_TRANSACTION: join(state.userData, 'absent.json') }
    expect(await finalizeUpdateTransactionAndCleanup({ environment: current })).toMatchObject({ kind: 'already-finalized' })
    expect(state.spawn).not.toHaveBeenCalled()
  })

  it.each(['success', 'stage'])('reads protected authority through the real default inspector (%s registration)', async (mode) => {
    state.mode = mode
    const record = await pending.readInstallerUpdateTransaction({ oldVersion: '0.1.0', newVersion: '0.2.0', installDir }, { platform: 'win32' })
    expect(record).toMatchObject({ phase: 'committed', recoveryEnvironment: { KUN_INSTALLER_INSTALL_MODE: 'all' } })
    expect(state.spawn).toHaveBeenCalledOnce()
  })
})
