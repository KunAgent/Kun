import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const windowsOnly = process.platform === 'win32' ? describe : describe.skip
const helper = join(process.cwd(), 'build/windows-installer-migration.ps1')
const roots: string[] = []

type Fixture = ReturnType<typeof fixture>
type Action = 'Prepare' | 'SwitchUpdatePayload' | 'RollbackUpdateTransaction' | 'Restore' | 'UpdatePath' | 'ValidateHealthResult' | 'CommitUpdateTransaction' | 'RecoverUpdateTransaction'

function payload(root: string, executable: string): void {
  mkdirSync(join(root, 'resources', 'app.asar.unpacked', 'kun', 'dist', 'cli'), { recursive: true })
  mkdirSync(join(root, 'resources', 'app.asar.unpacked', 'kun', 'dist', 'manager'), { recursive: true })
  writeFileSync(join(root, executable), 'executable')
  writeFileSync(join(root, 'resources', 'app.asar'), 'asar')
  writeFileSync(join(root, 'resources', 'app.asar.unpacked', 'kun', 'dist', 'cli', 'serve-entry.js'), 'cli')
  writeFileSync(join(root, 'resources', 'app.asar.unpacked', 'kun', 'dist', 'manager', 'manager-entry.js'), 'manager')
}

function fixture(inPlace = false) {
  const root = mkdtempSync(join(tmpdir(), 'kun-installer-migration-smoke-'))
  roots.push(root)
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
  return {
    root, source, target, stage, desktop, programs,
    backup: join(recovery, 'payload'),
    journal: join(recovery, 'journal.json'),
    transaction: join(recovery, 'update.json'),
    health: join(root, 'health.json')
  }
}

function run(input: Fixture, action: Action, fault = '') {
  const powershell = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
  )
  return spawnSync(powershell, [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Action', action,
    '-ResultPath', join(input.root, `${action}.txt`)
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
}

function powershell(command: string): ReturnType<typeof spawnSync> {
  return spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8' })
}

function transaction(path: string): { Phase: string; RollbackOutcome: string } {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as {
    Phase: string
    RollbackOutcome: string
  }
}

afterEach(() => {
  if (process.platform === 'win32') {
    spawnSync('powershell.exe', [
      '-NoProfile', '-Command',
      "Remove-Item -LiteralPath 'HKCU:\\Software\\KunInstallerTransactionTest' -Recurse -Force -ErrorAction SilentlyContinue"
    ])
  }
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

windowsOnly('Windows automatic update transaction', () => {
  it('keeps the legacy payload untouched when staged validation fails', () => {
    const input = fixture()
    expect(run(input, 'Prepare').status).toBe(0)
    payload(input.stage, 'Kun.exe')
    const switched = run(input, 'SwitchUpdatePayload', 'validate.before_check')
    expect(switched.status).not.toBe(0)
    expect(existsSync(join(input.source, 'DeepSeek GUI.exe'))).toBe(true)
    expect(existsSync(input.target)).toBe(false)
    expect(transaction(input.transaction).Phase).toBe('prepared')
  })

  it('restores the complete old payload after a post-switch failure', () => {
    const input = fixture()
    writeFileSync(join(input.desktop, 'DeepSeek GUI.lnk'), 'old shortcut bytes')
    expect(run(input, 'Prepare').status).toBe(0)
    payload(input.stage, 'Kun.exe')
    expect(run(input, 'SwitchUpdatePayload').status).toBe(0)
    writeFileSync(join(input.desktop, 'DeepSeek GUI.lnk'), 'changed shortcut bytes')
    const restoreFailed = run(input, 'Restore', 'restore.after_first_entry')
    expect(restoreFailed.status).not.toBe(0)
    rmSync(input.source, { recursive: true, force: true })
    expect(run(input, 'RollbackUpdateTransaction').status).toBe(0)
    expect(readFileSync(join(input.source, 'notes.txt'), 'utf8')).toBe('preserved user file')
    expect(existsSync(join(input.source, 'DeepSeek GUI.exe'))).toBe(true)
    expect(existsSync(input.target)).toBe(false)
    expect(readFileSync(join(input.desktop, 'DeepSeek GUI.lnk'), 'utf8')).toBe('old shortcut bytes')
    expect(transaction(input.transaction)).toMatchObject({ Phase: 'rolled_back', RollbackOutcome: 'succeeded' })
  })

  it('restores a same-directory payload after cutover failure', () => {
    const input = fixture(true)
    expect(run(input, 'Prepare').status).toBe(0)
    payload(input.stage, 'Kun.exe')
    expect(run(input, 'SwitchUpdatePayload').status).toBe(0)
    writeFileSync(join(input.target, 'Kun.exe'), 'candidate')
    expect(run(input, 'RollbackUpdateTransaction').status).toBe(0)
    expect(readFileSync(join(input.source, 'Kun.exe'), 'utf8')).toBe('executable')
    expect(readFileSync(join(input.source, 'notes.txt'), 'utf8')).toBe('preserved user file')
  })

  it('rolls back cleanup_pending after the candidate later fails its first full startup', () => {
    const input = fixture()
    expect(run(input, 'Prepare').status).toBe(0)
    payload(input.stage, 'Kun.exe')
    expect(run(input, 'SwitchUpdatePayload').status).toBe(0)
    const state = JSON.parse(readFileSync(input.transaction, 'utf8').replace(/^\uFEFF/, ''))
    state.Phase = 'awaiting_health'
    writeFileSync(input.transaction, JSON.stringify(state))
    writeFileSync(input.health, JSON.stringify({
      ok: true,
      token: state.HealthToken,
      installDir: input.target,
      version: '0.2.0'
    }))
    expect(run(input, 'CommitUpdateTransaction').status).toBe(0)
    expect(transaction(input.transaction).Phase).toBe('committed')
    expect(existsSync(input.transaction)).toBe(true)
    expect(existsSync(state.BackupRoot)).toBe(true)

    expect(run(input, 'RecoverUpdateTransaction').status).toBe(0)
    expect(readFileSync(join(input.source, 'DeepSeek GUI.exe'), 'utf8')).toBe('executable')
    expect(existsSync(input.target)).toBe(false)
    expect(transaction(input.transaction)).toMatchObject({ Phase: 'rolled_back', RollbackOutcome: 'succeeded' })
  })

  it('rejects a health result from the wrong candidate version', () => {
    const input = fixture()
    expect(run(input, 'Prepare').status).toBe(0)
    payload(input.stage, 'Kun.exe')
    expect(run(input, 'SwitchUpdatePayload').status).toBe(0)
    const state = JSON.parse(readFileSync(input.transaction, 'utf8').replace(/^\uFEFF/, ''))
    state.Phase = 'awaiting_health'
    writeFileSync(input.transaction, JSON.stringify(state))
    writeFileSync(input.health, JSON.stringify({
      ok: true,
      token: state.HealthToken,
      installDir: input.target,
      version: '9.9.9'
    }))
    expect(run(input, 'ValidateHealthResult').status).not.toBe(0)
    expect(run(input, 'RollbackUpdateTransaction').status).toBe(0)
    expect(existsSync(join(input.source, 'DeepSeek GUI.exe'))).toBe(true)
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
    expect(save.status).toBe(0)
    try {
      expect(run(input, 'Prepare').status).toBe(0)
      expect(powershell(`
        $key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment',$true)
        $key.SetValue('Path','changed',[Microsoft.Win32.RegistryValueKind]::String)
        $key.Dispose()
      `).status).toBe(0)
      expect(run(input, 'RollbackUpdateTransaction').status).toBe(0)
      const restored = powershell(`
        $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment',$false)
        [Console]::WriteLine([string]$key.GetValueKind('Path'))
        [Console]::Write(($key.GetValue('Path') -join '|'))
      `)
      expect(restored.status).toBe(0)
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
    expect(run(input, 'Prepare').status).toBe(0)
    payload(input.stage, 'Kun.exe')
    expect(run(input, 'SwitchUpdatePayload').status).toBe(0)
    expect(run(input, 'UpdatePath', 'path.after_write').status).not.toBe(0)
    expect(run(input, 'RollbackUpdateTransaction').status).toBe(0)
    const current = spawnSync('powershell.exe', [
      '-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('Path','User')"
    ], { encoding: 'utf8' }).stdout.trim()
    expect(current).toBe(originalPath.trim())
    expect(existsSync(join(input.source, 'DeepSeek GUI.exe'))).toBe(true)
  })
})
