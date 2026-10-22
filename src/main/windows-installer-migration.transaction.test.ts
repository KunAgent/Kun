import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scheduleBoundedUpdateRollback } from './update-transaction-helper'
import { createRollbackCoordinatorProbe, createRollbackGuiParent } from './windows-installer-coordinator-probe.test-utils'
import { assertGuiExitWaitRace, stopRecoveredProcess, waitForRecoveredProcess } from './windows-installer-process-wait.test-utils'
import { readInstallerUpdateTransaction } from './gui-updater-pending'
import {
  assertExpectedFailure,
  assertSucceeded,
  captureDiagnostics,
  cleanupTransactionFixtures,
  fixture,
  helper,
  payload,
  powershell,
  primeCutoverMetadata,
  run,
  transaction,
  windowsOnly,
  type Action,
  type Fixture
} from './windows-installer-migration.transaction.fixture'

// The transaction reader is given an explicit recoveryRoot. It must not load
// Electron's binary-installing package entry or depend on a running GUI.
vi.mock('electron', () => ({
  app: { getPath: () => { throw new Error('Unexpected Electron app path in installer transaction test') } }
}))

afterEach(cleanupTransactionFixtures)

describe('Windows transaction test diagnostics', () => {
  it('executes beneath OS temp and exports only whitelisted evidence', () => {
    const input = fixture()
    expect(relative(tmpdir(), input.root)).not.toMatch(/^\.\./)
    const recovery = join(input.root, 'recovery')
    writeFileSync(join(recovery, 'abc-update.json'), '{"Phase":"rolled_back"}')
    writeFileSync(join(recovery, 'diagnostic.log'), 'recovered')
    writeFileSync(join(recovery, 'journal.json'), '{}')
    writeFileSync(join(recovery, 'result-Prepare.txt'), '0')
    writeFileSync(join(recovery, 'user-path.clixml'), 'private snapshot')
    const output = join(input.root, 'exported-diagnostics')
    captureDiagnostics(input.root, output)
    expect(readdirSync(output).sort()).toEqual(['fixture-summary.json', 'recovery'])
    expect(readdirSync(join(output, 'recovery')).sort()).toEqual([
      'diagnostic.log', 'journal.json', 'result-Prepare.txt', 'transaction.json'
    ])
    expect(readFileSync(join(output, 'recovery', 'transaction.json'), 'utf8')).toBe('{"Phase":"rolled_back"}')
  })
})

windowsOnly('Windows automatic update transaction', () => {
  it('handles GUI exit between process observation and waiting', assertGuiExitWaitRace, 30_000)

  it('restores from an environment rebuilt from the transaction without a result file', async () => {
    const input = fixture()
    input.transaction = join(input.root, 'recovery', 'abc-update.json')
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    const state = JSON.parse(readFileSync(input.transaction, 'utf8').replace(/^\uFEFF/, ''))
    const canonicalRoot = realpathSync.native(input.root)
    expect(state).toMatchObject({
      AppExecutable: 'Kun.exe', CanonicalLeaf: 'Kun', InstallRegistryKey: 'Software\\KunInstallerTransactionTest\\Install',
      UninstallRegistryKey: 'Software\\KunInstallerTransactionTest\\Uninstall', CurrentDesktop: input.desktop,
      CurrentPrograms: input.programs, StageRoot: join(canonicalRoot, 'Kun.kun-stage'),
      HealthResult: join(canonicalRoot, 'health.json')
    })
    payload(input.stage, 'Kun.exe')
    assertSucceeded(run(input, 'SwitchUpdatePayload'), 'SwitchUpdatePayload')
    const transactionPath = input.transaction
    const rebuilt = await readInstallerUpdateTransaction(
      { oldVersion: '0.1.0', newVersion: '0.2.0' },
      { platform: 'win32', recoveryRoot: join(input.root, 'recovery') }
    )
    expect(rebuilt).not.toBeNull()
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Action', 'RecoverUpdateTransaction'
    ], { encoding: 'utf8', env: {
      SystemRoot: process.env.SystemRoot, Path: process.env.Path, PATHEXT: process.env.PATHEXT,
      ComSpec: process.env.ComSpec, ...rebuilt!.recoveryEnvironment
    } })
    assertSucceeded(result, 'RecoverUpdateTransaction rebuilt from transaction')
    expect(existsSync(join(input.source, 'DeepSeek GUI.exe'))).toBe(true)
    expect(transaction(transactionPath)).toMatchObject({ Phase: 'rolled_back', RollbackOutcome: 'succeeded' })
  }, 180_000)

  it.each([false, false, false, true, true, true])('completes uninstrumented Unicode rollback %# (real GUI parent exit: %s)', async (realParentExit) => {
    const input = fixture(false, true)
    input.transaction = join(input.root, 'recovery', 'abc-update.json')
    // A real executable permits the recovered application's independent launch.
    copyFileSync(process.execPath, join(input.source, 'DeepSeek GUI.exe'))
    const recoveredExecutable = realpathSync.native(join(input.source, 'DeepSeek GUI.exe'))
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    payload(input.stage, 'Kun.exe')
    assertSucceeded(run(input, 'SwitchUpdatePayload'), 'SwitchUpdatePayload')
    const record = await readInstallerUpdateTransaction(
      { oldVersion: '0.1.0', newVersion: '0.2.0' },
      { platform: 'win32', recoveryRoot: join(input.root, 'recovery') }
    )
    expect(record).not.toBeNull()
    const gui = realParentExit ? createRollbackGuiParent() :
      spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    const probe = createRollbackCoordinatorProbe(input.diagnostic, realParentExit ? gui : undefined, false)
    let recoveredPid: number | undefined
    try {
      await scheduleBoundedUpdateRollback(helper, {
        ...record!.recoveryEnvironment,
        ...{ KUN_INSTALLER_DIAGNOSTIC_PATH: input.diagnostic }
      }, gui.pid!, probe.launch)
      expect(gui.exitCode).toBeNull()
      expect(transaction(input.transaction).Phase).toBe('payload_switched')
      gui.kill()
      if (!realParentExit) expect(await probe.completion(), probe.output()).toBe(0)
      recoveredPid = await waitForRecoveredProcess(recoveredExecutable)
      expect(readFileSync(input.diagnostic, 'utf8')).toContain('SUCCESS action=FinalizeUpdateTransaction')
      expect(existsSync(input.transaction)).toBe(false)
      expect(existsSync(join(input.source, 'DeepSeek GUI.exe'))).toBe(true)
      expect(existsSync(input.target)).toBe(false)
    } catch (error) {
      throw new Error(`${String(error)}\n${await probe.drain()}`, { cause: error })
    } finally {
      gui.kill()
      probe.kill()
      stopRecoveredProcess(recoveredExecutable, recoveredPid)
    }
  }, 60_000)

  it('rejects real helper startup failures before acknowledging readiness', async () => {
    const input = fixture()
    input.transaction = join(input.root, 'recovery', 'abc-update.json')
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    const record = await readInstallerUpdateTransaction(
      { oldVersion: '0.1.0', newVersion: '0.2.0' },
      { platform: 'win32', recoveryRoot: join(input.root, 'recovery') }
    )
    expect(record).not.toBeNull()
    const probe = createRollbackCoordinatorProbe(input.diagnostic)
    try {
      await expect(scheduleBoundedUpdateRollback(helper, {
        ...record!.recoveryEnvironment,
        ...{ KUN_INSTALLER_FAULT_INJECTION: '1', KUN_INSTALLER_FAULT_POINT: 'rollback.before_ready',
          KUN_INSTALLER_DIAGNOSTIC_PATH: input.diagnostic }
      }, process.pid, probe.launch)).rejects.toThrow('exited with 1 before readiness')
      await probe.drain()
      expect(readFileSync(input.diagnostic, 'utf8')).toContain('KUN_INSTALLER_FAULT_INJECTION:rollback.before_ready')
      expect(transaction(input.transaction).Phase).toBe('prepared')
      expect(existsSync(join(input.source, 'DeepSeek GUI.exe'))).toBe(true)
    } catch (error) {
      throw new Error(`${String(error)}\n${await probe.drain()}`, { cause: error })
    } finally {
      probe.kill()
    }
  }, 60_000)

  it('rejects readiness when the required in-place payload backup is missing', () => {
    const input = fixture(true)
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    rmSync(transaction(input.transaction).BackupRoot, { recursive: true, force: true })
    assertExpectedFailure(run(input, 'ValidateUpdateRollback'), 'ValidateUpdateRollback')
    expect(transaction(input.transaction).Phase).toBe('prepared')
  })

  it('keeps the legacy payload untouched when staged validation fails', () => {
    const input = fixture()
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    expect(statSync(input.transaction).isFile()).toBe(true)
    expect(statSync(`${input.transaction}.assets`).isDirectory()).toBe(true)
    const state = JSON.parse(readFileSync(input.transaction, 'utf8').replace(/^\uFEFF/, ''))
    expect(state.Shortcuts).toEqual([])
    expect(state.InPlace).toBe(false)
    expect(existsSync(state.BackupRoot)).toBe(false)
    expect(state.RecoveryExecutable).toBe(realpathSync.native(join(input.source, 'DeepSeek GUI.exe')))
    payload(input.stage, 'Kun.exe')
    const switched = run(input, 'SwitchUpdatePayload', 'validate.before_check')
    assertExpectedFailure(switched, 'SwitchUpdatePayload')
    expect(existsSync(join(input.source, 'DeepSeek GUI.exe'))).toBe(true)
    expect(existsSync(input.target)).toBe(false)
    expect(transaction(input.transaction).Phase).toBe('prepared')
  })

  it('rejects a staged candidate whose runtime integrity manifest does not match', () => {
    const input = fixture()
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    payload(input.stage, 'Kun.exe')
    // The manifest claims a runtime package that the staged payload does not
    // contain: exactly the state that produced ERR_MODULE_NOT_FOUND after an
    // update. The legacy install must survive untouched.
    writeFileSync(
      join(input.stage, 'resources', 'kun-runtime-integrity.json'),
      JSON.stringify({
        schemaVersion: 1,
        files: [
          {
            path: 'app.asar.unpacked/kun/dist/cli/serve-entry.js',
            size: 3,
            sha256: '0'.repeat(64)
          }
        ],
        modules: [
          { name: '@earendil-works/pi-tui', dir: 'app.asar.unpacked/kun/node_modules/@earendil-works/pi-tui' }
        ]
      })
    )

    const switched = run(input, 'SwitchUpdatePayload', 'validate.before_check')
    assertExpectedFailure(switched, 'SwitchUpdatePayload')
    expect(existsSync(join(input.source, 'DeepSeek GUI.exe'))).toBe(true)
    expect(readFileSync(join(input.source, 'notes.txt'), 'utf8')).toBe('preserved user file')
    expect(existsSync(input.target)).toBe(false)
    expect(transaction(input.transaction).Phase).toBe('prepared')
  })

  it('removes candidate-only files when it restores the previous payload', () => {
    const input = fixture()
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    payload(input.stage, 'Kun.exe')
    assertSucceeded(run(input, 'SwitchUpdatePayload'), 'SwitchUpdatePayload')
    // Files that exist only in the candidate must not survive the rollback,
    // while the user's own files in the installed directory must.
    writeFileSync(join(input.target, 'candidate-only.txt'), 'candidate')
    writeFileSync(join(input.target, 'notes.txt'), 'candidate overwrote this')

    assertSucceeded(run(input, 'RollbackUpdateTransaction'), 'RollbackUpdateTransaction')

    expect(existsSync(join(input.source, 'candidate-only.txt'))).toBe(false)
    expect(readFileSync(join(input.source, 'notes.txt'), 'utf8')).toBe('preserved user file')
    expect(existsSync(join(input.source, 'DeepSeek GUI.exe'))).toBe(true)
    expect(transaction(input.transaction)).toMatchObject({
      Phase: 'rolled_back',
      RollbackOutcome: 'succeeded'
    })
  })

  it('restores the complete old payload after a post-switch failure', () => {
    const input = fixture()
    writeFileSync(join(input.desktop, 'DeepSeek GUI.lnk'), 'old shortcut bytes')
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    payload(input.stage, 'Kun.exe')
    assertSucceeded(run(input, 'SwitchUpdatePayload'), 'SwitchUpdatePayload')
    writeFileSync(join(input.desktop, 'DeepSeek GUI.lnk'), 'changed shortcut bytes')
    const restoreFailed = run(input, 'Restore', 'restore.after_first_entry')
    assertExpectedFailure(restoreFailed, 'Restore')
    assertSucceeded(run(input, 'RollbackUpdateTransaction'), 'RollbackUpdateTransaction')
    expect(readFileSync(join(input.source, 'notes.txt'), 'utf8')).toBe('preserved user file')
    expect(existsSync(join(input.source, 'DeepSeek GUI.exe'))).toBe(true)
    expect(existsSync(input.target)).toBe(false)
    expect(readFileSync(join(input.desktop, 'DeepSeek GUI.lnk'), 'utf8')).toBe('old shortcut bytes')
    expect(transaction(input.transaction)).toMatchObject({ Phase: 'rolled_back', RollbackOutcome: 'succeeded' })
  })

  it('rejects transaction paths redirected outside the authorized installer roots', () => {
    const input = fixture()
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    const state = JSON.parse(readFileSync(input.transaction, 'utf8').replace(/^\uFEFF/, ''))
    const unrelated = join(input.root, 'unrelated')
    mkdirSync(unrelated)
    writeFileSync(join(unrelated, 'keep.txt'), 'do not delete')
    state.FailedPayloadRoot = unrelated
    writeFileSync(input.transaction, JSON.stringify(state))

    const rollback = run(input, 'RollbackUpdateTransaction')
    assertExpectedFailure(rollback, 'RollbackUpdateTransaction')
    expect(`${rollback.stdout}\n${rollback.stderr}`).toContain('FailedPayloadRoot path is not authorized')
    expect(readFileSync(join(unrelated, 'keep.txt'), 'utf8')).toBe('do not delete')
  })

  it('restores a same-directory payload after cutover failure', () => {
    const input = fixture(true)
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    expect(existsSync(transaction(input.transaction).BackupRoot)).toBe(true)
    payload(input.stage, 'Kun.exe')
    assertSucceeded(run(input, 'SwitchUpdatePayload'), 'SwitchUpdatePayload')
    writeFileSync(join(input.target, 'Kun.exe'), 'candidate')
    assertSucceeded(run(input, 'RollbackUpdateTransaction'), 'RollbackUpdateTransaction')
    expect(readFileSync(join(input.source, 'Kun.exe'), 'utf8')).toBe('executable')
    expect(readFileSync(join(input.source, 'notes.txt'), 'utf8')).toBe('preserved user file')
  })

  it('restores deep Unicode payload bytes through the in-place transaction rollback', () => {
    const input = fixture(true, true)
    const relative = join('resources', 'app.asar.unpacked',
      ...Array.from({ length: 7 }, (_, index) => `dependency ${index} ${'x'.repeat(24)}`), '\u6a21\u5757.bin')
    const oldFile = join(input.source, relative)
    const bytes = Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 256))
    expect(oldFile.length).toBeGreaterThan(260)
    expect(join(input.backup, relative).length).toBeGreaterThan(260)
    mkdirSync(dirname(oldFile), { recursive: true })
    writeFileSync(oldFile, bytes)
    assertSucceeded(run(input, 'Prepare'), 'Prepare long-path backup')
    expect(readFileSync(join(input.backup, relative))).toEqual(bytes)
    payload(input.stage, 'Kun.exe')
    // The rejected candidate is parked under the longer .kun-failed root and must still be removable.
    mkdirSync(dirname(join(input.stage, relative)), { recursive: true })
    writeFileSync(join(input.stage, relative), 'candidate')
    assertSucceeded(run(input, 'SwitchUpdatePayload'), 'SwitchUpdatePayload')
    // Remove the renamed original so success requires copying from BackupRoot.
    rmSync(join(`${input.source}.kun-old-${process.pid}`, relative))
    assertSucceeded(run(input, 'RollbackUpdateTransaction'), 'RollbackUpdateTransaction long paths')
    expect(existsSync(`${input.target}.kun-failed`)).toBe(false)
    expect(readFileSync(oldFile)).toEqual(bytes)
    expect(transaction(input.transaction)).toMatchObject({ Phase: 'rolled_back', RollbackOutcome: 'succeeded' })
    assertSucceeded(run(input, 'FinalizeUpdateTransaction'), 'FinalizeUpdateTransaction long paths')
    expect(existsSync(input.backup)).toBe(false)
    expect(readFileSync(oldFile)).toEqual(bytes)
  }, 120_000)

  it('rolls back cleanup_pending after the candidate later fails its first full startup', () => {
    const input = fixture()
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    payload(input.stage, 'Kun.exe')
    assertSucceeded(run(input, 'SwitchUpdatePayload'), 'SwitchUpdatePayload')
    const state = JSON.parse(readFileSync(input.transaction, 'utf8').replace(/^\uFEFF/, ''))
    state.Phase = 'awaiting_health'
    writeFileSync(input.transaction, JSON.stringify(state))
    writeFileSync(input.health, JSON.stringify({
      ok: true,
      token: state.HealthToken,
      installDir: input.target,
      version: '0.2.0'
    }))
    assertSucceeded(run(input, 'CommitUpdateTransaction'), 'CommitUpdateTransaction')
    expect(transaction(input.transaction).Phase).toBe('committed')
    expect(existsSync(input.transaction)).toBe(true)
    expect(existsSync(state.BackupRoot)).toBe(false)
    expect(existsSync(join(input.source, 'DeepSeek GUI.exe'))).toBe(true)

    assertSucceeded(run(input, 'RecoverUpdateTransaction'), 'RecoverUpdateTransaction')
    expect(readFileSync(join(input.source, 'DeepSeek GUI.exe'), 'utf8')).toBe('executable')
    expect(existsSync(input.target)).toBe(false)
    expect(transaction(input.transaction)).toMatchObject({ Phase: 'rolled_back', RollbackOutcome: 'succeeded' })
    assertSucceeded(run(input, 'FinalizeUpdateTransaction'), 'FinalizeUpdateTransaction')
    expect(existsSync(join(input.source, 'DeepSeek GUI.exe'))).toBe(true)
  })

  it.each(['finalize.after_phase', 'finalize.after_first_cleanup', 'finalize.before_transaction_removal'])(
    'resumes interrupted finalization without losing the transaction: %s', (fault) => {
    const input = fixture()
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    payload(input.stage, 'Kun.exe')
    assertSucceeded(run(input, 'SwitchUpdatePayload'), 'SwitchUpdatePayload')
    assertSucceeded(run(input, 'Restore'), 'Restore')
    const state = JSON.parse(readFileSync(input.transaction, 'utf8').replace(/^\uFEFF/, ''))
    state.Phase = 'awaiting_health'
    writeFileSync(input.transaction, JSON.stringify(state))
    writeFileSync(input.health, JSON.stringify({
      ok: true,
      token: state.HealthToken,
      installDir: input.target,
      version: '0.2.0'
    }))

    assertSucceeded(run(input, 'CommitUpdateTransaction'), 'CommitUpdateTransaction')
    expect(existsSync(join(input.source, 'DeepSeek GUI.exe'))).toBe(true)
    assertExpectedFailure(
      run(input, 'FinalizeUpdateTransaction', fault),
      'FinalizeUpdateTransaction'
    )
    expect(transaction(input.transaction).Phase).toBe('finalizing')
    expect(readFileSync(join(input.source, 'notes.txt'), 'utf8')).toBe('preserved user file')
    assertSucceeded(run(input, 'RecoverUpdateTransaction'), 'RecoverUpdateTransaction')
    expect(existsSync(input.transaction)).toBe(false)
    expect(existsSync(join(input.source, 'DeepSeek GUI.exe'))).toBe(false)
    expect(readFileSync(join(input.source, 'notes.txt'), 'utf8')).toBe('preserved user file')
    expect(existsSync(join(input.target, 'Kun.exe'))).toBe(true)
  })

  it('rejects a health result from the wrong candidate version', () => {
    const input = fixture()
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    payload(input.stage, 'Kun.exe')
    assertSucceeded(run(input, 'SwitchUpdatePayload'), 'SwitchUpdatePayload')
    const state = JSON.parse(readFileSync(input.transaction, 'utf8').replace(/^\uFEFF/, ''))
    state.Phase = 'awaiting_health'
    writeFileSync(input.transaction, JSON.stringify(state))
    writeFileSync(input.health, JSON.stringify({
      ok: true,
      token: state.HealthToken,
      installDir: input.target,
      version: '9.9.9'
    }))
    assertExpectedFailure(run(input, 'ValidateHealthResult'), 'ValidateHealthResult')
    assertSucceeded(run(input, 'RollbackUpdateTransaction'), 'RollbackUpdateTransaction')
    expect(existsSync(join(input.source, 'DeepSeek GUI.exe'))).toBe(true)
  })

  it('records the candidate health failure before rollback removes the result', () => {
    const input = fixture()
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    payload(input.stage, 'Kun.exe')
    assertSucceeded(run(input, 'SwitchUpdatePayload'), 'SwitchUpdatePayload')
    const state = JSON.parse(readFileSync(input.transaction, 'utf8').replace(/^\uFEFF/, ''))
    state.Phase = 'awaiting_health'
    writeFileSync(input.transaction, JSON.stringify(state))
    writeFileSync(input.health, JSON.stringify({
      ok: false,
      token: state.HealthToken,
      installDir: input.target,
      version: '0.2.0',
      message: 'runtime adapter failed\r\nto load'
    }))

    const result = run(input, 'ValidateHealthResult')
    assertExpectedFailure(result, 'ValidateHealthResult')
    expect(String(result.stderr ?? '')).toContain('runtime adapter failed to load')
    expect(readFileSync(input.diagnostic, 'utf8')).toContain(
      'HEALTH_RESULT ok=False version=0.2.0 message=runtime adapter failed to load'
    )
  })

  it('round-trips a typed REG_MULTI_SZ user PATH snapshot', () => {
    const input = fixture()
    const saved = join(input.root, 'path-before.clixml')
    const save = powershell(`
      $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment',$false)
      $exists=$null -ne $key -and $key.GetValueNames() -contains 'Path'
      $kind=if($exists){[string]$key.GetValueKind('Path')}else{''}
      $value=if($exists){$key.GetValue('Path',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}else{$null}
      [pscustomobject]@{Exists=$exists;Kind=$kind;Value=$value}|Export-Clixml -LiteralPath '${saved.replace(/'/g, "''")}'
      $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment',$true)
      $key.SetValue('Path',[string[]]@('typed-one','typed-two'),[Microsoft.Win32.RegistryValueKind]::MultiString)
      $key.Dispose()
    `)
    assertSucceeded(save, 'save typed PATH fixture')
    try {
      assertSucceeded(run(input, 'Prepare'), 'Prepare')
      const mutatePath = powershell(`
        $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment',$true)
        $key.SetValue('Path','changed',[Microsoft.Win32.RegistryValueKind]::String)
        $key.Dispose()
      `)
      assertSucceeded(mutatePath, 'mutate typed PATH fixture')
      assertSucceeded(run(input, 'RollbackUpdateTransaction'), 'RollbackUpdateTransaction')
      const restored = powershell(`
        $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment',$false)
        [Console]::WriteLine([string]$key.GetValueKind('Path'))
        [Console]::Write(($key.GetValue('Path') -join '|'))
      `)
      assertSucceeded(restored, 'inspect restored typed PATH')
      expect(String(restored.stdout).replace(/\r\n/g, '\n').trim()).toBe('MultiString\ntyped-one|typed-two')
    } finally {
      powershell(`
        $saved=Import-Clixml -LiteralPath '${saved.replace(/'/g, "''")}'
        $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment',$true)
        if(-not $saved.Exists){$key.DeleteValue('Path',$false)}else{
          $kind=[Microsoft.Win32.RegistryValueKind]([Enum]::Parse([Microsoft.Win32.RegistryValueKind],[string]$saved.Kind))
          $key.SetValue('Path',$saved.Value,$kind)
        }
        $key.Dispose()
      `)
    }
  })

  it('restores the exact user PATH after path.after_write fails', () => {
    const input = fixture()
    const originalPath = spawnSync('powershell.exe', [
      '-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('Path','User')"
    ], { encoding: 'utf8' }).stdout.trim()
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    payload(input.stage, 'Kun.exe')
    assertSucceeded(run(input, 'SwitchUpdatePayload'), 'SwitchUpdatePayload')
    try {
      assertExpectedFailure(run(input, 'UpdatePath', 'path.after_write'), 'UpdatePath')
    } finally {
      // Even an unexpected injection/marker failure must restore the real user PATH.
      assertSucceeded(run(input, 'RollbackUpdateTransaction'), 'RollbackUpdateTransaction')
    }
    const current = spawnSync('powershell.exe', [
      '-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('Path','User')"
    ], { encoding: 'utf8' }).stdout.trim()
    expect(current).toBe(originalPath.trim())
    expect(existsSync(join(input.source, 'DeepSeek GUI.exe'))).toBe(true)
  }, 120_000)
})

windowsOnly('Windows automatic update fault injection points', () => {
  function readTransaction(input: Fixture): Record<string, unknown> {
    return JSON.parse(readFileSync(input.transaction, 'utf8').replace(/^\uFEFF/, ''))
  }

  it('persists the complete recovery context before any payload move (prepare.after_journal)', () => {
    const input = fixture()
    const failed = run(input, 'Prepare', 'prepare.after_journal')
    assertExpectedFailure(failed, 'Prepare')
    const state = readTransaction(input)
    expect(state.Phase).toBe('prepared')
    expect(state.JournalPath).toBe(join(realpathSync.native(join(input.root, 'recovery')), 'journal.json'))
    expect(state.OldVersion).toBe('0.1.0')
    expect(state.NewVersion).toBe('0.2.0')
    expect(String(state.Target)).toContain('Kun')
    expect(String(state.AppExecutable)).toBe('Kun.exe')
    // The transaction is already a complete rollback record before the cutover.
    payload(input.stage, 'Kun.exe')
    assertSucceeded(run(input, 'RollbackUpdateTransaction'), 'RollbackUpdateTransaction')
    expect(existsSync(join(input.source, 'DeepSeek GUI.exe'))).toBe(true)
  })

  it('restores the old payload when interrupted mid-move (switch.after_old_move)', () => {
    const input = fixture(true)
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    payload(input.stage, 'Kun.exe')
    const failed = run(input, 'SwitchUpdatePayload', 'switch.after_old_move')
    assertExpectedFailure(failed, 'SwitchUpdatePayload')
    const state = readTransaction(input)
    expect(state.Phase).toBe('prepared')
    assertSucceeded(run(input, 'RecoverUpdateTransaction'), 'RecoverUpdateTransaction')
    expect(readFileSync(join(input.source, 'notes.txt'), 'utf8')).toBe('preserved user file')
    expect(existsSync(join(input.source, 'Kun.exe'))).toBe(true)
  })

  it('rolls back a payload that switched but never validated cutover (switch.after_payload_switched)', () => {
    const input = fixture()
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    payload(input.stage, 'Kun.exe')
    const failed = run(input, 'SwitchUpdatePayload', 'switch.after_payload_switched')
    assertExpectedFailure(failed, 'SwitchUpdatePayload')
    expect(readTransaction(input).Phase).toBe('payload_switched')
    assertSucceeded(run(input, 'RecoverUpdateTransaction'), 'RecoverUpdateTransaction')
    expect(readFileSync(join(input.source, 'DeepSeek GUI.exe'), 'utf8')).toBe('executable')
    expect(existsSync(input.target)).toBe(false)
  })

  describe('awaiting-health recovery', () => {
    let input: Fixture
    // OS fixture setup has its own bounded clock. The recovery assertion keeps
    // the existing 15s deadline instead of spending it on PowerShell/COM startup.
    beforeEach(() => {
      input = fixture()
      assertSucceeded(run(input, 'Prepare'), 'Prepare')
      payload(input.stage, 'Kun.exe')
      assertSucceeded(run(input, 'SwitchUpdatePayload'), 'SwitchUpdatePayload')
    }, 15_000)
    beforeEach(() => primeCutoverMetadata(input), 15_000)

    it('keeps the transaction rollback-capable after awaiting_health (cutover.after_awaiting_health)', () => {
      const failed = run(input, 'ValidateCutover', 'cutover.after_awaiting_health')
      assertExpectedFailure(failed, 'ValidateCutover')
      expect(readTransaction(input).Phase).toBe('awaiting_health')
      assertSucceeded(run(input, 'RecoverUpdateTransaction'), 'RecoverUpdateTransaction')
      expect(readTransaction(input)).toMatchObject({ Phase: 'rolled_back', RollbackOutcome: 'succeeded' })
    }, 15_000)
  })

  it('rolls back a transaction interrupted right before commit (commit.before_committed)', () => {
    const input = fixture()
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    payload(input.stage, 'Kun.exe')
    assertSucceeded(run(input, 'SwitchUpdatePayload'), 'SwitchUpdatePayload')
    assertSucceeded(run(input, 'Restore'), 'Restore')
    const state = readTransaction(input)
    state.Phase = 'awaiting_health'
    writeFileSync(input.transaction, JSON.stringify(state))
    writeFileSync(input.health, JSON.stringify({
      ok: true, token: state.HealthToken, installDir: input.target, version: '0.2.0'
    }))
    const failed = run(input, 'CommitUpdateTransaction', 'commit.before_committed')
    assertExpectedFailure(failed, 'CommitUpdateTransaction')
    expect(readTransaction(input).Phase).toBe('cleanup_pending')
    assertSucceeded(run(input, 'RecoverUpdateTransaction'), 'RecoverUpdateTransaction')
    expect(readTransaction(input)).toMatchObject({ Phase: 'rolled_back', RollbackOutcome: 'succeeded' })
  })
})
