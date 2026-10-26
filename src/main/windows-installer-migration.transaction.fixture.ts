import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect } from 'vitest'

// Shared fixture for the Windows installer transaction tests: it owns the
// temporary install roots, the real PowerShell invocations, and the registry
// cleanup so multiple test files can exercise the same transaction without
// copying the harness.
export const windowsOnly = process.platform === 'win32' ? describe : describe.skip
export const helper = join(process.cwd(), 'build/windows-installer-migration.ps1')
const roots: Array<{ root: string, artifactDirectory?: string }> = []
const artifactRoot = process.env.KUN_INSTALLER_TEST_ARTIFACT_ROOT
let fixtureIndex = 0

export type Fixture = ReturnType<typeof fixture>
export type Action = 'ResolveUpdateScope' | 'ValidateUpdateRollback' | 'Prepare' | 'SwitchUpdatePayload' | 'ValidateCutover' | 'RollbackUpdateTransaction' | 'Restore' | 'UpdatePath' | 'ValidateHealthResult' | 'CommitUpdateTransaction' | 'FinalizeUpdateTransaction' | 'RecoverUpdateTransaction' | 'RecoverInstallerUpdateTransaction'

export function payload(root: string, executable: string): void {
  mkdirSync(join(root, 'resources', 'app.asar.unpacked', 'kun', 'dist', 'cli'), { recursive: true })
  mkdirSync(join(root, 'resources', 'app.asar.unpacked', 'kun', 'dist', 'manager'), { recursive: true })
  writeFileSync(join(root, executable), 'executable')
  writeFileSync(join(root, 'resources', 'app.asar'), 'asar')
  writeFileSync(join(root, 'resources', 'app.asar.unpacked', 'kun', 'dist', 'cli', 'serve-entry.js'), 'cli')
  writeFileSync(join(root, 'resources', 'app.asar.unpacked', 'kun', 'dist', 'manager', 'manager-entry.js'), 'manager')
}

export function fixture(inPlace = false, unicodePath = false) {
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

export function run(input: Fixture, action: Action, fault = '', environment: NodeJS.ProcessEnv = {}) {
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
      KUN_INSTALLER_FAULT_POINT: fault,
      ...environment
    }
  })
  if (fault) {
    expect(result.stderr, processSummary(result, action)).toContain(`KUN_INSTALLER_FAULT_INJECTION:${fault}`)
  }
  return result
}

export function powershell(command: string): ReturnType<typeof spawnSync> {
  return spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8' })
}

export function primeCutoverMetadata(input: Fixture): void {
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

export function assertSucceeded(result: ReturnType<typeof spawnSync>, action: string): void {
  expect(result.status, processSummary(result, action)).toBe(0)
  expect(result.signal, processSummary(result, action)).toBeNull()
}

export function assertExpectedFailure(result: ReturnType<typeof spawnSync>, action: string): void {
  expect(result.status, processSummary(result, action)).not.toBe(0)
  expect(result.signal, processSummary(result, action)).toBeNull()
}

export function transaction(path: string): {
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

export function captureDiagnostics(root: string, destination: string): void {
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

/** Registers the registry and temp-root cleanup every transaction test needs. */
export function cleanupTransactionFixtures(): void {
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
}

