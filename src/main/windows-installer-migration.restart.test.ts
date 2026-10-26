import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
