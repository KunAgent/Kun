import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scheduleBoundedUpdateRollback } from './update-transaction-helper'
import { createRollbackCoordinatorProbe, createRollbackGuiParent } from './windows-installer-coordinator-probe.test-utils'
import { readInstallerUpdateTransaction } from './gui-updater-pending'

// The transaction reader is given an explicit recoveryRoot. It must not load
// Electron's binary-installing package entry or depend on a running GUI.
vi.mock('electron', () => ({
  app: { getPath: () => { throw new Error('Unexpected Electron app path in installer transaction test') } }
}))

const windowsOnly = process.platform === 'win32' ? describe : describe.skip
const helper = join(process.cwd(), 'build/windows-installer-migration.ps1')
const roots: Array<{ root: string, artifactDirectory?: string }> = []
const artifactRoot = process.env.KUN_INSTALLER_TEST_ARTIFACT_ROOT
let fixtureIndex = 0

type Fixture = ReturnType<typeof fixture>
type Action = 'StopProcesses' | 'ValidateUpdateRollback' | 'Prepare' | 'SwitchUpdatePayload' | 'ValidateCutover' | 'RollbackUpdateTransaction' | 'Restore' | 'UpdatePath' | 'ValidateHealthResult' | 'CommitUpdateTransaction' | 'FinalizeUpdateTransaction' | 'RecoverUpdateTransaction'

function payload(root: string, executable: string): void {
  mkdirSync(join(root, 'resources', 'app.asar.unpacked', 'kun', 'dist', 'cli'), { recursive: true })
  mkdirSync(join(root, 'resources', 'app.asar.unpacked', 'kun', 'dist', 'manager'), { recursive: true })
  writeFileSync(join(root, executable), 'executable')
  writeFileSync(join(root, 'resources', 'app.asar'), 'asar')
  writeFileSync(join(root, 'resources', 'app.asar.unpacked', 'kun', 'dist', 'cli', 'serve-entry.js'), 'cli')
  writeFileSync(join(root, 'resources', 'app.asar.unpacked', 'kun', 'dist', 'manager', 'manager-entry.js'), 'manager')
}

function fixture(inPlace = false, unicodePath = false) {
  const fixtureName = `fixture-${String(++fixtureIndex).padStart(2, '0')}-${inPlace ? 'in-place' : 'rename'}`
  // Production failpoints deliberately require a real temporary test root.
  // The CI artifact directory is only an output destination, never execution state.
  const root = join(tmpdir(), `kun-installer-migration-smoke-${process.pid}-${fixtureName}${unicodePath ? '-\u4f60\u597d' : ''}`)
  roots.push({ root, artifactDirectory: artifactRoot ? join(artifactRoot, fixtureName) : undefined })
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  const source = join(root, inPlace ? 'Kun' : 'DeepSeek GUI')
  const target = inPlace ? source : join(root, 'Kun')
  const stage = `${target}.kun-stage`
  const recovery = join(root, 'recovery')
  const desktop = join(root, 'desktop')
  const programs = join(root, 'programs')
  mkdirSync(source, { recursive: true })
  mkdirSync(recovery, { recursive: true })
  mkdirSync(desktop, { recursive: true })
  mkdirSync(programs, { recursive: true })
  payload(source, inPlace ? 'Kun.exe' : 'DeepSeek GUI.exe')
  writeFileSync(join(source, 'notes.txt'), 'preserved user file')
  const input = {
    root, source, target, stage, desktop, programs,
    backup: join(recovery, 'payload'),
    journal: join(recovery, 'journal.json'),
    transaction: join(recovery, 'transaction.json'),
    diagnostic: join(recovery, 'diagnostic.log'),
    result: (action: Action) => join(recovery, `result-${action}.txt`),
    health: join(root, 'health.json')
  }
  writeFileSync(join(root, 'fixture-summary.json'), `${JSON.stringify({
    fixture: fixtureName,
    inPlace,
    source,
    target,
    stage,
    recovery
  }, null, 2)}\n`)
  return input
}

function run(input: Fixture, action: Action, fault = '') {
  const powershell = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
  )
  const result = spawnSync(powershell, [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Action', action,
    '-ResultPath', input.result(action)
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KUN_INSTALLER_SOURCE: input.source,
      KUN_INSTALLER_SECONDARY_SOURCE: '',
      KUN_INSTALLER_TARGET: input.target,
      KUN_INSTALLER_STAGE: input.stage,
      KUN_INSTALLER_JOURNAL: input.journal,
      KUN_INSTALLER_TRANSACTION: input.transaction,
      KUN_INSTALLER_PAYLOAD_BACKUP: input.backup,
      KUN_INSTALLER_HEALTH_RESULT: input.health,
      KUN_INSTALLER_DIAGNOSTIC_PATH: input.diagnostic,
      KUN_INSTALLER_AUTOMATIC_UPDATE: '1',
      KUN_INSTALLER_IN_PLACE_UPDATE: input.source === input.target ? '1' : '0',
      KUN_INSTALLER_INSTALL_MODE: 'CurrentUser',
      KUN_INSTALLER_APP_GUID: 'transaction-test-guid',
      KUN_INSTALLER_CANONICAL_LEAF: 'Kun',
      KUN_INSTALLER_APP_EXECUTABLE: 'Kun.exe',
      KUN_INSTALLER_OLD_VERSION: '0.1.0',
      KUN_INSTALLER_NEW_VERSION: '0.2.0',
      KUN_INSTALLER_PRODUCT_NAME: 'Kun',
      KUN_INSTALLER_SELF_PID: String(process.pid),
      KUN_INSTALLER_PRIMARY_SOURCE_STALE: '0',
      KUN_INSTALLER_SECONDARY_SOURCE_STALE: '0',
      KUN_INSTALLER_CURRENT_DESKTOP: input.desktop,
      KUN_INSTALLER_CURRENT_PROGRAMS: input.programs,
      KUN_INSTALLER_COMMON_DESKTOP: input.desktop,
      KUN_INSTALLER_COMMON_PROGRAMS: input.programs,
      KUN_INSTALLER_INSTALL_REGISTRY_KEY: 'Software\\KunInstallerTransactionTest\\Install',
      KUN_INSTALLER_UNINSTALL_REGISTRY_KEY: 'Software\\KunInstallerTransactionTest\\Uninstall',
      KUN_INSTALLER_FAULT_INJECTION: fault ? '1' : '0',
      KUN_INSTALLER_FAULT_POINT: fault
    }
  })
  if (fault) {
    expect(result.stderr, processSummary(result, action)).toContain(`KUN_INSTALLER_FAULT_INJECTION:${fault}`)
  }
  return result
}

function powershell(command: string): ReturnType<typeof spawnSync> {
  return spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8' })
}

function primeCutoverMetadata(input: Fixture): void {
  const quoted = (value: string) => value.replace(/'/g, "''")
  const target = quoted(input.target)
  const executable = quoted(join(input.target, 'Kun.exe'))
  const shortcut = quoted(join(input.desktop, 'Kun.lnk'))
  assertSucceeded(powershell(`
    foreach($name in @('Install','Uninstall')){
      $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\\KunInstallerTransactionTest\\$name",$true)
      $key.SetValue('InstallLocation','${target}',[Microsoft.Win32.RegistryValueKind]::String)
      $key.Dispose()
    }
    $shell=New-Object -ComObject WScript.Shell
    $link=$shell.CreateShortcut('${shortcut}')
    $link.TargetPath='${executable}'
    $link.Save()
  `), 'prime cutover metadata')
}

function processSummary(result: ReturnType<typeof spawnSync>, action: string): string {
  return [
    `Windows migration action: ${action}`,
    `status: ${result.status}`,
    `signal: ${result.signal}`,
    `error: ${String(result.error ?? '')}`,
    `stdout:\n${result.stdout ?? ''}`,
    `stderr:\n${result.stderr ?? ''}`
  ].join('\n')
}

function assertSucceeded(result: ReturnType<typeof spawnSync>, action: string): void {
  expect(result.status, processSummary(result, action)).toBe(0)
  expect(result.signal, processSummary(result, action)).toBeNull()
}

function assertExpectedFailure(result: ReturnType<typeof spawnSync>, action: string): void {
  expect(result.status, processSummary(result, action)).not.toBe(0)
  expect(result.signal, processSummary(result, action)).toBeNull()
}

function transaction(path: string): {
  Phase: string
  RollbackOutcome: string
  InPlace: boolean
  BackupRoot: string
  RecoveryExecutable: string
} {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as {
    Phase: string
    RollbackOutcome: string
    InPlace: boolean
    BackupRoot: string
    RecoveryExecutable: string
  }
}

function captureDiagnostics(root: string, destination: string): void {
  const files = ['fixture-summary.json']
  const recovery = join(root, 'recovery')
  if (existsSync(recovery)) {
    for (const name of readdirSync(recovery)) {
      if (/^(diagnostic\.log|journal\.json|transaction\.json|abc-update\.json|result-[\w-]+\.txt)$/.test(name)) {
        files.push(join('recovery', name))
      }
    }
  }
  rmSync(destination, { recursive: true, force: true })
  for (const name of files) {
    if (!existsSync(join(root, name))) continue
    // The first case uses a GUID-like filename; CI's existing upload glob uses
    // transaction.json, so normalize only the diagnostic copy, not the live state.
    const output = join(destination, name === join('recovery', 'abc-update.json') ? join('recovery', 'transaction.json') : name)
    mkdirSync(dirname(output), { recursive: true })
    copyFileSync(join(root, name), output)
  }
}

afterEach(() => {
  if (process.platform === 'win32') {
    spawnSync('powershell.exe', [
      '-NoProfile', '-Command',
      "Remove-Item -LiteralPath 'HKCU:\\Software\\KunInstallerTransactionTest' -Recurse -Force -ErrorAction SilentlyContinue"
    ])
  }
  while (roots.length > 0) {
    const { root, artifactDirectory } = roots.pop()!
    try {
      if (artifactDirectory) captureDiagnostics(root, artifactDirectory)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

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

  it.each([false, true])('completes Unicode-path rollback after readiness (real GUI parent exit: %s)', async (realParentExit) => {
    const input = fixture(false, true)
    input.transaction = join(input.root, 'recovery', 'abc-update.json')
    // A real executable permits the recovered application's independent launch.
    copyFileSync(process.execPath, join(input.source, 'DeepSeek GUI.exe'))
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
    const probe = createRollbackCoordinatorProbe(input.diagnostic, realParentExit ? gui : undefined)
    try {
      await scheduleBoundedUpdateRollback(helper, {
        ...record!.recoveryEnvironment,
        ...{ KUN_INSTALLER_DIAGNOSTIC_PATH: input.diagnostic }
      }, gui.pid!, probe.launch)
      expect(gui.exitCode).toBeNull()
      expect(transaction(input.transaction).Phase).toBe('payload_switched')
      gui.kill()
      if (realParentExit) {
        await vi.waitFor(() => expect(readFileSync(input.diagnostic, 'utf8')).toContain('COORDINATOR completed'),
          { timeout: 30_000, interval: 100 })
      } else {
        expect(await probe.completion(), probe.output()).toBe(0)
      }
      expect(readFileSync(input.diagnostic, 'utf8')).toContain('COORDINATOR entry')
      expect(existsSync(input.transaction)).toBe(false)
      expect(existsSync(join(input.source, 'DeepSeek GUI.exe'))).toBe(true)
      expect(existsSync(input.target)).toBe(false)
    } catch (error) {
      throw new Error(`${String(error)}\n${await probe.drain()}`, { cause: error })
    } finally {
      gui.kill()
      probe.kill()
      // The recovered Node fixture may open a REPL in its independent console.
      // Stop only this fixture's app roots before afterEach removes its files.
      assertSucceeded(run(input, 'StopProcesses'), 'StopProcesses after rollback smoke')
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
