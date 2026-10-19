import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
function run(input: Fixture, action: Action) {
  return spawnSync(powershell, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
    '-Action', action, '-ResultPath', join(input.root, `${action}.txt`)
  ], {
    encoding: 'utf8', timeout: 60_000,
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
