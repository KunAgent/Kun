import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { UUID } from 'builder-util-runtime'

const state = vi.hoisted(() => ({ userData: '', appPath: '', executable: '', commonData: '', trusted: true, registrations: [] as Array<{ scope: string; installDir: string }> }))
vi.mock('electron', () => ({ app: {
  getPath: (name: string) => name === 'exe' ? state.executable : state.userData,
  getAppPath: () => state.appPath, getVersion: () => '0.2.0'
} }))
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: vi.fn((_exe: string, args: string[], _options: unknown,
  callback: (error: Error | null, stdout: string, stderr: string) => void) => {
  const script = Buffer.from(args.at(-1)!, 'base64').toString('utf16le')
  callback(null, script.includes('OpenBaseKey') ? JSON.stringify(state.registrations) :
    script.includes("GetFolderPath('CommonApplicationData')") ? state.commonData : state.trusted ? 'OK' : '', '')
}) }))
vi.mock('./relaunch-app', () => ({ relaunchApp: vi.fn() }))
vi.mock('./update-transaction-helper', () => ({ scheduleUpdateRollbackAfterExit: vi.fn(),
  finalizeUpdateTransactionAndCleanup: vi.fn(), runUpdateTransactionHelper: vi.fn() }))
vi.mock('./gui-updater-support', () => ({ setWindowsInstallerUpdateSource: vi.fn() }))
vi.mock('./logger', () => ({ logInfo: vi.fn() }))

import * as pending from './gui-updater-pending'
import { recoverUpdateBeforeRuntimeStart } from './update-bootstrap-recovery'
import { installerAppGuid, recoveryPathApi } from './installer-recovery-identity'

let directory = ''
let currentRoot = ''
let commonRoot = ''
let installDir = ''
const guid = installerAppGuid('com.xingyuzhong.deepseekgui')

function transaction(root: string, scope: 'all' | 'current') {
  return {
    SchemaVersion: 4, Phase: 'awaiting_health', OldVersion: '0.1.0', NewVersion: '0.2.0',
    AppGuid: guid, AppExecutable: 'Kun.exe', CanonicalLeaf: 'Kun', ProductName: 'Kun',
    InstallMode: scope, AutomaticUpdate: '1', Shortcuts: [], Source: installDir, Target: installDir,
    StageRoot: `${installDir}.kun-stage-123`, BackupRoot: join(root, 'update-backup-123'),
    JournalPath: join(root, `${guid}.json`), TransactionPath: join(root, `${guid}-update.json`),
    InstallRegistryKey: `Software\\${guid}`,
    UninstallRegistryKey: `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}`
  }
}

async function save(root: string, scope: 'all' | 'current', patch: Record<string, unknown> = {}) {
  const record = { ...transaction(root, scope), ...patch }
  await writeFile(join(root, `${guid}-update.json`), `\uFEFF${JSON.stringify(record)}`)
  return record
}

function bootstrapDeps() {
  return { platform: 'win32' as const, version: () => '0.2.0', scheduleRollback: vi.fn(async () => undefined),
    relaunch: vi.fn(), exit: vi.fn(), installerIsAlive: () => false }
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'kun-recovery-discovery-'))
  state.userData = join(directory, 'Roaming', 'Kun')
  state.commonData = join(directory, 'ProgramData')
  state.appPath = join(directory, 'resources', 'app')
  installDir = join(directory, 'Programs', 'Kun')
  state.executable = join(installDir, 'Kun.exe')
  state.trusted = true
  state.registrations = [{ scope: 'all', installDir }]
  currentRoot = join(directory, 'Roaming', 'KunInstallerRecovery')
  commonRoot = join(state.commonData, 'KunInstallerRecovery')
  await Promise.all([state.userData, state.appPath, installDir, currentRoot, commonRoot].map((path) => mkdir(path, { recursive: true })))
  await writeFile(join(state.appPath, 'package.json'), JSON.stringify({ kunAppFlavor: 'production' }))
  await pending.writePendingUpdate({ oldVersion: '0.1.0', newVersion: '0.2.0', installDir,
    installerPath: join(directory, 'update.exe'), channel: 'stable' })
})

afterEach(async () => { vi.clearAllMocks(); await rm(directory, { recursive: true, force: true }) })

describe('installer recovery discovery through real files and bootstrap', () => {
  it('uses the same GUID derivation as electron-builder and preserves native/Windows path semantics', () => {
    expect(guid).toBe(UUID.v5('com.xingyuzhong.deepseekgui', UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3')))
    expect(recoveryPathApi('C:\\Users\\test\\Roaming').join('C:\\Users\\test\\Roaming', 'Kun')).toBe(win32.join('C:\\Users\\test\\Roaming', 'Kun'))
    expect(recoveryPathApi(directory).join(directory, 'Kun')).toBe(join(directory, 'Kun'))
  })

  it.each(['all', 'current'] as const)('bootstraps a %s transaction without a GUI result and retains rollback environment', async (scope) => {
    state.registrations = [{ scope, installDir }]
    const root = scope === 'all' ? commonRoot : currentRoot
    const record = await save(root, scope)
    const deps = bootstrapDeps()
    await expect(pending.readPendingUpdateResult()).resolves.toBeNull()
    await expect(recoverUpdateBeforeRuntimeStart(deps)).resolves.toBe(false)
    const recovery = await pending.readGuiUpdateRecovery()
    expect(recovery).toMatchObject({ bootAttempts: 1, healthAttempts: 0, installedVersion: '0.2.0',
      recoveryEnvironment: { KUN_INSTALLER_APP_GUID: guid, KUN_INSTALLER_INSTALL_MODE: scope,
        KUN_INSTALLER_TRANSACTION: record.TransactionPath, KUN_INSTALLER_JOURNAL: record.JournalPath,
        KUN_INSTALLER_TARGET: installDir } })
    await recoverUpdateBeforeRuntimeStart(deps)
    await expect(recoverUpdateBeforeRuntimeStart(deps)).resolves.toBe(true)
    expect(deps.scheduleRollback).toHaveBeenCalledWith(recovery!.recoveryEnvironment)
    expect(deps.exit).toHaveBeenCalledWith(0)
  })

  it.each([
    { AppGuid: 'another-guid' }, { Source: '/another/install' }, { Target: '/another/install' },
    { OldVersion: '0.0.1' }, { NewVersion: '0.3.0' }, { InstallMode: 'current' },
    { AppExecutable: 'Other.exe' }, { JournalPath: '/another/journal.json' },
    { StageRoot: '/another/stage' }, { BackupRoot: '/another/backup' }
  ])('rejects a mismatched public transaction %j', async (patch) => {
    await save(commonRoot, 'all', patch)
    await recoverUpdateBeforeRuntimeStart(bootstrapDeps())
    await expect(pending.readGuiUpdateRecovery()).resolves.toBeNull()
  })

  it('rejects conflicting scope candidates instead of taking the first directory entry', async () => {
    state.registrations = [{ scope: 'all', installDir }, { scope: 'current', installDir }]
    await save(currentRoot, 'current')
    await save(commonRoot, 'all')
    await expect(pending.readInstallerUpdateTransaction({ oldVersion: '0.1.0', newVersion: '0.2.0', installDir }, { platform: 'win32' })).resolves.toBeNull()
    await recoverUpdateBeforeRuntimeStart(bootstrapDeps())
    await expect(pending.readGuiUpdateRecovery()).resolves.toBeNull()
  })

  it('rejects a forged current-user record for the registered all-users installation', async () => {
    await save(currentRoot, 'current')
    await recoverUpdateBeforeRuntimeStart(bootstrapDeps())
    await expect(pending.readGuiUpdateRecovery()).resolves.toBeNull()
  })

  it('rejects an untrusted public record that another user could replace', async () => {
    await save(commonRoot, 'all')
    state.trusted = false
    await recoverUpdateBeforeRuntimeStart(bootstrapDeps())
    await expect(pending.readGuiUpdateRecovery()).resolves.toBeNull()
  })

  it('keeps the real installer blocked when no on-disk rollback record exists', async () => {
    const { GuiUpdateInstaller } = await import('./gui-updater-install')
    const emit = vi.fn()
    const installer = new GuiUpdateInstaller({ runExclusive: async (task) => task(),
      details: () => ({ hasDownloaded: true, targetVersion: '0.3.0', channel: 'stable' }),
      stateInfo: () => undefined, emit, preflight: vi.fn(), prepare: vi.fn(), clearPreparation: vi.fn(),
      setQuitting: vi.fn(), quitAndInstall: vi.fn(), isSessionEnding: () => false })
    const warning = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await installer.reconcile()
      await expect(installer.install()).resolves.toMatchObject({ ok: false,
        message: 'A previous update left an unresolved transaction. Reinstall Kun before updating again.' })
      expect(emit).toHaveBeenCalled()
      await expect(pending.readGuiUpdateRecovery()).resolves.toBeNull()
    } finally { warning.mockRestore() }
  })

  it('keeps missing-rollback-context pending instead of manufacturing a recovery', async () => {
    const deps = bootstrapDeps()
    await expect(recoverUpdateBeforeRuntimeStart(deps)).resolves.toBe(false)
    await expect(pending.readGuiUpdateRecovery()).resolves.toBeNull()
    await expect(pending.readPendingUpdate()).resolves.toMatchObject({ installDir })
    expect(deps.scheduleRollback).not.toHaveBeenCalled()
  })
})
