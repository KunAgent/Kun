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
  'windows-installer-migration-recovery-env.ps1',
  'windows-installer-migration-transaction.ps1'
].map((fileName) => join(process.cwd(), 'build', fileName))
const smokePath = join(process.cwd(), 'scripts/smoke-windows-installer-migration.ps1')
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
  selfPath?: string
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
        KUN_INSTALLER_SELF_PATH: input.selfPath ?? ''
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
it('lets an explicit target override a registered legacy branded source', () => {
    const root = makeTempRoot()
    const source = join(root, 'Legacy', 'DeepSeek GUI')
    const candidate = join(root, 'Chosen Apps')
    mkdirSync(source, { recursive: true })
    mkdirSync(candidate, { recursive: true })
    const canonicalCandidate = realpathSync.native(candidate)
    const resultPath = join(root, 'resolved-path.txt')
    const result = runHelper({
      action: 'ResolvePath',
      source,
      candidate,
      candidateExplicit: true,
      resultPath
    })

    expect(result.status, processError(result)).toBe(0)
    expect(readFileSync(resultPath, 'utf16le')).toBe(join(canonicalCandidate, 'Kun'))
  })

  it('uses development-flavor identity without appending or cleaning production Kun', () => {
    const root = makeTempRoot()
    const candidate = join(root, 'kun-dv')
    mkdirSync(candidate, { recursive: true })
    const resultPath = join(root, 'resolved-path.txt')
    const result = runHelper({
      action: 'ResolvePath',
      candidate,
      resultPath,
      canonicalLeaf: 'kun-dv',
      appExecutable: 'kun-dv.exe',
      productName: 'kun-dv'
    })

    expect(result.status, processError(result)).toBe(0)
    expect(readFileSync(resultPath, 'utf16le')).toBe(realpathSync.native(candidate))
  })

  it('writes a recovered install source to the explicit result path', () => {
    const root = makeTempRoot()
    const source = join(root, 'DeepSeek GUI')
    const resultPath = join(root, 'resolved-source.txt')
    mkdirSync(source, { recursive: true })
    const canonicalSource = realpathSync.native(source)
    const result = runHelper({
      action: 'ResolveSource',
      resultPath,
      uninstallCommand: `"${join(source, 'Uninstall Kun.exe')}" /currentuser`
    })

    expect(result.status, processError(result)).toBe(0)
    expect(result.stdout).toBe(canonicalSource)
    expect(readFileSync(resultPath, 'utf16le')).toBe(canonicalSource)
  })

  it('ignores a malformed install location when the uninstall command identifies a verified source', () => {
    const root = makeTempRoot()
    const source = join(root, 'Kun')
    const resultPath = join(root, 'resolved-source.txt')
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'app')
    writeFileSync(join(source, 'Uninstall Kun.exe'), 'uninstaller')

    const result = runHelper({
      action: 'ResolveSource',
      source: 'not-an-absolute-path',
      uninstallCommand: `"${join(source, 'Uninstall Kun.exe')}" /currentuser`,
      resultPath
    })

    expect(result.status, processError(result)).toBe(0)
    expect(readFileSync(resultPath, 'utf16le')).toBe(realpathSync.native(source))
  })

  it('selects the automatic-update scope that owns the running executable', () => {
    const root = makeTempRoot()
    const current = join(root, 'current', 'Kun')
    const all = join(root, 'all', 'Kun')
    const resultPath = join(root, 'scope.txt')
    mkdirSync(current, { recursive: true })
    mkdirSync(all, { recursive: true })
    writeFileSync(join(current, 'Kun.exe'), 'current app')
    writeFileSync(join(all, 'Kun.exe'), 'all-users app')

    const result = runHelper({
      action: 'ResolveUpdateScope',
      currentUserSource: current,
      allUsersSource: all,
      updateSource: all,
      resultPath
    })

    expect(result.status, processError(result)).toBe(0)
    expect(readFileSync(resultPath, 'utf16le')).toBe('all')
  })

  it('rejects an ambiguous automatic-update source', () => {
    const root = makeTempRoot()
    const source = join(root, 'Kun')
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'app')

    const result = runHelper({
      action: 'ResolveUpdateScope',
      currentUserSource: source,
      allUsersSource: source,
      updateSource: source
    })

    expect(result.status).not.toBe(0)
    expect(processError(result)).toContain('exactly one verified Kun registration')
  })

  it('writes resolver output beside the helper without cross-process result state', () => {
    const root = makeTempRoot()
    const copiedHelper = join(root, 'migration.ps1')
    const source = join(root, 'DeepSeek GUI')
    const resultPath = join(root, 'kun-windows-installer-result.txt')
    mkdirSync(source, { recursive: true })
    copyFileSync(helperPath, copiedHelper)
    for (const modulePath of helperModulePaths) {
      copyFileSync(modulePath, join(root, parse(modulePath).base))
    }
    const canonicalSource = realpathSync.native(source)

    const result = runHelper({
      action: 'ResolveSource',
      scriptPath: copiedHelper,
      uninstallCommand: `"${join(source, 'Uninstall Kun.exe')}" /currentuser`
    })

    expect(result.status, processError(result)).toBe(0)
    expect(result.stdout).toBe(canonicalSource)
    expect(readFileSync(resultPath, 'utf16le')).toBe(canonicalSource)
  })

  it('recovers the legacy parent of a falsely nested registered source', () => {
    const root = makeTempRoot()
    const source = join(root, 'DeepSeek GUI')
    const nested = join(source, 'Kun')
    const resultPath = join(root, 'resolved-source.txt')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(source, 'DeepSeek GUI.exe'), 'app')

    const result = runHelper({
      action: 'ResolveSource',
      source: nested,
      resultPath,
      uninstallCommand: `"${join(nested, 'Uninstall Kun.exe')}" /currentuser`
    })

    expect(result.status, processError(result)).toBe(0)
    expect(readFileSync(resultPath, 'utf16le')).toBe(realpathSync.native(source))
  })

  it('accepts a partially damaged packaged source with its app-specific uninstaller', () => {
    const root = makeTempRoot()
    const source = join(root, 'Kun')
    const journal = join(root, 'recovery', 'journal.json')
    const resultPath = join(root, 'prepare-result.txt')
    mkdirSync(join(source, 'resources'), { recursive: true })
    writeFileSync(join(source, 'resources', 'app.asar'), 'packaged app')
    writeFileSync(join(source, 'Uninstall Kun.exe'), 'uninstaller')
    writeFileSync(join(source, 'personal.txt'), 'keep me')

    const prepared = runHelper({ action: 'Prepare', source, target: source, journal, resultPath })

    expect(prepared.status, processError(prepared)).toBe(0)
    expect(readFileSync(resultPath, 'utf16le')).toBe('0')
    expect(existsSync(join(source, 'personal.txt'))).toBe(false)
    const restored = runHelper({ action: 'Restore', source, target: source, journal })
    expect(restored.status, processError(restored)).toBe(0)
    expect(readFileSync(join(source, 'personal.txt'), 'utf8')).toBe('keep me')
  })

  it('leaves the exact top-level running installer in place during manual cleanup', () => {
    const root = makeTempRoot()
    const source = join(root, 'Kun')
    const journal = join(root, 'recovery', 'journal.json')
    const installer = join(source, 'Kun-setup.exe')
    mkdirSync(join(source, 'resources'), { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'app')
    writeFileSync(join(source, 'resources', 'app.asar'), 'packaged app')
    writeFileSync(installer, 'running installer')
    writeFileSync(join(source, 'personal.txt'), 'keep me')

    const prepared = runHelper({
      action: 'Prepare', source, target: source, journal, selfPath: installer
    })
    expect(prepared.status, processError(prepared)).toBe(0)
    expect(readFileSync(installer, 'utf8')).toBe('running installer')

    const cleaned = runHelper({
      action: 'FallbackCleanup', source, target: source, journal, selfPath: installer
    })
    expect(cleaned.status, processError(cleaned)).toBe(0)
    expect(readFileSync(installer, 'utf8')).toBe('running installer')

    const restored = runHelper({ action: 'Restore', source, target: source, journal })
    expect(restored.status, processError(restored)).toBe(0)
    expect(readFileSync(join(source, 'personal.txt'), 'utf8')).toBe('keep me')
  })

  it.each([
    ['missing', false],
    ['empty', true]
  ])('classifies a %s registered source as stale without changing it', (_label, createSource) => {
    const root = makeTempRoot()
    const source = join(root, 'Kun')
    const journal = join(root, 'recovery', 'journal.json')
    const resultPath = join(root, 'prepare-result.txt')
    if (createSource) mkdirSync(source, { recursive: true })

    const prepared = runHelper({ action: 'Prepare', source, target: source, journal, resultPath })

    expect(prepared.status, processError(prepared)).toBe(0)
    expect(readFileSync(resultPath, 'utf16le')).toBe('1')
    expect(existsSync(source)).toBe(createSource)
    expect(existsSync(journal)).toBe(false)
    if (createSource) {
      const restored = runHelper({
        action: 'Restore', source, target: source, journal, primarySourceStale: true
      })
      expect(restored.status, processError(restored)).toBe(0)
      expect(existsSync(source)).toBe(true)
    }
  })

  it('leaves an unverified non-empty registered source unchanged', () => {
    const root = makeTempRoot()
    const source = join(root, 'Kun')
    const journal = join(root, 'recovery', 'journal.json')
    mkdirSync(join(source, 'resources'), { recursive: true })
    writeFileSync(join(source, 'resources', 'app.asar'), 'ambiguous electron app')
    writeFileSync(join(source, 'personal.txt'), 'keep me')

    const prepared = runHelper({ action: 'Prepare', source, target: source, journal })

    expect(prepared.status).not.toBe(0)
    expect(processError(prepared)).toContain('not a verifiable Kun installation')
    expect(readFileSync(join(source, 'personal.txt'), 'utf8')).toBe('keep me')
    expect(readFileSync(join(source, 'resources', 'app.asar'), 'utf8')).toBe('ambiguous electron app')
    expect(existsSync(journal)).toBe(false)
  })

  it('rejects an unavailable target volume before changing the source', () => {
    const root = makeTempRoot()
    const source = join(root, 'Kun')
    const journal = join(root, 'recovery', 'journal.json')
    mkdirSync(join(source, 'resources'), { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'app')
    writeFileSync(join(source, 'personal.txt'), 'keep me')

    const result = runHelper({
      action: 'Prepare',
      source,
      target: unavailableDriveTarget(),
      journal
    })

    expect(result.status).not.toBe(0)
    expect(processError(result)).toContain('target volume is unavailable')
    expect(readFileSync(join(source, 'personal.txt'), 'utf8')).toBe('keep me')
    expect(existsSync(journal)).toBe(false)
  })
})
