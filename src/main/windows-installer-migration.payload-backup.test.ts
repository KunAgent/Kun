import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const windowsOnly = process.platform === 'win32' ? describe : describe.skip
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const helper = join(process.cwd(), 'build/windows-installer-migration.ps1')
const roots: string[] = []
const original = Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 256))
type Action = 'BackupPayload' | 'RestorePayloadBackup'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'kun-payload-backup-'))
  roots.push(root)
  const source = join(root, 'installed Kun \u4f60\u597d')
  const backup = join(root, 'recovery with spaces \u5907\u4efd', 'payload')
  const outside = join(root, 'outside')
  for (const directory of [source, outside]) mkdirSync(directory, { recursive: true })
  mkdirSync(join(source, 'resources'))
  writeFileSync(join(source, 'Kun.exe'), 'old executable')
  writeFileSync(join(source, 'resources', 'app.asar'), 'old asar')
  writeFileSync(join(outside, 'sentinel.bin'), original)
  return { root, source, backup, outside }
}

type Fixture = ReturnType<typeof fixture>
function run(input: Fixture, action: Action, options: { cwd?: string, bounded?: boolean } = {}) {
  return spawnSync(powershell, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
    '-Action', action, '-ResultPath', join(input.root, `${action}.txt`), ...(options.bounded ? ['-Bounded'] : [])
  ], {
    encoding: 'utf8', timeout: 60_000, cwd: options.cwd,
    env: {
      ...process.env,
      KUN_INSTALLER_SOURCE: input.source,
      KUN_INSTALLER_TARGET: input.source,
      KUN_INSTALLER_SECONDARY_SOURCE: '',
      KUN_INSTALLER_PAYLOAD_BACKUP: input.backup,
      KUN_INSTALLER_AUTOMATIC_UPDATE: '1',
      KUN_INSTALLER_IN_PLACE_UPDATE: '1',
      KUN_INSTALLER_APP_EXECUTABLE: 'Kun.exe',
      KUN_INSTALLER_DIAGNOSTIC_PATH: join(input.root, 'diagnostic.log')
    }
  })
}

function succeeded(result: ReturnType<typeof run>) {
  expect(result.error).toBeUndefined()
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

function rejected(result: ReturnType<typeof run>) {
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0)
  expect(`${result.stdout}\n${result.stderr}`).toMatch(/reparse point/i)
}

function deepRelativePath() {
  return join('resources', 'app.asar.unpacked', 'node_modules',
    ...Array.from({ length: 7 }, (_, index) => `nested dependency ${index} ${'x'.repeat(24)}`),
    '\u6a21\u5757 [bytes].bin')
}

function put(root: string, relative: string, bytes = original) {
  const path = join(root, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
  return path
}

function untouchedOutside(input: Fixture) {
  expect(readdirSync(input.outside)).toEqual(['sentinel.bin'])
  expect(readFileSync(join(input.outside, 'sentinel.bin'))).toEqual(original)
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('automatic-update payload helper packaging', () => {
  it('uses native metadata only as evidence and keeps strict manifest failures', () => {
    const script = readFileSync(join(process.cwd(), 'build/windows-installer-migration-runtime-integrity.ps1'), 'utf8')
    expect(script).toContain('[KunInstallerPayloadCopy]::InspectLiteralFile($PathValue)')
    const native = readFileSync(join(process.cwd(), 'build/windows-installer-migration-payload-copy.ps1'), 'utf8')
    const literalWalk = native.slice(native.indexOf('static void ValidateLiteralInspectionAncestors'), native.indexOf('public static void Remove'))
    expect(literalWalk).not.toContain('Path.GetDirectoryName')
    expect(literalWalk).toContain('current.LastIndexOf')
    expect(literalWalk).toContain('Attributes(Extended(current), true)')
    expect(script).toContain('Write-RuntimeFileInspection $path ([string]$file.path)')
    expect(script).toContain('throw "The installed Kun runtime is missing a packaged file: $($file.path)"')
    expect(script).toContain('throw "The installed Kun runtime file is truncated: $($file.path)"')
  })

  it('pins compiler references to loaded framework assemblies rather than the plugin working directory', () => {
    for (const file of ['windows-installer-migration.ps1', 'windows-installer-migration-payload-copy.ps1']) {
      const script = readFileSync(join(process.cwd(), 'build', file), 'utf8')
      expect(script).toContain('[System.CodeDom.Compiler.CompilerParameters]::new()')
      expect(script).toContain(".CompilerOptions = '/nostdlib'")
      expect(script).toContain('.ReferencedAssemblies.Add([System.Object].Assembly.Location)')
      expect(script).toContain('.ReferencedAssemblies.Add([System.ComponentModel.Win32Exception].Assembly.Location)')
      expect(script).toContain('Add-Type -CompilerParameters')
      expect(script).not.toContain('Add-Type -ReferencedAssemblies')
    }
  })

  it('ships the long-path helper in both NSIS entry points and packaged recovery resources', () => {
    const filename = 'windows-installer-migration-payload-copy.ps1'
    for (const file of ['installer.nsh', 'installer-process-check.nsh']) {
      expect(readFileSync(join(process.cwd(), 'build', file), 'utf8')).toContain(filename)
    }
    expect(readFileSync(join(process.cwd(), 'electron-builder.config.cjs'), 'utf8'))
      .toContain("filter: ['windows-installer-migration*.ps1']")
    expect(readFileSync(join(process.cwd(), 'scripts/check-windows-installer-syntax.cjs'), 'utf8'))
      .toContain(filename)
    expect(existsSync(join(process.cwd(), 'build', filename))).toBe(true)
  })
})

windowsOnly('Windows PowerShell 5.1 automatic-update payload copy', () => {
  it('distinguishes native long-path metadata from provider visibility without weakening manifest validation', () => {
    const input = fixture()
    const relative = join(dirname(deepRelativePath()), 'package.json')
    const file = put(input.source, relative)
    expect(file.length).toBeGreaterThan(260)
    const manifest = join(input.source, 'resources', 'kun-runtime-integrity.json')
    const manifestPath = relative.slice('resources'.length + 1).replaceAll('\\', '/')
    writeFileSync(manifest, JSON.stringify({ schemaVersion: 1, files: [{ path: manifestPath, size: original.length }], modules: [] }))
    const inspect = () => spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', [
      '$ErrorActionPreference = "Stop"',
      '. (Join-Path $env:KUN_TEST_HELPERS "windows-installer-migration-paths.ps1")',
      '. (Join-Path $env:KUN_TEST_HELPERS "windows-installer-migration-filesystem.ps1")',
      '. (Join-Path $env:KUN_TEST_HELPERS "windows-installer-migration-payload-copy.ps1")',
      '. (Join-Path $env:KUN_TEST_HELPERS "windows-installer-migration-runtime-integrity.ps1")',
      '[Console]::Out.WriteLine((@{providerExists=(Test-Path -LiteralPath $env:KUN_TEST_FILE -PathType Leaf); native=[KunInstallerPayloadCopy]::InspectLiteralFile($env:KUN_TEST_FILE)} | ConvertTo-Json -Compress))',
      'Assert-PackagedRuntimeIntegrity $env:KUN_TEST_ROOT'
    ].join('; ')], {
      encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, KUN_TEST_HELPERS: dirname(helper), KUN_TEST_FILE: file,
        KUN_TEST_ROOT: input.source, KUN_INSTALLER_DIAGNOSTIC_PATH: join(input.root, 'diagnostic.log') }
    })
    const present = inspect()
    expect(present.error).toBeUndefined()
    const observation = JSON.parse(present.stdout.trim()) as { providerExists: boolean, native: string }
    expect(observation.native).toBe(`exists=true kind=file bytes=${original.length}`)
    console.info('[runtime-integrity-long-path]', JSON.stringify({ pathLength: file.length, ...observation }))
    // Provider behavior depends on the runner's .NET long-path switches. Record
    // the distinction instead of claiming every PowerShell 5.1 host rejects it.
    if (observation.providerExists) succeeded(present)
    else {
      expect(present.status).not.toBe(0)
      expect(present.stderr).toContain('missing a packaged file')
      expect(readFileSync(join(input.root, 'diagnostic.log'), 'utf8')).toContain('native=exists=true kind=file')
    }
    writeFileSync(manifest, JSON.stringify({ schemaVersion: 1, files: [{ path: manifestPath, size: original.length - 1 }], modules: [] }))
    expect(inspect().status).not.toBe(0)
    expect(readFileSync(join(input.root, 'diagnostic.log'), 'utf8')).toContain(`native=exists=true kind=file bytes=${original.length}`)
    rmSync(file)
    const absent = inspect()
    expect(absent.status).not.toBe(0)
    expect(JSON.parse(absent.stdout.trim()).native).toBe('exists=false win32Error=2')
    expect(readFileSync(join(input.root, 'diagnostic.log'), 'utf8')).toContain('native=exists=false win32Error=2')
    untouchedOutside(input)
  }, 180_000)

  it('refuses reparse ancestors in the literal native metadata probe', () => {
    const input = fixture()
    const redirected = join(input.source, 'redirected')
    symlinkSync(input.outside, redirected, 'junction')
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', [
      '$ErrorActionPreference = "Stop"',
      '. (Join-Path $env:KUN_TEST_HELPERS "windows-installer-migration-payload-copy.ps1")',
      '[KunInstallerPayloadCopy]::InspectLiteralFile($env:KUN_TEST_FILE)'
    ].join('; ')], {
      encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, KUN_TEST_HELPERS: dirname(helper), KUN_TEST_FILE: join(redirected, 'sentinel.bin') }
    })
    rejected(result)
    untouchedOutside(input)
  })

  it.each(['invalid', 'native'] as const)('compiles copy, removal and bounded watchdog from a plugin directory containing a %s System.dll', (kind) => {
    const input = fixture()
    const pluginDirectory = join(input.root, 'NSIS plugins')
    mkdirSync(pluginDirectory)
    const collision = join(pluginDirectory, 'System.dll')
    if (kind === 'native') {
      copyFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'kernel32.dll'), collision)
    } else {
      writeFileSync(collision, 'deliberately not a managed assembly')
    }
    const collisionBytes = readFileSync(collision)
    const legacy = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
      '$ErrorActionPreference = "Stop"; Add-Type -TypeDefinition "public class KunDefaultReferenceProbe {}"'], {
      encoding: 'utf8', cwd: pluginDirectory, timeout: 60_000
    })
    expect(legacy.error).toBeUndefined()
    expect(legacy.status, `${legacy.stdout}\n${legacy.stderr}`).not.toBe(0)
    expect(`${legacy.stdout}\n${legacy.stderr}`).toMatch(/System\.dll/i)

    // Fresh hosts prove both production Add-Type sites work with the collision
    // still present. -Bounded compiles the watchdog before any helper modules.
    succeeded(run(input, 'BackupPayload', { cwd: pluginDirectory, bounded: true }))
    writeFileSync(join(input.source, 'resources', 'app.asar'), 'changed')
    succeeded(run(input, 'RestorePayloadBackup', { cwd: pluginDirectory, bounded: true }))
    expect(readFileSync(join(input.source, 'resources', 'app.asar'), 'utf8')).toBe('old asar')
    const remove = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', [
      '$ErrorActionPreference = "Stop"',
      '. (Join-Path $env:KUN_TEST_HELPERS "windows-installer-migration-paths.ps1")',
      '. (Join-Path $env:KUN_TEST_HELPERS "windows-installer-migration-filesystem.ps1")',
      '. (Join-Path $env:KUN_TEST_HELPERS "windows-installer-migration-payload-copy.ps1")',
      'Remove-RecoveryPayloadTree $env:KUN_TEST_BACKUP'
    ].join('; ')], {
      encoding: 'utf8', cwd: pluginDirectory, timeout: 60_000,
      env: { ...process.env, KUN_TEST_HELPERS: dirname(helper), KUN_TEST_BACKUP: input.backup }
    })
    succeeded(remove)
    expect(existsSync(input.backup)).toBe(false)
    expect(readFileSync(collision)).toEqual(collisionBytes)
    untouchedOutside(input)
  }, 240_000)

  it('uses the inbox Windows PowerShell 5.1 host', () => {
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
      '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toMatch(/^5\.1\./)
  })

  it('backs up and restores binary files and empty directories beyond MAX_PATH with Unicode and spaces', () => {
    const input = fixture()
    const relative = deepRelativePath()
    const sourceFile = put(input.source, relative)
    const backupFile = join(input.backup, relative)
    expect(sourceFile.length).toBeGreaterThan(260)
    expect(backupFile.length).toBeGreaterThan(260)
    const empty = join(dirname(relative), 'empty directory')
    mkdirSync(join(input.source, empty))
    put(input.source, 'user notes.txt', Buffer.from('preserve unrecognized payload entries'))

    succeeded(run(input, 'BackupPayload'))
    expect(readFileSync(backupFile)).toEqual(original)
    expect(readdirSync(join(input.backup, empty))).toEqual([])
    // Repeat with a populated long-path backup: replacement must not use the
    // PowerShell provider's MAX_PATH-limited recursive deletion either.
    writeFileSync(backupFile, 'stale backup')
    succeeded(run(input, 'BackupPayload'))
    expect(readFileSync(backupFile)).toEqual(original)
    rmSync(input.source, { recursive: true, force: true })
    succeeded(run(input, 'RestorePayloadBackup'))
    expect(readFileSync(sourceFile)).toEqual(original)
    expect(readFileSync(join(input.source, 'Kun.exe'), 'utf8')).toBe('old executable')
    expect(readFileSync(join(input.source, 'user notes.txt'), 'utf8')).toBe('preserve unrecognized payload entries')
    expect(readdirSync(join(input.source, empty))).toEqual([])
    expect(readFileSync(backupFile)).toEqual(original)
  }, 180_000)

  it.each(['BackupPayload', 'RestorePayloadBackup'] as const)(
    '%s rejects nested directory and file reparse points beyond MAX_PATH', (action) => {
      for (const kind of ['junction', 'file'] as const) {
        const input = fixture()
        if (action === 'RestorePayloadBackup') succeeded(run(input, 'BackupPayload'))
        const copySource = action === 'BackupPayload' ? input.source : input.backup
        const relative = deepRelativePath()
        const link = join(copySource, dirname(relative), 'redirected')
        mkdirSync(dirname(link), { recursive: true })
        expect(link.length).toBeGreaterThan(260)
        symlinkSync(kind === 'junction' ? input.outside : join(input.outside, 'sentinel.bin'), link, kind)
        rejected(run(input, action))
        untouchedOutside(input)
      }
    }, 180_000
  )

  it.each(['junction', 'file'] as const)('restore rejects an existing destination %s without following it', (kind) => {
    const input = fixture()
    const relative = deepRelativePath()
    put(input.source, relative)
    succeeded(run(input, 'BackupPayload'))
    const destination = kind === 'junction' ? dirname(join(input.source, relative)) : join(input.source, relative)
    rmSync(destination, { recursive: true, force: true })
    symlinkSync(kind === 'junction' ? input.outside : join(input.outside, 'sentinel.bin'), destination, kind)
    rejected(run(input, 'RestorePayloadBackup'))
    untouchedOutside(input)
  }, 120_000)

  it('rejects overlapping backup roots before modifying the installed payload', () => {
    for (const location of ['same', 'inside', 'ancestor']) {
      const input = fixture()
      input.backup = location === 'same' ? input.source : location === 'inside' ? join(input.source, 'backup') : input.root
      const result = run(input, 'BackupPayload')
      expect(result.status, result.stderr).not.toBe(0)
      expect(result.stderr).toContain('must not overlap')
      expect(readFileSync(join(input.source, 'Kun.exe'), 'utf8')).toBe('old executable')
      untouchedOutside(input)
    }
  }, 120_000)

  it.each(['root', 'ancestor'] as const)('backup rejects a redirected backup %s before removing outside files', (kind) => {
    const input = fixture()
    const destination = kind === 'root' ? input.backup : dirname(input.backup)
    mkdirSync(dirname(destination), { recursive: true })
    symlinkSync(input.outside, destination, 'junction')
    rejected(run(input, 'BackupPayload'))
    untouchedOutside(input)
    expect(existsSync(join(input.source, 'Kun.exe'))).toBe(true)
  })
})

type RollbackAction =
  | 'Prepare'
  | 'SwitchUpdatePayload'
  | 'RollbackUpdateTransaction'
  | 'RecoverUpdateTransaction'

function rollbackPayload(root: string, executable: string): void {
  put(root, join('resources', 'app.asar.unpacked', 'kun', 'dist', 'cli', 'serve-entry.js'), Buffer.from('cli'))
  put(root, join('resources', 'app.asar.unpacked', 'kun', 'dist', 'manager', 'manager-entry.js'), Buffer.from('manager'))
  writeFileSync(join(root, executable), 'executable')
  writeFileSync(join(root, 'resources', 'app.asar'), 'asar')
}

// Mirrors the production transaction roots: the old payload is a sibling named
// `<target>.kun-old-<pid>` and the failed candidate stays at `<target>.kun-failed`.
function rollbackFixture(inPlace = false) {
  const root = mkdtempSync(join(tmpdir(), `kun-rollback-${process.pid}-${inPlace ? 'in-place' : 'rename'}-`))
  roots.push(root)
  const source = join(root, inPlace ? 'Kun' : 'DeepSeek GUI')
  const target = inPlace ? source : join(root, 'Kun')
  const stage = `${target}.kun-stage`
  const recovery = join(root, 'recovery')
  const desktop = join(root, 'desktop')
  const programs = join(root, 'programs')
  for (const directory of [recovery, desktop, programs]) mkdirSync(directory, { recursive: true })
  rollbackPayload(source, inPlace ? 'Kun.exe' : 'DeepSeek GUI.exe')
  writeFileSync(join(source, 'notes.txt'), 'preserved user file')
  return {
    source, target, stage, recovery, desktop, programs,
    backup: join(recovery, 'payload'),
    journal: join(recovery, 'journal.json'),
    transaction: join(recovery, 'transaction.json'),
    diagnostic: join(recovery, 'diagnostic.log'),
    health: join(root, 'health.json'),
    result: (action: RollbackAction) => join(recovery, `result-${action}.txt`)
  }
}

type RollbackFixture = ReturnType<typeof rollbackFixture>

function runRollback(input: RollbackFixture, action: RollbackAction, fault = '') {
  return spawnSync(powershell, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
    '-Action', action, '-ResultPath', input.result(action)
  ], {
    encoding: 'utf8', timeout: 180_000,
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
      KUN_INSTALLER_APP_GUID: 'rollback-regression-guid',
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
      KUN_INSTALLER_INSTALL_REGISTRY_KEY: 'Software\\KunInstallerRollbackTest\\Install',
      KUN_INSTALLER_UNINSTALL_REGISTRY_KEY: 'Software\\KunInstallerRollbackTest\\Uninstall',
      KUN_INSTALLER_FAULT_INJECTION: fault ? '1' : '0',
      KUN_INSTALLER_FAULT_POINT: fault
    }
  })
}

function failedRollback(result: ReturnType<typeof runRollback>): string {
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.signal, result.stderr).toBeNull()
  expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0)
  return `${result.stdout}\n${result.stderr}`
}

function readTransaction(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>
}

windowsOnly('Windows automatic-update rollback leaves no candidate residue', () => {
  afterEach(() => {
    spawnSync(powershell, [
      '-NoProfile', '-NonInteractive', '-Command',
      "Remove-Item -LiteralPath 'HKCU:\\Software\\KunInstallerRollbackTest' -Recurse -Force -ErrorAction SilentlyContinue"
    ])
  })

  it('restores the renamed install and drops candidate-only files', () => {
    const input = rollbackFixture()
    writeFileSync(join(input.source, 'user-settings.json'), '{"theme":"dark"}')
    succeeded(runRollback(input, 'Prepare'))
    rollbackPayload(input.stage, 'Kun.exe')
    writeFileSync(join(input.stage, 'candidate-only.txt'), 'candidate only')
    writeFileSync(join(input.stage, 'resources', 'app.asar'), 'candidate asar')
    succeeded(runRollback(input, 'SwitchUpdatePayload'))
    expect(readFileSync(join(input.target, 'candidate-only.txt'), 'utf8')).toBe('candidate only')

    succeeded(runRollback(input, 'RollbackUpdateTransaction'))

    expect(existsSync(input.target)).toBe(false)
    expect(existsSync(`${input.target}.kun-failed`)).toBe(false)
    expect(readdirSync(input.source).sort()).toEqual([
      'resources', 'DeepSeek GUI.exe', 'notes.txt', 'user-settings.json'
    ].sort())
    expect(readFileSync(join(input.source, 'resources', 'app.asar'), 'utf8')).toBe('asar')
    expect(readFileSync(join(input.source, 'notes.txt'), 'utf8')).toBe('preserved user file')
    expect(readFileSync(join(input.source, 'user-settings.json'), 'utf8')).toBe('{"theme":"dark"}')
    expect(readTransaction(input.transaction)).toMatchObject({
      Phase: 'rolled_back',
      RollbackOutcome: 'succeeded'
    })
  }, 120_000)

  it('restores an in-place install without leaving the candidate executable or extra files', () => {
    const input = rollbackFixture(true)
    writeFileSync(join(input.source, 'user-settings.json'), '{"theme":"dark"}')
    succeeded(runRollback(input, 'Prepare'))
    rollbackPayload(input.stage, 'Kun.exe')
    writeFileSync(join(input.stage, 'Kun.exe'), 'candidate executable')
    writeFileSync(join(input.stage, 'candidate-only.txt'), 'candidate only')
    succeeded(runRollback(input, 'SwitchUpdatePayload'))
    expect(readFileSync(join(input.target, 'Kun.exe'), 'utf8')).toBe('candidate executable')

    succeeded(runRollback(input, 'RollbackUpdateTransaction'))

    expect(readFileSync(join(input.source, 'Kun.exe'), 'utf8')).toBe('executable')
    expect(readFileSync(join(input.source, 'resources', 'app.asar'), 'utf8')).toBe('asar')
    expect(readFileSync(join(input.source, 'notes.txt'), 'utf8')).toBe('preserved user file')
    expect(readFileSync(join(input.source, 'user-settings.json'), 'utf8')).toBe('{"theme":"dark"}')
    expect(existsSync(join(input.source, 'candidate-only.txt'))).toBe(false)
    expect(existsSync(`${input.target}.kun-failed`)).toBe(false)
    expect(readTransaction(input.transaction)).toMatchObject({
      Phase: 'rolled_back',
      RollbackOutcome: 'succeeded'
    })
  }, 120_000)

  it('records rollback_incomplete, keeps recovery material, and can retry after the conflict is repaired', () => {
    const input = rollbackFixture(true)
    succeeded(runRollback(input, 'Prepare'))
    rollbackPayload(input.stage, 'Kun.exe')
    writeFileSync(join(input.stage, 'candidate-only.txt'), 'candidate only')
    succeeded(runRollback(input, 'SwitchUpdatePayload'))
    // Turn the backed-up app.asar into a directory so restoring the backup over
    // the moved-aside payload fails with a real file/directory conflict.
    const oldAsar = join(`${input.target}.kun-old-${process.pid}`, 'resources', 'app.asar')
    rmSync(oldAsar, { force: true })
    mkdirSync(oldAsar, { recursive: true })

    const output = failedRollback(runRollback(input, 'RollbackUpdateTransaction'))
    expect(output).toContain('Payload file conflicts with directory')
    const state = readTransaction(input.transaction)
    expect(state).toMatchObject({ Phase: 'rollback_incomplete', RollbackOutcome: 'failed' })
    expect(String(state.RollbackError)).toContain('Payload file conflicts with directory')
    // Recovery material must survive a failed rollback so a retry is possible.
    expect(existsSync(input.backup)).toBe(true)
    expect(readFileSync(join(input.backup, 'Kun.exe'), 'utf8')).toBe('executable')
    expect(existsSync(`${input.target}.kun-failed`)).toBe(true)

    rmSync(join(input.target, 'resources', 'app.asar'), { recursive: true, force: true })
    succeeded(runRollback(input, 'RecoverUpdateTransaction'))

    expect(readTransaction(input.transaction)).toMatchObject({
      Phase: 'rolled_back',
      RollbackOutcome: 'succeeded'
    })
    expect(readFileSync(join(input.source, 'Kun.exe'), 'utf8')).toBe('executable')
    expect(readFileSync(join(input.source, 'resources', 'app.asar'), 'utf8')).toBe('asar')
    expect(existsSync(join(input.source, 'candidate-only.txt'))).toBe(false)
    expect(existsSync(`${input.target}.kun-failed`)).toBe(false)
  }, 180_000)

  it('recovers a switch interrupted after cutover and removes the candidate payload', () => {
    const input = rollbackFixture(true)
    succeeded(runRollback(input, 'Prepare'))
    rollbackPayload(input.stage, 'Kun.exe')
    writeFileSync(join(input.stage, 'Kun.exe'), 'candidate executable')
    writeFileSync(join(input.stage, 'candidate-only.txt'), 'candidate only')

    const output = failedRollback(
      runRollback(input, 'SwitchUpdatePayload', 'switch.after_payload_switched')
    )
    expect(output).toContain('KUN_INSTALLER_FAULT_INJECTION:switch.after_payload_switched')
    expect(readTransaction(input.transaction)).toMatchObject({ Phase: 'payload_switched' })
    expect(existsSync(join(input.target, 'candidate-only.txt'))).toBe(true)

    succeeded(runRollback(input, 'RecoverUpdateTransaction'))

    expect(readTransaction(input.transaction)).toMatchObject({
      Phase: 'rolled_back',
      RollbackOutcome: 'succeeded'
    })
    expect(readFileSync(join(input.source, 'Kun.exe'), 'utf8')).toBe('executable')
    expect(readFileSync(join(input.source, 'notes.txt'), 'utf8')).toBe('preserved user file')
    expect(existsSync(join(input.source, 'candidate-only.txt'))).toBe(false)
    expect(existsSync(`${input.target}.kun-failed`)).toBe(false)
  }, 120_000)
})
