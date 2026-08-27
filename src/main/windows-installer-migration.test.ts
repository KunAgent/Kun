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
  action: 'ResolvePath' | 'ResolveSource' | 'ResolveUpdateScope' | 'ResolveUninstaller' | 'ResolveRecoveryExecutable' | 'PrepareUpdateTransaction' | 'SwitchUpdatePayload' | 'ValidateCutover' | 'RollbackUpdateTransaction' | 'ResolveHealthToken' | 'ValidateHealthResult' | 'CommitUpdateTransaction' | 'StopProcesses' | 'Recover' | 'Prepare' | 'FallbackCleanup' | 'Restore' | 'ValidatePayload' | 'BackupPayload' | 'RestorePayloadBackup' | 'CleanupInPlaceLeftovers' | 'CleanupJournal'
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
  appRoot?: string
  diagnosticPath?: string
  automaticUpdate?: boolean
  backupPath?: string
  transactionPath?: string
  stagePath?: string
  healthResultPath?: string
  installRegistryKey?: string
  uninstallRegistryKey?: string
  desktopPath?: string
  programsPath?: string
  faultPoint?: string
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
        KUN_INSTALLER_APP_ROOT: input.appRoot ?? '',
        KUN_INSTALLER_DIAGNOSTIC_PATH: input.diagnosticPath ?? '',
        KUN_INSTALLER_AUTOMATIC_UPDATE: input.automaticUpdate ? '1' : '0',
        KUN_INSTALLER_PAYLOAD_BACKUP: input.backupPath ?? '',
        KUN_INSTALLER_TRANSACTION: input.transactionPath ?? '',
        KUN_INSTALLER_STAGE: input.stagePath ?? '',
        KUN_INSTALLER_HEALTH_RESULT: input.healthResultPath ?? '',
        KUN_INSTALLER_INSTALL_REGISTRY_KEY: input.installRegistryKey ?? 'Software\\KunTest\\Install',
        KUN_INSTALLER_UNINSTALL_REGISTRY_KEY: input.uninstallRegistryKey ?? 'Software\\KunTest\\Uninstall',
        KUN_INSTALLER_CURRENT_DESKTOP: input.desktopPath ?? '',
        KUN_INSTALLER_CURRENT_PROGRAMS: input.programsPath ?? '',
        KUN_INSTALLER_COMMON_DESKTOP: input.desktopPath ?? '',
        KUN_INSTALLER_COMMON_PROGRAMS: input.programsPath ?? '',
        KUN_INSTALLER_FAULT_INJECTION: input.faultPoint ? '1' : '0',
        KUN_INSTALLER_FAULT_POINT: input.faultPoint ?? ''
      }
    }
  )
}

function processError(result: ReturnType<typeof runHelper>): string {
  return String(result.stderr ?? '')
}

function makeAclUntrusted(path: string): void {
  const result = spawnSync(
    'icacls.exe',
    [path, '/grant', '*S-1-1-0:(OI)(CI)M', '/T', '/C'],
    { encoding: 'utf8' }
  )
  if (result.status !== 0) {
    throw new Error(`Unable to make the test ACL untrusted: ${result.stderr || result.stdout}`)
  }
}

function unavailableDriveTarget(): string {
  for (let code = 'Z'.charCodeAt(0); code >= 'P'.charCodeAt(0); code -= 1) {
    const root = `${String.fromCharCode(code)}:\\`
    if (!existsSync(root)) return `${root}Kun`
  }
  throw new Error('No unavailable drive letter was available for the installer helper test.')
}

function readJournal(path: string): { SchemaVersion: number; Records: Array<{ Stash: string }> } {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as {
    SchemaVersion: number
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

describe('Windows installer migration ACL contract', () => {
  it('uses the Windows filesystem ACL API without the optional PowerShell security module', () => {
    const script = readHelperSources()

    expect(script).not.toMatch(/\b(?:Get|Set)-Acl\b/u)
    expect(script).toContain('[IO.Directory]::GetAccessControl')
    expect(script).toContain('[IO.Directory]::SetAccessControl')
    expect(script).toContain('[IO.File]::SetAccessControl')
  })

  it('reads only the owner and DACL, so normal users do not need SACL privileges', () => {
    const script = readHelperSources()

    expect(script).toContain(
      '$sections = [Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Access'
    )
    expect(script).not.toContain('[Security.AccessControl.AccessControlSections]::All')
    expect(script).not.toContain('[Security.AccessControl.AccessControlSections]::Audit')
  })

  it('quarantines untrusted journals only when no preservation directory remains', () => {
    const script = readHelperSources()

    expect(script).toContain('function Move-UntrustedJournalToQuarantine')
    expect(script).toContain('function Get-ExistingJournalPreservationRoots')
    expect(script).toContain('function Remove-EmptyJournalPreservationRoots')
    expect(script.indexOf('Get-ExistingJournalPreservationRoots')).toBeLessThan(
      script.indexOf('[IO.File]::Move($PathValue, $quarantinePath)')
    )
    expect(script).toContain('The journal and preserved files were left unchanged.')
    expect(script).not.toContain('Set-SecureJournalFileAcl $quarantinePath')
    expect(script.match(/\$journalExists = Test-Path -LiteralPath \$journalPath -PathType Leaf/gu)).toHaveLength(2)
  })

  it('migrates trusted schema-2 journals and cleans stale journals during uninstall', () => {
    const script = readHelperSources()
    const installerScript = readFileSync(join(process.cwd(), 'build/installer.nsh'), 'utf8')

    expect(script).toContain('function Convert-LegacyJournal')
    expect(script).toContain("if ($schemaVersion -ne 2)")
    expect(script).toContain('Get-ValidatedJournalRecord $record')
    expect(script).toContain('function Invoke-CleanupJournal')
    expect(installerScript).toContain('!insertmacro kunRunMigrationHelper CleanupJournal')
    expect(installerScript).toContain(
      '${ifNot} ${isUpdated}\n    StrCpy $KunInstallerJournalPath'
    )
  })

  it('waits for the real NSIS uninstall lifecycle before starting another installer', () => {
    const script = readFileSync(smokePath, 'utf8')

    expect(script).toContain("$arguments = @('/S', $Mode, ('_?={0}' -f $InstallLocation))")
    expect(script).toContain('Start-Process -FilePath $copy -ArgumentList $arguments -Wait -PassThru')
    expect(script).not.toMatch(/Start-Process -FilePath \$(?:unicode|machine)Uninstaller/u)
  })

  it('retries only a Windows access violation and never more than once', () => {
    const script = readFileSync(smokePath, 'utf8')

    expect(script).toContain('$accessViolationExitCode = -1073741819')
    expect(script).toContain('$maximumAttempts = 2')
    expect(script).toContain('$process.ExitCode -ne $accessViolationExitCode')
    expect(script).toContain('retrying once after 2 seconds')
  })

  it('aborts an ambiguous dual-scope automatic update without a source marker', () => {
    const installerScript = readFileSync(join(process.cwd(), 'build/installer.nsh'), 'utf8')
    const selectionStart = installerScript.indexOf('Function KunSelectAutomaticUpdateMode')
    const scopeAbort = installerScript.indexOf(
      '!insertmacro KunAbortAutomaticUpdate scope_ambiguous scope'
    )
    const scopeResolution = installerScript.indexOf('!insertmacro kunRunMigrationHelper ResolveUpdateScope')

    expect(selectionStart).toBeGreaterThanOrEqual(0)
    expect(scopeAbort).toBeGreaterThan(selectionStart)
    expect(scopeAbort).toBeLessThan(scopeResolution)
    expect(installerScript).toContain(
      'Automatic update source marker is unavailable with registrations in both scopes; aborting the update.'
    )
    expect(installerScript).not.toContain(
      'Automatic update source marker is unavailable with registrations in both scopes; keeping the requested install mode.'
    )
  })

  it('keeps every automatic update recoverable before it can remove the old payload', () => {
    const installerScript = readFileSync(join(process.cwd(), 'build/installer.nsh'), 'utf8')
    const migrationScript = readHelperSources()
    const automaticUpdateScript = readFileSync(
      join(process.cwd(), 'build/installer-automatic-update.nsh'),
      'utf8'
    )

    expect(installerScript).toContain('Function KunMarkInPlaceAutomaticUpdate')
    expect(installerScript).toContain('# Automatic updates retain the old payload through candidate health validation.')
    expect(installerScript).toContain('Automatic update; deferring removal of $KunInstallerPrimarySourceDir until commit.')
    expect(installerScript).toContain('KUN_INSTALLER_AUTOMATIC_UPDATE')
    expect(installerScript).toContain('Automatic update; suppressed the selected-scope uninstaller until commit.')
    expect(installerScript.indexOf('!insertmacro kunRunMigrationHelper ValidatePayload')).toBeLessThan(
      installerScript.indexOf('!insertmacro kunRunMigrationHelper CleanupInPlaceLeftovers')
    )
    expect(migrationScript).toContain('function Test-AutomaticUpdateRequested')
    expect(migrationScript).toContain('function Resolve-RecoveryPayloadExecutable')
    expect(migrationScript).toContain("'ResolveRecoveryExecutable'")
    expect(migrationScript).toContain("'DeepSeek GUI.exe'")
    expect(automaticUpdateScript).toContain('!insertmacro kunRunMigrationHelper RollbackUpdateTransaction')
    expect(automaticUpdateScript).toContain('!insertmacro kunRunMigrationHelper ResolveRecoveryExecutable')
    expect(automaticUpdateScript).toContain('!insertmacro kunRunMigrationHelper CommitUpdateTransaction')
    expect(automaticUpdateScript).not.toContain('KUN_INSTALLER_UPDATE_SOURCE')
    expect(smokePath.length).toBeGreaterThan(0)
    expect(readFileSync(smokePath, 'utf8')).toContain('in-app all-users automatic update scope')
  })
})

windowsOnly('Windows installer migration helper', () => {
  it('keeps a process inspection failure distinct from no matching app process', () => {
    const root = makeTempRoot()
    const appRoot = join(root, 'Kun')
    const diagnosticPath = join(root, 'process-check.log')
    mkdirSync(appRoot, { recursive: true })

    const stopped = runHelper({ action: 'StopProcesses', appRoot, diagnosticPath })
    expect(stopped.status, processError(stopped)).toBe(0)

    const unsafeRoot = parse(appRoot).root
    const failed = runHelper({ action: 'StopProcesses', appRoot: unsafeRoot, diagnosticPath })
    expect(failed.status).toBe(1)
    expect(processError(failed)).toContain('KUN_INSTALLER_STOP_RESULT=inspection-failed')
    expect(processError(failed)).not.toContain(unsafeRoot)
    expect(readFileSync(diagnosticPath, 'utf8')).toContain(
      'STOP_PROCESSES outcome=inspection-failed'
    )
  })

  it('validates the installed application payload before PATH is updated', () => {
    const target = join(makeTempRoot(), 'Kun')
    mkdirSync(target, { recursive: true })
    writePackagedInstallPayload(target)

    const result = runHelper({ action: 'ValidatePayload', target })

    expect(result.status, processError(result)).toBe(0)
  })

  it('removes only obsolete known identity files after a validated in-place update', () => {
    const target = join(makeTempRoot(), 'Kun')
    mkdirSync(target, { recursive: true })
    writePackagedInstallPayload(target)
    writeFileSync(join(target, 'DeepSeek GUI.exe'), 'legacy identity')
    writeFileSync(join(target, 'Uninstall DeepSeek GUI.exe'), 'legacy uninstaller')
    writeFileSync(join(target, 'Uninstall Kun.exe'), 'current uninstaller')
    writeFileSync(join(target, 'ffmpeg.dll'), 'runtime')
    writeFileSync(join(target, 'notes.txt'), 'user file')

    const result = runHelper({
      action: 'CleanupInPlaceLeftovers',
      source: target,
      target,
      inPlaceUpdate: true
    })

    expect(result.status, processError(result)).toBe(0)
    expect(existsSync(join(target, 'Kun.exe'))).toBe(true)
    expect(existsSync(join(target, 'Uninstall Kun.exe'))).toBe(true)
    expect(existsSync(join(target, 'ffmpeg.dll'))).toBe(true)
    expect(existsSync(join(target, 'resources', 'app.asar'))).toBe(true)
    expect(existsSync(join(target, 'DeepSeek GUI.exe'))).toBe(false)
    expect(existsSync(join(target, 'Uninstall DeepSeek GUI.exe'))).toBe(false)
    expect(readFileSync(join(target, 'notes.txt'), 'utf8')).toBe('user file')
  })

  it('does not clean in-place leftovers unless the in-place update marker is set', () => {
    const target = join(makeTempRoot(), 'Kun')
    mkdirSync(target, { recursive: true })
    writePackagedInstallPayload(target)
    writeFileSync(join(target, 'DeepSeek GUI.exe'), 'legacy identity')

    const result = runHelper({
      action: 'CleanupInPlaceLeftovers',
      source: target,
      target,
      inPlaceUpdate: false
    })

    expect(result.status, processError(result)).toBe(0)
    expect(existsSync(join(target, 'DeepSeek GUI.exe'))).toBe(true)
  })

  it('refuses in-place leftover cleanup when the validated payload is incomplete', () => {
    const target = join(makeTempRoot(), 'Kun')
    mkdirSync(target, { recursive: true })
    writePackagedInstallPayload(target)
    rmSync(join(target, 'Kun.exe'))
    writeFileSync(join(target, 'DeepSeek GUI.exe'), 'legacy identity')

    const result = runHelper({
      action: 'CleanupInPlaceLeftovers',
      source: target,
      target,
      inPlaceUpdate: true
    })

    expect(result.status).not.toBe(0)
    expect(processError(result)).toContain('payload is missing')
    expect(existsSync(join(target, 'DeepSeek GUI.exe'))).toBe(true)
  })

  it('keeps known application files after prepare for same-directory updates', () => {
    const root = makeTempRoot()
    const source = join(root, 'Kun')
    const journal = join(root, 'recovery', 'journal.json')
    mkdirSync(join(source, 'resources'), { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'app')
    writeFileSync(join(source, 'notes.txt'), 'keep me')

    const prepared = runHelper({ action: 'Prepare', source, target: source, journal })
    expect(prepared.status, processError(prepared)).toBe(0)
    expect(existsSync(join(source, 'Kun.exe'))).toBe(true)
    expect(existsSync(join(source, 'notes.txt'))).toBe(false)
  })

  it('quarantines an untrusted stale journal when no preserved files remain', () => {
    const root = makeTempRoot()
    const source = join(root, 'Kun')
    const recovery = join(root, 'recovery')
    const journal = join(recovery, 'journal.json')
    mkdirSync(join(source, 'resources'), { recursive: true })
    mkdirSync(recovery, { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'app')
    writeFileSync(journal, '{"SchemaVersion":2,"Phase":"preserved","Records":[]}')
    makeAclUntrusted(recovery)

    const prepared = runHelper({ action: 'Prepare', source, target: source, journal })

    expect(prepared.status, processError(prepared)).toBe(0)
    expect(readJournal(journal).SchemaVersion).toBe(3)
    expect(readdirSync(recovery).some((name) => name.startsWith('journal.json.untrusted-'))).toBe(true)
  })

  it('keeps an untrusted journal unchanged when preserved files still exist', () => {
    const root = makeTempRoot()
    const source = join(root, 'Kun')
    const recovery = join(root, 'recovery')
    const journal = join(recovery, 'journal.json')
    mkdirSync(join(source, 'resources'), { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'app')
    writeFileSync(join(source, 'notes.txt'), 'keep me')

    const firstPrepare = runHelper({ action: 'Prepare', source, target: source, journal })
    expect(firstPrepare.status, processError(firstPrepare)).toBe(0)
    const stash = readJournal(journal).Records[0]?.Stash
    if (!stash) throw new Error('Prepare did not record the preservation directory.')
    makeAclUntrusted(recovery)

    const retry = runHelper({ action: 'Prepare', source, target: source, journal })

    expect(retry.status).not.toBe(0)
    expect(processError(retry)).toContain('preserved installation files still exist')
    expect(existsSync(journal)).toBe(true)
    expect(readFileSync(join(stash, 'content', 'notes.txt'), 'utf8')).toBe('keep me')
  })

  it('removes an empty preservation directory before quarantining a stale journal', () => {
    const root = makeTempRoot()
    const source = join(root, 'Kun')
    const recovery = join(root, 'recovery')
    const journal = join(recovery, 'journal.json')
    mkdirSync(join(source, 'resources'), { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'app')
    writeFileSync(join(source, 'notes.txt'), 'already recovered elsewhere')

    const firstPrepare = runHelper({ action: 'Prepare', source, target: source, journal })
    expect(firstPrepare.status, processError(firstPrepare)).toBe(0)
    const stash = readJournal(journal).Records[0]?.Stash
    if (!stash) throw new Error('Prepare did not record the preservation directory.')
    rmSync(join(stash, 'content', 'notes.txt'))
    makeAclUntrusted(recovery)

    const retry = runHelper({ action: 'Prepare', source, target: source, journal })

    expect(retry.status, processError(retry)).toBe(0)
    expect(existsSync(stash)).toBe(false)
    expect(readdirSync(recovery).some((name) => name.startsWith('journal.json.untrusted-'))).toBe(true)
  })

  it('validates and restores a trusted schema-2 recovery journal', () => {
    const root = makeTempRoot()
    const source = join(root, 'Kun')
    const journal = join(root, 'recovery', 'journal.json')
    mkdirSync(join(source, 'resources'), { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'app')
    writeFileSync(join(source, 'notes.txt'), 'keep me')

    const prepared = runHelper({ action: 'Prepare', source, target: source, journal })
    expect(prepared.status, processError(prepared)).toBe(0)
    const current = readJournal(journal)
    writeFileSync(journal, JSON.stringify({
      SchemaVersion: 2,
      Phase: 'preserved',
      Records: current.Records
    }))

    const restored = runHelper({ action: 'Restore', source, target: source, journal })

    expect(restored.status, processError(restored)).toBe(0)
    expect(readFileSync(join(source, 'notes.txt'), 'utf8')).toBe('keep me')
    expect(existsSync(journal)).toBe(false)
  })

  it('cleans only journals that have no preserved files during uninstall', () => {
    const root = makeTempRoot()
    const source = join(root, 'Kun')
    const journal = join(root, 'recovery', 'journal.json')
    mkdirSync(join(source, 'resources'), { recursive: true })
    writeFileSync(join(source, 'Kun.exe'), 'app')

    const prepared = runHelper({ action: 'Prepare', source, target: source, journal })
    expect(prepared.status, processError(prepared)).toBe(0)

    const cleaned = runHelper({ action: 'CleanupJournal', source, target: source, journal })

    expect(cleaned.status, processError(cleaned)).toBe(0)
    expect(existsSync(journal)).toBe(false)

    const preservedSource = join(root, 'Kun-preserved')
    const preservedJournal = join(root, 'recovery-preserved', 'journal.json')
    mkdirSync(join(preservedSource, 'resources'), { recursive: true })
    writeFileSync(join(preservedSource, 'Kun.exe'), 'app')
    writeFileSync(join(preservedSource, 'notes.txt'), 'keep me')
    const preparedWithFiles = runHelper({
      action: 'Prepare', source: preservedSource, target: preservedSource, journal: preservedJournal
    })
    expect(preparedWithFiles.status, processError(preparedWithFiles)).toBe(0)

    const preserved = runHelper({
      action: 'CleanupJournal', source: preservedSource, target: preservedSource, journal: preservedJournal
    })
    expect(preserved.status, processError(preserved)).toBe(0)
    expect(existsSync(preservedJournal)).toBe(true)
  })

  it.each([
    ['application executable', (target: string) => join(target, 'Kun.exe')],
    ['resources\\app.asar', (target: string) => join(target, 'resources', 'app.asar')],
    [
      'unpacked Kun runtime entry',
      (target: string) => join(target, 'resources', 'app.asar.unpacked', 'kun', 'dist', 'cli', 'serve-entry.js')
    ],
    [
      'unpacked Kun service manager entry',
      (target: string) => join(target, 'resources', 'app.asar.unpacked', 'kun', 'dist', 'manager', 'manager-entry.js')
    ]
  ])('rejects an incomplete installed payload missing %s', (label, missingPath) => {
    const target = join(makeTempRoot(), 'Kun')
    mkdirSync(target, { recursive: true })
    writePackagedInstallPayload(target)
    rmSync(missingPath(target))

    const result = runHelper({ action: 'ValidatePayload', target })

    expect(result.status).not.toBe(0)
    expect(processError(result)).toContain('payload is missing')
    expect(processError(result)).toContain(label)
  })

  it('rejects an empty installed payload file', () => {
    const target = join(makeTempRoot(), 'Kun')
    mkdirSync(target, { recursive: true })
    writePackagedInstallPayload(target)
    writeFileSync(join(target, 'resources', 'app.asar'), '')

    const result = runHelper({ action: 'ValidatePayload', target })

    expect(result.status).not.toBe(0)
    expect(processError(result)).toContain('payload is empty for resources\\app.asar')
  })

  it.each([
    ['C:\\Users\\me\\AppData\\Local\\Programs\\DeepSeek GUI', '', 'C:\\Users\\me\\AppData\\Local\\Programs\\Kun'],
    ['D:\\Apps\\deepseek-gui', '', 'D:\\Apps\\Kun'],
    ['D:\\Apps\\DeepSeek GUI\\Kun', '', 'D:\\Apps\\Kun'],
    ['D:\\Legacy\\DeepSeek GUI', 'C:\\Users\\me\\AppData\\Local\\Programs\\Kun', 'D:\\Legacy\\Kun'],
    ['D:\\Apps\\Custom AI', 'D:\\Apps\\Custom AI', 'D:\\Apps\\Custom AI'],
    ['', 'D:\\Apps', 'D:\\Apps\\Kun'],
    ['', 'D:\\KunTools', 'D:\\KunTools\\Kun'],
    ['', 'D:\\Unicode 测试\\', 'D:\\Unicode 测试\\Kun']
  ])('resolves source %s and candidate %s to %s', (source, candidateOverride, expected) => {
    const candidate = candidateOverride || source
    const resultPath = join(makeTempRoot(), 'resolved-path.txt')
    const result = runHelper({ action: 'ResolvePath', source, candidate, resultPath })

    expect(result.status, processError(result)).toBe(0)
    expect(readFileSync(resultPath, 'utf16le')).toBe(expected)
  })
})
