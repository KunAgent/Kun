import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertExpectedFailure, assertSucceeded, captureDiagnostics, cleanupTransactionFixtures, fixture,
  payload, powershell, primeCutoverMetadata, run, windowsOnly, type Fixture
} from './windows-installer-migration.transaction.fixture'

// Model a real NSIS retry, not the GUI rollback coordinator: the latter already
// rebuilds its environment from the transaction and intentionally retains it.
const originalPid = String(process.pid)
function installerFixture(inPlace = true): Fixture {
  const input = fixture(inPlace)
  input.transaction = join(dirname(input.journal), 'transaction-test-guid-update.json')
  input.journal = join(dirname(input.journal), 'transaction-test-guid.json')
  input.stage = `${input.target}.kun-stage-${originalPid}`
  input.backup = join(dirname(input.journal), `update-backup-${originalPid}`)
  input.health = join(input.root, 'pending-update-result.json.health.json')
  return input
}
function restartedEnvironment(input: Fixture): NodeJS.ProcessEnv {
  return {
    KUN_INSTALLER_SELF_PID: String(process.pid + 10000),
    KUN_INSTALLER_STAGE: '',
    KUN_INSTALLER_PAYLOAD_BACKUP: '',
    KUN_INSTALLER_HEALTH_RESULT: '',
    KUN_INSTALLER_UPDATE_SOURCE: input.source,
    KUN_PENDING_UPDATE_RESULT: input.health.slice(0, -'.health.json'.length)
  }
}
function readTransaction(input: Fixture): Record<string, unknown> {
  return JSON.parse(readFileSync(input.transaction, 'utf8').replace(/^\uFEFF/, ''))
}

afterEach(cleanupTransactionFixtures)

describe('Installer restart recovery source contract', () => {
  it('exports only the known restart journal names under the existing CI evidence names', () => {
    const input = installerFixture()
    mkdirSync(dirname(input.journal), { recursive: true })
    writeFileSync(input.journal, '{"Phase":"preserved"}')
    writeFileSync(input.transaction, '{"Phase":"prepared"}')
    writeFileSync(join(dirname(input.journal), 'private-settings.json'), '{}')
    const output = join(input.root, 'exported')
    captureDiagnostics(input.root, output)
    expect(readdirSync(join(output, 'recovery')).sort()).toEqual(['journal.json', 'transaction.json'])
    expect(readFileSync(join(output, 'recovery', 'transaction.json'), 'utf8')).toContain('prepared')
  })

  it('authenticates the stored transaction before adopting only dynamic paths', () => {
    const transaction = readFileSync(join(process.cwd(), 'build/windows-installer-migration-transaction.ps1'), 'utf8').replace(/\r\n/g, '\n')
    const trustedReader = transaction.slice(transaction.indexOf('function Read-TrustedUpdateTransaction'), transaction.indexOf('function Read-UpdateTransaction'))
    expect(trustedReader.indexOf('Assert-UpdateTransactionStorage')).toBeLessThan(trustedReader.indexOf('Get-Content'))
    expect(trustedReader).toContain('[int]$transaction.SchemaVersion -ne 4')
    expect(trustedReader).toContain('(Get-JournalAppGuid)')
    expect(trustedReader).toContain('(Get-NormalizedInstallMode)')
    expect(transaction).toContain('if ($null -ne $transaction) { Assert-UpdateTransactionPaths $transaction }')
    const recovery = readFileSync(join(process.cwd(), 'build/windows-installer-migration-recovery-env.ps1'), 'utf8').replace(/\r\n/g, '\n')
    const restart = recovery.slice(recovery.indexOf('function Recover-InstallerUpdateTransaction'), recovery.indexOf('# Scope selection'))
    expect(restart.indexOf('Read-TrustedUpdateTransaction')).toBeLessThan(restart.indexOf('Get-InstallerRestartRecoveryEnvironment'))
    expect(restart.indexOf('Get-InstallerRestartRecoveryEnvironment')).toBeLessThan(restart.indexOf('SetEnvironmentVariable'))
    expect(restart.indexOf('Recover-PendingUpdateTransaction')).toBeLessThan(restart.indexOf('Finalize-TerminalUpdateTransaction'))
    expect(restart).toContain('} finally {')
    expect(restart).toContain('$previous[$name]')
    const scopeProbe = recovery.slice(recovery.indexOf('function Test-InterruptedUpdateScopeRegistration'), recovery.indexOf('# Readiness'))
    expect(scopeProbe.indexOf('Test-JournalAclSecure')).toBeLessThan(scopeProbe.indexOf('Get-Content'))
    expect(scopeProbe).toContain('Assert-NoReparsePathComponents')
    expect(scopeProbe).toContain('Assert-UpdateTransactionPaths $transaction')
    expect(scopeProbe).not.toContain('Assert-UpdateTransactionStorage')
    expect(scopeProbe).not.toContain('Set-SecureJournal')
    expect(scopeProbe).not.toContain('Move-UntrustedJournalToQuarantine')
    const environment = recovery.slice(recovery.indexOf('  return @{', recovery.indexOf('function Get-InstallerRestartRecoveryEnvironment')), recovery.indexOf('function Recover-InstallerUpdateTransaction'))
    expect([...environment.matchAll(/(KUN_INSTALLER_\w+) =/g)].map((match) => match[1]).sort()).toEqual([
      'KUN_INSTALLER_HEALTH_RESULT', 'KUN_INSTALLER_PAYLOAD_BACKUP', 'KUN_INSTALLER_SOURCE', 'KUN_INSTALLER_STAGE', 'KUN_INSTALLER_TARGET'
    ])
  })

  it('keeps the GUI recovery entry point strict and dispatches installer restart separately', () => {
    const script = readFileSync(join(process.cwd(), 'build/windows-installer-migration.ps1'), 'utf8').replace(/\r\n/g, '\n')
    expect(script).toContain("'RecoverUpdateTransaction' {\n      Recover-PendingUpdateTransaction")
    expect(script).toContain("'RecoverInstallerUpdateTransaction' {\n      Recover-InstallerUpdateTransaction")
    const installer = readFileSync(join(process.cwd(), 'build/installer-automatic-update.nsh'), 'utf8').replace(/\r\n/g, '\n')
    const recover = installer.slice(installer.indexOf('Function KunRecoverInterruptedAutomaticUpdate'), installer.indexOf('Function KunRunAutomaticUpdateHealthCheck'))
    expect(recover.indexOf('Call KunSetMigrationEnvironment')).toBeLessThan(recover.indexOf('kunRunMigrationHelper RecoverInstallerUpdateTransaction'))
  })
})

windowsOnly('Installer restart recovery bootstrap', () => {
  it('preserves a locked original payload and prepares successfully after natural lock release (helper only)', async () => {
    const input = installerFixture()
    const asar = join(input.source, 'resources', 'app.asar')
    const original = readFileSync(asar)
    // The locker lives outside the install root. Its command line contains no
    // install-root path, so Stop-AppProcesses must not classify it as the app.
    const command = [
      '$ErrorActionPreference = "Stop"',
      `Add-Type -TypeDefinition 'public static class KunFixtureLockRelease { public static void Wait() { var ready = new System.Threading.ManualResetEvent(false); var input = new System.Threading.Thread(() => { System.Console.ReadLine(); ready.Set(); }); input.IsBackground = true; input.Start(); ready.WaitOne(90000); } }'`,
      '$stream = [IO.File]::Open($env:KUN_TEST_LOCK_FILE, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)',
      'try { [Console]::Out.WriteLine("READY"); [Console]::Out.Flush(); [KunFixtureLockRelease]::Wait() } finally { $stream.Dispose() }'
    ].join('; ')
    const locker = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', command], {
        env: { ...process.env, KUN_TEST_LOCK_FILE: asar }, stdio: ['pipe', 'pipe', 'pipe']
      })
    let output = ''
    let errorOutput = ''
    locker.stdout.on('data', (chunk) => { output += String(chunk) })
    locker.stderr.on('data', (chunk) => { errorOutput += String(chunk) })
    // EPIPE is harmless if the locker's own bounded wait has already ended.
    locker.stdin.on('error', () => undefined)
    const exited = new Promise<number | null>((resolve, reject) => {
      locker.once('exit', resolve)
      locker.once('error', reject)
    })
    void exited.catch(() => undefined)
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { clearInterval(poll); reject(new Error(`Locker readiness timed out: ${errorOutput}`)) }, 15_000)
        const poll = setInterval(() => {
          if (output.includes('READY')) { clearTimeout(timeout); clearInterval(poll); resolve() }
          else if (locker.exitCode !== null) { clearTimeout(timeout); clearInterval(poll); reject(new Error(`Locker exited before ready: ${errorOutput}`)) }
        }, 25)
        timeout.unref()
        // The ready wait is bounded even when spawning the locker fails.
        void exited.catch((error) => { clearTimeout(timeout); clearInterval(poll); reject(error) })
      })
      expect(locker.exitCode).toBeNull()
      const failed = run(input, 'Prepare', '', {}, true)
      assertExpectedFailure(failed, 'Prepare while another process holds an exclusive payload lock')
      expect(failed.status).not.toBe(124)
      expect(`${failed.stdout}\n${failed.stderr}`).toContain('Cannot copy payload')
      // Deliver queued process-exit events after the synchronous helper call.
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(locker.exitCode).toBeNull()
      expect(locker.signalCode).toBeNull()
      expect(existsSync(input.transaction)).toBe(false)
      expect(existsSync(input.stage)).toBe(false)
      expect(readFileSync(join(input.source, 'notes.txt'), 'utf8')).toBe('preserved user file')
    } finally {
      locker.stdin.end('\n')
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Locker did not exit naturally after release: ${errorOutput}`)), 15_000)
        void exited.then((code) => { clearTimeout(timeout); resolve(code) }, (error) => { clearTimeout(timeout); reject(error) })
      })
      expect(exitCode, errorOutput).toBe(0)
    }
    expect(readFileSync(asar)).toEqual(original)
    assertSucceeded(run(input, 'Prepare', '', {}, true), 'Prepare after exclusive lock release')
  }, 360_000)

  it.each([true, false])('recovers a prepared transaction with a new PID and no health file (in-place: %s)', (inPlace) => {
    const input = installerFixture(inPlace)
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    payload(input.stage, 'Kun.exe')
    expect(existsSync(input.health)).toBe(false)
    const before = readFileSync(input.transaction, 'utf8')
    const environment = restartedEnvironment(input)
    // This unchanged strict entry point demonstrates the old startup mismatch.
    const rejected = run(input, 'RecoverUpdateTransaction', '', environment)
    assertExpectedFailure(rejected, 'strict recovery with a fresh installer environment')
    expect(`${rejected.stdout}\n${rejected.stderr}`).toMatch(/path is not authorized/)
    expect(readFileSync(input.transaction, 'utf8')).toBe(before)

    assertSucceeded(run(input, 'RecoverInstallerUpdateTransaction', '', environment), 'installer restart recovery')
    expect(existsSync(input.transaction)).toBe(false)
    expect(existsSync(input.journal)).toBe(false)
    expect(existsSync(input.backup)).toBe(false)
    expect(existsSync(input.stage)).toBe(false)
    expect(readFileSync(join(input.source, 'notes.txt'), 'utf8')).toBe('preserved user file')
    expect(existsSync(join(input.source, inPlace ? 'Kun.exe' : 'DeepSeek GUI.exe'))).toBe(true)
    // Recovery must remove the old PID's terminal record before fresh Prepare.
    const next = { ...input, stage: `${input.target}.kun-stage-${process.pid + 10000}`,
      backup: join(dirname(input.journal), `update-backup-${process.pid + 10000}`) }
    assertSucceeded(run(next, 'Prepare', '', { KUN_INSTALLER_SELF_PID: String(process.pid + 10000) }), 'Prepare after recovered restart')
  }, 120_000)

  it('preserves a legitimately active stage-named installation during a later update recovery', () => {
    const input = installerFixture()
    const activeSource = `${input.source}.kun-stage-777`
    renameSync(input.source, activeSource)
    input.source = activeSource
    input.target = activeSource
    input.stage = `${activeSource}.kun-stage-${originalPid}`
    assertSucceeded(run(input, 'Prepare'), 'Prepare from active stage-named source')
    payload(input.stage, 'Kun.exe')
    assertSucceeded(run(input, 'RecoverInstallerUpdateTransaction', '', restartedEnvironment(input)), 'recover active stage-named source')
    expect(existsSync(join(activeSource, 'Kun.exe'))).toBe(true)
    expect(readFileSync(join(activeSource, 'notes.txt'), 'utf8')).toBe('preserved user file')
    expect(existsSync(input.stage)).toBe(false)
    expect(existsSync(input.transaction)).toBe(false)
  }, 120_000)

  it('supports the independently resolved registered source when older updaters have no source marker', () => {
    const input = installerFixture()
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    assertSucceeded(run(input, 'RecoverInstallerUpdateTransaction', '', {
      ...restartedEnvironment(input), KUN_INSTALLER_UPDATE_SOURCE: ''
    }), 'registered-source restart recovery')
    expect(existsSync(input.transaction)).toBe(false)
  }, 120_000)

  it('does not require a health result before same-process payload switching', () => {
    const input = installerFixture()
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    payload(input.stage, 'Kun.exe')
    expect(existsSync(input.health)).toBe(false)
    assertSucceeded(run(input, 'SwitchUpdatePayload'), 'SwitchUpdatePayload without health')
    expect(readTransaction(input).Phase).toBe('payload_switched')
    assertSucceeded(run(input, 'RecoverUpdateTransaction'), 'unchanged GUI recovery')
    expect(readTransaction(input).Phase).toBe('rolled_back')
  }, 120_000)

  it.each([
    ['Source', 'outside'], ['Target', 'outside'], ['StageRoot', 'outside'],
    ['BackupRoot', 'outside'], ['OldPayloadRoot', 'outside'], ['HealthResult', 'outside'],
    ['AssetsRoot', 'outside'], ['FailedPayloadRoot', 'outside'], ['JournalPath', 'outside'],
    ['AppGuid', 'wrong-app'], ['InstallMode', 'all'], ['InstallRegistryKey', 'Software\\Unrelated']
  ])('rejects redirected %s without changing recovery evidence', (field, value) => {
    const input = installerFixture()
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    const record = readTransaction(input)
    record[field] = value === 'outside' ? join(input.root, 'unrelated') : value
    writeFileSync(input.transaction, JSON.stringify(record))
    const transactionBefore = readFileSync(input.transaction)
    const journalBefore = readFileSync(input.journal)
    assertExpectedFailure(run(input, 'RecoverInstallerUpdateTransaction', '', restartedEnvironment(input)), `redirected ${field}`)
    expect(readFileSync(input.transaction)).toEqual(transactionBefore)
    expect(readFileSync(input.journal)).toEqual(journalBefore)
    expect(existsSync(input.backup)).toBe(true)
  }, 120_000)

  it.each(['StageRoot', 'OldPayloadRoot', 'BackupRoot'])('rejects a valid-shaped %s from another installer PID', (field) => {
    const input = installerFixture()
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    const record = readTransaction(input)
    record[field] = String(record[field]).replace(new RegExp(`${originalPid}$`), String(process.pid + 1))
    writeFileSync(input.transaction, JSON.stringify(record))
    const before = readFileSync(input.transaction)
    assertExpectedFailure(run(input, 'RecoverInstallerUpdateTransaction', '', restartedEnvironment(input)), `mismatched PID ${field}`)
    expect(readFileSync(input.transaction)).toEqual(before)
  }, 120_000)

  it('resolves an old staged test registration only through its trusted transaction, without changing artifacts', () => {
    const input = installerFixture()
    // Only the fixture registry subtree is used; this is not a compiled NSIS run.
    primeCutoverMetadata(input)
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    payload(input.stage, 'Kun.exe')
    primeCutoverMetadata({ ...input, target: input.stage })
    const registeredLocation = () => {
      const result = powershell(
        `[Console]::Out.Write([Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\KunInstallerTransactionTest\\Install').GetValue('InstallLocation'))`
      )
      assertSucceeded(result, 'read isolated fixture registration')
      return String(result.stdout).trim()
    }
    expect(registeredLocation()).toBe(input.stage)
    const environment = {
      ...restartedEnvironment(input),
      KUN_INSTALLER_CURRENT_USER_SOURCE: registeredLocation(),
      KUN_INSTALLER_CURRENT_USER_UNINSTALL_STRING: '',
      KUN_INSTALLER_ALL_USERS_SOURCE: '',
      KUN_INSTALLER_ALL_USERS_UNINSTALL_STRING: '',
      KUN_INSTALLER_CURRENT_RECOVERY_ROOT: dirname(input.journal),
      KUN_INSTALLER_ALL_RECOVERY_ROOT: join(input.root, 'unrelated-all-users-recovery')
    }
    const before = readFileSync(input.transaction)
    const journal = readFileSync(input.journal)
    const selected = run(input, 'ResolveUpdateScope', '', environment)
    assertSucceeded(selected, 'trusted staged registration scope')
    expect(readFileSync(input.result('ResolveUpdateScope'), 'utf16le')).toBe('current')
    expect(readFileSync(input.transaction)).toEqual(before)
    expect(readFileSync(input.journal)).toEqual(journal)
    const state = readTransaction(input)
    state.AppGuid = 'another-app'
    writeFileSync(input.transaction, JSON.stringify(state))
    const tampered = readFileSync(input.transaction)
    assertExpectedFailure(run(input, 'ResolveUpdateScope', '', environment), 'foreign staged registration')
    expect(readFileSync(input.transaction)).toEqual(tampered)
    expect(readFileSync(input.journal)).toEqual(journal)
    writeFileSync(input.transaction, before)
    assertExpectedFailure(run(input, 'ResolveUpdateScope', '', {
      ...environment, KUN_INSTALLER_CURRENT_USER_SOURCE: `${input.target}.kun-stage-${process.pid + 1}`
    }), 'unrelated staged registration')
    expect(readFileSync(input.transaction)).toEqual(before)
    assertSucceeded(run(input, 'RecoverInstallerUpdateTransaction', '', environment), 'recovery after staged scope selection')
    expect(existsSync(input.transaction)).toBe(false)
    expect(registeredLocation()).toBe(input.target)
    expect(readFileSync(join(input.source, 'notes.txt'), 'utf8')).toBe('preserved user file')
  }, 120_000)

  it('rejects a changed current installer target instead of importing the saved target', () => {
    const input = installerFixture()
    assertSucceeded(run(input, 'Prepare'), 'Prepare')
    const before = readFileSync(input.transaction)
    assertExpectedFailure(run(input, 'RecoverInstallerUpdateTransaction', '', {
      ...restartedEnvironment(input), KUN_INSTALLER_TARGET: join(input.root, 'unrelated')
    }), 'wrong current target')
    expect(readFileSync(input.transaction)).toEqual(before)
  }, 120_000)
})

function copyHelpers(pluginRoot: string): string {
  mkdirSync(pluginRoot, { recursive: true })
  const build = join(process.cwd(), 'build')
  for (const name of readdirSync(build).filter((name) => /^windows-installer-migration(?:-.*)?\.ps1$/.test(name))) {
    copyFileSync(join(build, name), join(pluginRoot, name))
  }
  return join(pluginRoot, 'windows-installer-migration.ps1')
}
function candidatePayload(candidate: string): void {
  payload(candidate, 'Kun.exe')
  writeFileSync(join(candidate, 'Kun.exe'), 'candidate executable')
  const resources = join(candidate, 'resources')
  const files: Array<{ path: string, size: number }> = []
  const walk = (directory: string) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name)
      if (statSync(path).isDirectory()) walk(path)
      else files.push({ path: relative(resources, path).replaceAll('\\', '/'), size: statSync(path).size })
    }
  }
  walk(resources)
  writeFileSync(join(resources, 'kun-runtime-integrity.json'), JSON.stringify({ schemaVersion: 1, files, modules: [] }))
}
function preparedFixture() {
  const input = fixture(true)
  const pluginRoot = join(input.root, 'NSIS plugin')
  const helper = copyHelpers(pluginRoot)
  const candidate = join(pluginRoot, 'kun-candidate')
  assertSucceeded(run(input, 'Prepare'), 'Prepare')
  candidatePayload(candidate)
  return { input, helper, candidate }
}
function stage(input: Fixture, helper: string, environment: NodeJS.ProcessEnv = {}) {
  return run(input, 'StageExtractedUpdatePayload', '', environment, true, helper)
}
function compare(input: Fixture, candidate: string) {
  return spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
    '-NoProfile', '-NonInteractive', '-Command',
    '$ErrorActionPreference="Stop"; . $env:KUN_TEST_COPY_HELPER; [KunInstallerPayloadCopy]::CompareExtractedCandidate($env:KUN_TEST_CANDIDATE, $env:KUN_TEST_STAGE)'
  ], {
    encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, KUN_TEST_COPY_HELPER: join(process.cwd(), 'build/windows-installer-migration-payload-copy.ps1'),
      KUN_TEST_CANDIDATE: candidate, KUN_TEST_STAGE: input.stage }
  })
}

describe('automatic update extraction source contract', () => {
  it('derives a fixed helper-local candidate and retains the authoritative prepared stage', () => {
    const script = readFileSync(join(process.cwd(), 'build/windows-installer-migration-actions.ps1'), 'utf8')
    const action = script.slice(script.indexOf('function Stage-ExtractedUpdatePayload'), script.indexOf('function Assert-UpdateHealthResult'))
    expect(action).toContain('Read-UpdateTransaction')
    expect(action).toContain("[string]$transaction.Phase -ne 'prepared'")
    expect(action).toContain("Join-Path $PSScriptRoot 'kun-candidate'")
    expect(action).toContain('([string]$transaction.StageRoot)')
    expect(action).toContain('[KunInstallerPayloadCopy]::Validate($candidate)')
    expect(action.indexOf('Assert-PackagedInstallPayloadAt $candidate')).toBeLessThan(action.indexOf('CopyExtractedCandidate'))
    expect(action).toContain('Assert-PackagedInstallPayloadAt $stage')
    expect(action).not.toContain('Remove-')
    expect(action).not.toContain('Set-UpdateTransactionPhase')
  })
})

windowsOnly('native helper staging from a fixed short extraction directory', () => {
  it('rolls back a deterministic partial native copy without losing unknown user files, then retries', async () => {
    const { input, helper, candidate } = preparedFixture()
    const lockedFile = join(candidate, 'resources', 'app.asar')
    const journalBefore = readFileSync(input.journal)
    const transactionBefore = readFileSync(input.transaction)
    const journal = JSON.parse(journalBefore.toString('utf8').replace(/^\uFEFF/, ''))
    const preservedNotes = join(journal.Records[0].Stash, 'content', 'notes.txt')
    expect(readFileSync(preservedNotes, 'utf8')).toBe('preserved user file')
    const command = [
      '$ErrorActionPreference = "Stop"',
      `Add-Type -TypeDefinition 'public static class KunFixtureCopyLockRelease { public static void Wait() { var ready = new System.Threading.ManualResetEvent(false); var input = new System.Threading.Thread(() => { System.Console.ReadLine(); ready.Set(); }); input.IsBackground = true; input.Start(); ready.WaitOne(90000); } }'`,
      '$stream = [IO.File]::Open($env:KUN_TEST_LOCK_FILE, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)',
      'try { [Console]::Out.WriteLine("READY"); [Console]::Out.Flush(); [KunFixtureCopyLockRelease]::Wait() } finally { $stream.Dispose() }'
    ].join('; ')
    const locker = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', command], {
        env: { ...process.env, KUN_TEST_LOCK_FILE: lockedFile }, stdio: ['pipe', 'pipe', 'pipe']
      })
    let output = ''
    let errors = ''
    locker.stdout.on('data', (chunk) => { output += String(chunk) })
    locker.stderr.on('data', (chunk) => { errors += String(chunk) })
    locker.stdin.on('error', () => undefined)
    const exited = new Promise<number | null>((resolve, reject) => {
      locker.once('exit', resolve)
      locker.once('error', reject)
    })
    void exited.catch(() => undefined)
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { clearInterval(poll); reject(new Error(`Copy locker readiness timed out: ${errors}`)) }, 15_000)
        const poll = setInterval(() => {
          if (output.includes('READY')) { clearTimeout(timeout); clearInterval(poll); resolve() }
          else if (locker.exitCode !== null) { clearTimeout(timeout); clearInterval(poll); reject(new Error(`Copy locker exited before ready: ${errors}`)) }
        }, 25)
        void exited.catch((error) => { clearTimeout(timeout); clearInterval(poll); reject(error) })
      })
      const failed = stage(input, helper)
      assertExpectedFailure(failed, 'exclusive candidate lock interrupts native staging')
      expect(failed.status).not.toBe(124)
      expect(`${failed.stdout}\n${failed.stderr}`).toContain('Cannot copy payload')
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(locker.exitCode).toBeNull()
      expect(locker.signalCode).toBeNull()
      // CopyTree creates this directory before attempting its locked child;
      // this proves partial progress without depending on enumeration order.
      expect(existsSync(join(input.stage, 'resources'))).toBe(true)
      expect(readFileSync(input.transaction)).toEqual(transactionBefore)
      expect(readFileSync(input.journal)).toEqual(journalBefore)
      expect(readFileSync(preservedNotes, 'utf8')).toBe('preserved user file')
      expect(readFileSync(join(input.backup, 'notes.txt'), 'utf8')).toBe('preserved user file')
      expect(readFileSync(join(input.source, 'Kun.exe'), 'utf8')).toBe('executable')
    } finally {
      locker.stdin.end('\n')
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Copy locker failed to exit naturally: ${errors}`)), 15_000)
        void exited.then((code) => { clearTimeout(timeout); resolve(code) }, (error) => { clearTimeout(timeout); reject(error) })
      })
      expect(exitCode, errors).toBe(0)
    }
    assertSucceeded(run(input, 'RollbackUpdateTransaction'), 'rollback partial native staging')
    expect(existsSync(input.stage)).toBe(false)
    expect(existsSync(input.journal)).toBe(false)
    expect(readFileSync(join(input.source, 'notes.txt'), 'utf8')).toBe('preserved user file')
    expect(readTransaction(input).Phase).toBe('rolled_back')
    assertSucceeded(run(input, 'Prepare'), 'Prepare after partial staging rollback')
    assertSucceeded(stage(input, helper), 'native staging retry after natural lock release')
    assertSucceeded(run(input, 'SwitchUpdatePayload'), 'Switch after native staging retry')
    assertSucceeded(run(input, 'RollbackUpdateTransaction'), 'rollback retried candidate')
    expect(readFileSync(join(input.source, 'notes.txt'), 'utf8')).toBe('preserved user file')
  }, 360_000)

  it('copies a complete deep tree into the unchanged authorized stage and preserves old recovery data', () => {
    const { input, helper, candidate } = preparedFixture()
    const deep = join('resources', ...Array.from({ length: 6 }, (_, index) => `dependency-${index}-${'x'.repeat(35)}`), 'payload.bin')
    mkdirSync(dirname(join(candidate, deep)), { recursive: true })
    const bytes = Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 256))
    writeFileSync(join(candidate, deep), bytes)
    mkdirSync(join(candidate, 'empty-directory'))
    // Rebuild the manifest to include the deep dependency, not just bootstraps.
    rmSync(join(candidate, 'resources', 'kun-runtime-integrity.json'))
    candidatePayload(candidate)
    expect(join(input.stage, deep).length).toBeGreaterThan(260)
    const transaction = readFileSync(input.transaction)
    const journal = readFileSync(input.journal)
    const outside = join(input.root, 'unrelated')
    mkdirSync(outside)
    writeFileSync(join(outside, 'sentinel'), 'unchanged')
    assertSucceeded(stage(input, helper, { KUN_INSTALLER_CANDIDATE: outside }), 'native candidate staging')
    expect(readFileSync(join(input.stage, deep))).toEqual(bytes)
    expect(readdirSync(join(input.stage, 'empty-directory'))).toEqual([])
    expect(readFileSync(input.transaction)).toEqual(transaction)
    expect(readFileSync(input.journal)).toEqual(journal)
    expect(readFileSync(join(input.source, 'Kun.exe'), 'utf8')).toBe('executable')
    expect(readFileSync(join(input.backup, 'notes.txt'), 'utf8')).toBe('preserved user file')
    expect(readFileSync(join(outside, 'sentinel'), 'utf8')).toBe('unchanged')
    expect(existsSync(candidate)).toBe(true)
    assertSucceeded(run(input, 'SwitchUpdatePayload'), 'Switch complete native-copied payload')
    expect(readFileSync(join(input.target, 'Kun.exe'), 'utf8')).toBe('candidate executable')
    assertSucceeded(run(input, 'RollbackUpdateTransaction'), 'rollback after staged candidate')
    expect(readFileSync(join(input.source, 'notes.txt'), 'utf8')).toBe('preserved user file')
  }, 180_000)

  it.each(['nonempty', 'tampered-stage', 'wrong-phase', 'missing-manifest', 'missing-file', 'truncated-file'])(
    'rejects %s before modifying original payload or recovery records', (fault) => {
      const { input, helper, candidate } = preparedFixture()
      if (fault === 'nonempty') {
        mkdirSync(input.stage)
        writeFileSync(join(input.stage, 'unknown-user-file'), 'keep')
      } else if (fault === 'tampered-stage' || fault === 'wrong-phase') {
        const transaction = JSON.parse(readFileSync(input.transaction, 'utf8').replace(/^\uFEFF/, ''))
        if (fault === 'tampered-stage') transaction.StageRoot = join(input.root, 'unrelated-stage')
        else transaction.Phase = 'committed'
        writeFileSync(input.transaction, JSON.stringify(transaction))
      } else if (fault === 'missing-manifest') rmSync(join(candidate, 'resources', 'kun-runtime-integrity.json'))
      else if (fault === 'missing-file') rmSync(join(candidate, 'resources', 'app.asar'))
      else writeFileSync(join(candidate, 'resources', 'app.asar'), 'wrong-size')
      const before = readFileSync(input.transaction)
      const journal = readFileSync(input.journal)
      assertExpectedFailure(stage(input, helper), `stage ${fault}`)
      expect(readFileSync(input.transaction)).toEqual(before)
      expect(readFileSync(input.journal)).toEqual(journal)
      expect(readFileSync(join(input.source, 'Kun.exe'), 'utf8')).toBe('executable')
      if (fault === 'nonempty') expect(readFileSync(join(input.stage, 'unknown-user-file'), 'utf8')).toBe('keep')
      else expect(existsSync(input.stage)).toBe(false)
    }, 120_000
  )

  it.each(['candidate-root', 'candidate-descendant', 'stage-root'] as const)('refuses %s reparse points', (location) => {
    const { input, helper, candidate } = preparedFixture()
    const outside = join(input.root, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'sentinel'), 'keep')
    if (location === 'candidate-root') {
      rmSync(candidate, { recursive: true })
      symlinkSync(outside, candidate, 'junction')
    } else if (location === 'candidate-descendant') {
      symlinkSync(outside, join(candidate, 'linked'), 'junction')
    } else symlinkSync(outside, input.stage, 'junction')
    assertExpectedFailure(stage(input, helper), `reparse ${location}`)
    expect(readFileSync(join(outside, 'sentinel'), 'utf8')).toBe('keep')
  }, 120_000)

  it('refuses a helper-local candidate overlapping the original install even with a valid transaction', () => {
    const { input } = preparedFixture()
    const pluginRoot = join(input.source, 'unexpected-plugin')
    const helper = copyHelpers(pluginRoot)
    candidatePayload(join(pluginRoot, 'kun-candidate'))
    assertExpectedFailure(stage(input, helper), 'candidate overlaps source')
    expect(existsSync(join(pluginRoot, 'kun-candidate', 'Kun.exe'))).toBe(true)
    expect(existsSync(input.stage)).toBe(false)
  }, 120_000)

  it.each(['size', 'missing', 'extra', 'type'] as const)('detects %s divergence in complete staged inventory', (fault) => {
    const { input, helper, candidate } = preparedFixture()
    assertSucceeded(stage(input, helper), 'stage before verification tamper')
    const file = join(input.stage, 'resources', 'app.asar')
    if (fault === 'size') writeFileSync(file, 'wrong-size')
    else if (fault === 'missing') rmSync(file)
    else if (fault === 'extra') writeFileSync(join(input.stage, 'unexpected'), 'extra')
    else { rmSync(file); mkdirSync(file) }
    assertExpectedFailure(compare(input, candidate), `inventory ${fault}`)
    expect(existsSync(candidate)).toBe(true)
  }, 120_000)
})
