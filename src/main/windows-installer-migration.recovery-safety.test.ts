import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const helperPath = join(process.cwd(), 'build/windows-installer-migration.ps1')
const helperModulePaths = [
  'windows-installer-migration-paths.ps1',
  'windows-installer-migration-journal.ps1',
  'windows-installer-migration-filesystem.ps1',
  'windows-installer-migration-actions.ps1',
  'windows-installer-migration-recovery-env.ps1'
].map((fileName) => join(process.cwd(), 'build', fileName))
const windowsOnly = process.platform === 'win32' ? describe : describe.skip
const tempRoots: string[] = []

function readHelperSources(): string {
  return [helperPath, ...helperModulePaths]
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n')
}

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'kun-installer-migration-'))
  tempRoots.push(root)
  return root
}

function runHelper(input: {
  action: 'ResolvePath' | 'ResolveSource' | 'ResolveUpdateScope' | 'Recover' | 'Prepare' | 'FallbackCleanup' | 'Restore' | 'ValidatePayload' | 'CleanupInPlaceLeftovers'
  source?: string
  secondary?: string
  currentUserSource?: string
  currentUserUninstallCommand?: string
  allUsersSource?: string
  allUsersUninstallCommand?: string
  updateSource?: string
  candidate?: string
  candidateExplicit?: boolean
  target?: string
  journal?: string
  resultPath?: string
  uninstallCommand?: string
  scriptPath?: string
  userProfile?: string
  primarySourceStale?: boolean
  secondarySourceStale?: boolean
  inPlaceUpdate?: boolean
  installMode?: 'CurrentUser' | 'all'
  appGuid?: string
  canonicalLeaf?: string
  appExecutable?: string
  productName?: string
}) {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const resultPath = input.resultPath ??
    (input.scriptPath ? undefined : join(makeTempRoot(), 'resolver-result.txt'))
  return spawnSync(
    powershell,
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      input.scriptPath ?? helperPath,
      '-Action',
      input.action,
      ...(resultPath ? ['-ResultPath', resultPath] : [])
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...(input.userProfile ? { USERPROFILE: input.userProfile } : {}),
        KUN_INSTALLER_SOURCE: input.source ?? '',
        KUN_INSTALLER_SECONDARY_SOURCE: input.secondary ?? '',
        KUN_INSTALLER_CURRENT_USER_SOURCE: input.currentUserSource ?? '',
        KUN_INSTALLER_CURRENT_USER_UNINSTALL_STRING: input.currentUserUninstallCommand ?? '',
        KUN_INSTALLER_ALL_USERS_SOURCE: input.allUsersSource ?? '',
        KUN_INSTALLER_ALL_USERS_UNINSTALL_STRING: input.allUsersUninstallCommand ?? '',
        KUN_INSTALLER_UPDATE_SOURCE: input.updateSource ?? '',
        KUN_INSTALLER_CANDIDATE: input.candidate ?? '',
        KUN_INSTALLER_CANDIDATE_EXPLICIT: input.candidateExplicit ? '1' : '0',
        KUN_INSTALLER_TARGET: input.target ?? '',
        KUN_INSTALLER_JOURNAL: input.journal ?? join(makeTempRoot(), 'journal.json'),
        KUN_INSTALLER_UNINSTALL_STRING: input.uninstallCommand ?? '',
        KUN_INSTALLER_PRIMARY_SOURCE_STALE: input.primarySourceStale ? '1' : '0',
        KUN_INSTALLER_SECONDARY_SOURCE_STALE: input.secondarySourceStale ? '1' : '0',
        KUN_INSTALLER_IN_PLACE_UPDATE: input.inPlaceUpdate ? '1' : '0',
        KUN_INSTALLER_INSTALL_MODE: input.installMode ?? 'CurrentUser',
        KUN_INSTALLER_APP_GUID: input.appGuid ?? 'test-kun-app-guid',
        KUN_INSTALLER_CANONICAL_LEAF: input.canonicalLeaf ?? 'Kun',
        KUN_INSTALLER_APP_EXECUTABLE: input.appExecutable ?? 'Kun.exe',
        KUN_INSTALLER_PRODUCT_NAME: input.productName ?? 'Kun',
        KUN_INSTALLER_SELF_PID: String(process.pid),
        KUN_INSTALLER_SELF_PATH: ''
      }
    }
  )
}

function processError(result: ReturnType<typeof runHelper>): string {
  return String(result.stderr ?? '')
}

function unavailableDriveTarget(): string {
  for (let code = 'Z'.charCodeAt(0); code >= 'P'.charCodeAt(0); code -= 1) {
    const root = `${String.fromCharCode(code)}:\\`
    if (!existsSync(root)) return `${root}Kun`
  }
  throw new Error('No unavailable drive letter was available for the installer helper test.')
}

function readJournal(path: string): { Records: Array<{ Stash: string }> } {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as {
    Records: Array<{ Stash: string }>
  }
}

function writePackagedInstallPayload(root: string, executable = 'Kun.exe') {
  writeFileSync(join(root, executable), 'application executable')
  const resources = join(root, 'resources')
  mkdirSync(join(resources, 'app.asar.unpacked', 'kun', 'dist', 'cli'), { recursive: true })
  writeFileSync(join(resources, 'app.asar'), 'packaged application')
  writeFileSync(
    join(resources, 'app.asar.unpacked', 'kun', 'dist', 'cli', 'serve-entry.js'),
    'runtime entry'
  )
  mkdirSync(join(resources, 'app.asar.unpacked', 'kun', 'dist', 'manager'), { recursive: true })
  writeFileSync(
    join(resources, 'app.asar.unpacked', 'kun', 'dist', 'manager', 'manager-entry.js'),
    'service manager entry'
  )
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

windowsOnly('Windows installer migration helper', () => {
it('preserves unknown top-level content and restores it after fallback cleanup', () => {
    const root = makeTempRoot()
    const source = join(root, 'DeepSeek GUI')
    const target = join(root, 'Kun')
    const journal = join(root, 'recovery', 'journal.json')
    mkdirSync(join(source, 'resources'), { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'app')
    writeFileSync(join(source, 'notes.txt'), 'keep me')

    const prepared = runHelper({ action: 'Prepare', source, target, journal })
    expect(prepared.status, processError(prepared)).toBe(0)
    expect(existsSync(join(source, 'notes.txt'))).toBe(false)
    expect(existsSync(join(source, 'Kun.exe'))).toBe(true)

    const journalData = readJournal(journal)
    expect(readFileSync(join(journalData.Records[0].Stash, 'content', 'notes.txt'), 'utf8')).toBe(
      'keep me'
    )

    // Manual overwrite owns the allowlisted cleanup; no old uninstaller runs first.
    const cleaned = runHelper({ action: 'FallbackCleanup', source, target, journal })
    expect(cleaned.status, processError(cleaned)).toBe(0)
    expect(existsSync(join(source, 'Kun.exe'))).toBe(false)

    const restored = runHelper({ action: 'Restore', source, target, journal })
    expect(restored.status, processError(restored)).toBe(0)
    expect(readFileSync(join(source, 'notes.txt'), 'utf8')).toBe('keep me')
    expect(existsSync(journal)).toBe(false)
  }, 15_000)

  it('authorizes fallback cleanup for a validated source without unknown content', () => {
    const root = makeTempRoot()
    const source = join(root, 'DeepSeek GUI')
    const target = join(root, 'Kun')
    const journal = join(root, 'recovery', 'journal.json')
    mkdirSync(join(source, 'resources'), { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'app')

    const prepared = runHelper({ action: 'Prepare', source, target, journal })
    expect(prepared.status, processError(prepared)).toBe(0)
    expect(existsSync(journal)).toBe(true)

    // The validated preparation record authorizes direct allowlisted cleanup.
    const cleaned = runHelper({ action: 'FallbackCleanup', source, target, journal })
    expect(cleaned.status, processError(cleaned)).toBe(0)
    expect(existsSync(source)).toBe(false)

    const restored = runHelper({ action: 'Restore', source, target, journal })
    expect(restored.status, processError(restored)).toBe(0)
    expect(existsSync(journal)).toBe(false)
  })

  it('recovers an interrupted preservation journal idempotently', () => {
    const root = makeTempRoot()
    const source = join(root, 'Custom Install')
    const journal = join(root, 'recovery', 'journal.json')
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'app')
    writeFileSync(join(source, 'personal.txt'), 'personal')

    const prepared = runHelper({ action: 'Prepare', source, target: source, journal })
    expect(prepared.status, processError(prepared)).toBe(0)
    expect(existsSync(join(source, 'personal.txt'))).toBe(false)

    const firstRecovery = runHelper({ action: 'Recover', source, target: source, journal })
    expect(firstRecovery.status, processError(firstRecovery)).toBe(0)
    expect(readFileSync(join(source, 'personal.txt'), 'utf8')).toBe('personal')

    const secondRecovery = runHelper({ action: 'Recover', source, target: source, journal })
    expect(secondRecovery.status, processError(secondRecovery)).toBe(0)
    expect(readdirSync(source).sort()).toEqual(['Kun.exe', 'personal.txt'])
  })

  it('rejects a recovery journal whose application identity was changed', () => {
    const root = makeTempRoot()
    const source = join(root, 'Custom Install')
    const journal = join(root, 'recovery', 'journal.json')
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'app')
    writeFileSync(join(source, 'personal.txt'), 'personal')

    const prepared = runHelper({ action: 'Prepare', source, target: source, journal })
    expect(prepared.status, processError(prepared)).toBe(0)
    const journalData = JSON.parse(readFileSync(journal, 'utf8').replace(/^\uFEFF/, '')) as {
      AppGuid: string
      Records: Array<{ Stash: string }>
    }
    journalData.AppGuid = 'other-app-guid'
    writeFileSync(journal, JSON.stringify(journalData, null, 2), 'utf8')

    const recovery = runHelper({ action: 'Recover', source, target: source, journal })

    expect(recovery.status).not.toBe(0)
    expect(processError(recovery)).toContain('application identity does not match')
    expect(existsSync(join(source, 'personal.txt'))).toBe(false)
    expect(readFileSync(join(journalData.Records[0].Stash, 'content', 'personal.txt'), 'utf8'))
      .toBe('personal')
  })

  it('quarantines an existing journal under a cross-user-writable directory', () => {
    const root = makeTempRoot()
    const source = join(root, 'Kun')
    const recoveryDirectory = join(root, 'recovery')
    const journal = join(recoveryDirectory, 'journal.json')
    mkdirSync(source, { recursive: true })
    mkdirSync(recoveryDirectory, { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'app')
    writeFileSync(join(source, 'personal.txt'), 'do not move')
    writeFileSync(journal, JSON.stringify({
      SchemaVersion: 3,
      AppGuid: 'test-kun-app-guid',
      InstallMode: 'current',
      Target: source,
      Records: []
    }), 'utf8')
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    const icacls = spawnSync(
      join(systemRoot, 'System32', 'icacls.exe'),
      [recoveryDirectory, '/inheritance:r', '/grant:r', '*S-1-1-0:(OI)(CI)F'],
      { encoding: 'utf8' }
    )
    expect(icacls.status, String(icacls.stderr ?? '')).toBe(0)

    const recovery = runHelper({ action: 'Recover', source, target: source, journal })

    expect(recovery.status, processError(recovery)).toBe(0)
    expect(existsSync(journal)).toBe(false)
    expect(readdirSync(recoveryDirectory).filter((name) =>
      /^journal\.json\.untrusted-[a-f0-9]{32}$/u.test(name)
    )).toHaveLength(1)
    expect(readFileSync(join(source, 'personal.txt'), 'utf8')).toBe('do not move')
  })

  it('preserves registered per-user content alongside an all-users source', () => {
    const root = makeTempRoot()
    const source = join(root, 'Machine Kun')
    const secondary = join(root, 'User Kun')
    const journal = join(root, 'recovery', 'journal.json')
    for (const directory of [source, secondary]) {
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, 'Kun.exe'), 'app')
      writeFileSync(join(directory, 'personal.txt'), directory)
    }

    const result = runHelper({
      action: 'Prepare',
      source,
      target: source,
      journal,
      secondary,
      userProfile: root
    })
    expect(result.status, processError(result)).toBe(0)
    expect(existsSync(join(source, 'personal.txt'))).toBe(false)
    expect(existsSync(join(secondary, 'personal.txt'))).toBe(false)

    const restored = runHelper({
      action: 'Restore', source, target: source, journal, secondary, userProfile: root
    })
    expect(restored.status, processError(restored)).toBe(0)
    expect(readFileSync(join(source, 'personal.txt'), 'utf8')).toBe(source)
    expect(readFileSync(join(secondary, 'personal.txt'), 'utf8')).toBe(secondary)
  })

  it('preserves a verified external current-user installation during all-users migration', () => {
    const root = makeTempRoot()
    const userProfile = join(root, 'profile')
    const source = join(root, 'Machine Kun')
    const secondary = join(root, 'external-drive', 'Kun')
    const journal = join(root, 'recovery', 'journal.json')
    mkdirSync(userProfile, { recursive: true })
    for (const directory of [source, secondary]) {
      mkdirSync(join(directory, 'resources'), { recursive: true })
      writeFileSync(join(directory, 'Kun.exe'), 'app')
    }
    writeFileSync(join(secondary, 'resources', 'app.asar'), 'packaged app')
    writeFileSync(join(secondary, 'personal.txt'), 'keep external content')

    const prepared = runHelper({
      action: 'Prepare', source, target: source, journal, secondary, userProfile
    })

    expect(prepared.status, processError(prepared)).toBe(0)
    expect(existsSync(join(secondary, 'personal.txt'))).toBe(false)
    expect(readFileSync(join(secondary, 'resources', 'app.asar'), 'utf8')).toBe('packaged app')

    const restored = runHelper({
      action: 'Restore', source, target: source, journal, secondary, userProfile
    })
    expect(restored.status, processError(restored)).toBe(0)
    expect(readFileSync(join(secondary, 'personal.txt'), 'utf8')).toBe('keep external content')
    expect(existsSync(journal)).toBe(false)
  })

  it('rejects a misleading external current-user source without packaged payload', () => {
    const root = makeTempRoot()
    const userProfile = join(root, 'profile')
    const source = join(root, 'Machine Kun')
    const secondary = join(root, 'other-app')
    const journal = join(root, 'recovery', 'journal.json')
    mkdirSync(userProfile, { recursive: true })
    for (const directory of [source, secondary]) {
      mkdirSync(join(directory, 'resources'), { recursive: true })
      writeFileSync(join(directory, 'Kun.exe'), 'app')
      writeFileSync(join(directory, 'resources', 'keep.txt'), 'keep')
    }

    const result = runHelper({
      action: 'Prepare', source, target: source, journal, secondary, userProfile
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('not a recognized packaged Kun installation')
    expect(readFileSync(join(secondary, 'resources', 'keep.txt'), 'utf8')).toBe('keep')
    expect(existsSync(journal)).toBe(false)
  })

  it('rejects a verified-looking external secondary source reached through a reparse point', () => {
    const root = makeTempRoot()
    const userProfile = join(root, 'profile')
    const source = join(root, 'Machine Kun')
    const externalBacking = join(root, 'external-backing')
    const secondary = join(root, 'external-link')
    const journal = join(root, 'recovery', 'journal.json')
    mkdirSync(userProfile, { recursive: true })
    mkdirSync(join(source, 'resources'), { recursive: true })
    mkdirSync(join(externalBacking, 'resources'), { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'app')
    writeFileSync(join(externalBacking, 'Kun.exe'), 'app')
    writeFileSync(join(externalBacking, 'resources', 'app.asar'), 'packaged app')
    symlinkSync(externalBacking, secondary, 'junction')

    const result = runHelper({
      action: 'Prepare', source, target: source, journal, secondary, userProfile
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('path contains a reparse point')
    expect(readFileSync(join(externalBacking, 'resources', 'app.asar'), 'utf8')).toBe('packaged app')
    expect(existsSync(journal)).toBe(false)
  })

  it('ignores a missing stale external current-user source during migration', () => {
    const root = makeTempRoot()
    const userProfile = join(root, 'profile')
    const source = join(root, 'Machine Kun')
    const secondary = join(root, 'missing-drive', 'Kun')
    const journal = join(root, 'recovery', 'journal.json')
    const resultPath = join(root, 'prepare-result.txt')
    mkdirSync(userProfile, { recursive: true })
    mkdirSync(join(source, 'resources'), { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'app')

    const prepared = runHelper({
      action: 'Prepare', source, target: source, journal, secondary, userProfile, resultPath
    })
    expect(prepared.status, processError(prepared)).toBe(0)
    expect(readFileSync(resultPath, 'utf16le')).toBe('2')
    expect(existsSync(secondary)).toBe(false)

    const restored = runHelper({
      action: 'Restore', source, target: source, journal, secondary, userProfile
    })
    expect(restored.status, processError(restored)).toBe(0)
    expect(existsSync(journal)).toBe(false)
  })

  it('rejects fallback cleanup when the source does not match its preservation journal', () => {
    const root = makeTempRoot()
    const source = join(root, 'DeepSeek GUI')
    const other = join(root, 'Other Electron App')
    const target = join(root, 'Kun')
    const journal = join(root, 'recovery', 'journal.json')
    mkdirSync(source, { recursive: true })
    mkdirSync(join(other, 'resources'), { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'app')
    writeFileSync(join(source, 'notes.txt'), 'keep')
    writeFileSync(join(other, 'resources', 'keep.txt'), 'keep')

    const prepared = runHelper({ action: 'Prepare', source, target, journal })
    expect(prepared.status, processError(prepared)).toBe(0)
    const result = runHelper({ action: 'FallbackCleanup', source: other, target, journal })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('does not match the preservation journal')
    expect(readFileSync(join(other, 'resources', 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('rejects fallback cleanup without an application identity executable', () => {
    const root = makeTempRoot()
    const source = join(root, 'Other Electron App')
    const journal = join(root, 'recovery', 'journal.json')
    mkdirSync(join(source, 'resources'), { recursive: true })
    writeFileSync(join(source, 'resources', 'keep.txt'), 'keep')

    const result = runHelper({ action: 'FallbackCleanup', source, target: source, journal })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('no application identity executable')
    expect(readFileSync(join(source, 'resources', 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('retains the recovery directory and journal when restoration would overwrite a file', () => {
    const root = makeTempRoot()
    const source = join(root, 'Custom Install')
    const journal = join(root, 'recovery', 'journal.json')
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'app')
    writeFileSync(join(source, 'personal.txt'), 'original')

    const prepared = runHelper({ action: 'Prepare', source, target: source, journal })
    expect(prepared.status, processError(prepared)).toBe(0)
    writeFileSync(join(source, 'personal.txt'), 'conflict')

    const restored = runHelper({ action: 'Restore', source, target: source, journal })
    expect(restored.status).not.toBe(0)
    expect(restored.stderr).toContain('conflicts with existing paths')
    expect(readFileSync(join(source, 'personal.txt'), 'utf8')).toBe('conflict')
    expect(existsSync(journal)).toBe(true)
    const journalData = readJournal(journal)
    expect(readFileSync(join(journalData.Records[0].Stash, 'content', 'personal.txt'), 'utf8')).toBe(
      'original'
    )
  })

  it('rejects a non-empty conflicting canonical target without changing either install', () => {
    const root = makeTempRoot()
    const source = join(root, 'DeepSeek GUI')
    const target = join(root, 'Kun')
    const journal = join(root, 'recovery', 'journal.json')
    mkdirSync(source, { recursive: true })
    mkdirSync(target, { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'legacy')
    writeFileSync(join(target, 'occupied.txt'), 'occupied')

    const result = runHelper({ action: 'Prepare', source, target, journal })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('cannot be merged safely')
    expect(readFileSync(join(source, 'Kun.exe'), 'utf8')).toBe('legacy')
    expect(readFileSync(join(target, 'occupied.txt'), 'utf8')).toBe('occupied')
    expect(existsSync(journal)).toBe(false)
  })

  it('rejects recognized application directory reparse points before migration prepare', () => {
    const root = makeTempRoot()
    const source = join(root, 'Kun')
    const externalResources = join(root, 'external-resources')
    const journal = join(root, 'recovery', 'journal.json')
    mkdirSync(source, { recursive: true })
    mkdirSync(externalResources, { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'app')
    writeFileSync(join(externalResources, 'keep.txt'), 'keep')
    symlinkSync(externalResources, join(source, 'resources'), 'junction')

    const result = runHelper({ action: 'Prepare', source, target: source, journal })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Recognized application directory contains a reparse point')
    expect(readFileSync(join(source, 'Kun.exe'), 'utf8')).toBe('app')
    expect(readFileSync(join(externalResources, 'keep.txt'), 'utf8')).toBe('keep')
    expect(existsSync(journal)).toBe(false)
  })

  it('rejects nested reparse points inside recognized application directories', () => {
    const root = makeTempRoot()
    const source = join(root, 'Kun')
    const resources = join(source, 'resources')
    const externalResources = join(root, 'external-nested')
    const journal = join(root, 'recovery', 'journal.json')
    mkdirSync(resources, { recursive: true })
    mkdirSync(externalResources, { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'app')
    writeFileSync(join(externalResources, 'keep.txt'), 'keep')
    symlinkSync(externalResources, join(resources, 'nested-link'), 'junction')

    const result = runHelper({ action: 'Prepare', source, target: source, journal })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Recognized application directory contains a reparse point')
    expect(readFileSync(join(source, 'Kun.exe'), 'utf8')).toBe('app')
    expect(readFileSync(join(externalResources, 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('rejects install roots below a reparse-point ancestor', () => {
    const root = makeTempRoot()
    const externalParent = join(root, 'external-parent')
    const linkedParent = join(root, 'linked-parent')
    const source = join(linkedParent, 'Kun')
    const journal = join(root, 'recovery', 'journal.json')
    mkdirSync(join(externalParent, 'Kun'), { recursive: true })
    writeFileSync(join(externalParent, 'Kun', 'Kun.exe'), 'app')
    symlinkSync(externalParent, linkedParent, 'junction')

    const result = runHelper({ action: 'Prepare', source, target: source, journal })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('path contains a reparse point')
    expect(readFileSync(join(externalParent, 'Kun', 'Kun.exe'), 'utf8')).toBe('app')
  })

  it('rejects recognized application directories that are reparse points during cleanup', () => {
    const root = makeTempRoot()
    const source = join(root, 'Kun')
    const externalResources = join(root, 'external-resources')
    const journal = join(root, 'recovery', 'journal.json')
    mkdirSync(source, { recursive: true })
    mkdirSync(externalResources, { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'app')
    writeFileSync(join(externalResources, 'keep.txt'), 'keep')
    symlinkSync(externalResources, join(source, 'resources'), 'junction')

    const result = runHelper({ action: 'FallbackCleanup', source, target: source, journal })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Recognized application directory contains a reparse point')
    expect(readFileSync(join(externalResources, 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('rejects protected roots and reparse-point install roots', () => {
    const root = makeTempRoot()
    const journal = join(root, 'recovery', 'journal.json')
    const protectedResult = runHelper({
      action: 'Prepare',
      target: process.env.LOCALAPPDATA,
      journal
    })
    expect(protectedResult.status).not.toBe(0)
    expect(protectedResult.stderr).toContain('shared or protected root')

    const volumeRootResult = runHelper({
      action: 'Prepare',
      target: parse(root).root,
      journal
    })
    expect(volumeRootResult.status).not.toBe(0)

    const realSource = join(root, 'real-source')
    const linkedSource = join(root, 'linked-source')
    const target = join(root, 'Kun')
    mkdirSync(realSource, { recursive: true })
    writeFileSync(join(realSource, 'Kun.exe'), 'app')
    symlinkSync(realSource, linkedSource, 'junction')

    const linkedResult = runHelper({ action: 'Prepare', source: linkedSource, target, journal })
    expect(linkedResult.status).not.toBe(0)
    expect(linkedResult.stderr).toContain('reparse point')
    expect(readFileSync(join(realSource, 'Kun.exe'), 'utf8')).toBe('app')
  })
})
