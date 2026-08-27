import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import {
  randomUUID
} from 'node:crypto'
import {
  basename,
  dirname,
  join
} from 'node:path'
import {
  canonicalCurrentKunDataDir,
  type CanonicalKunDataDirKind,
  canonicalLegacyKunDataDir
} from './kun-data-dir-paths'
import {
  settingsReadCandidates
} from './settings-file-paths'
import {
  BEST_EFFORT_WINDOWS_FSYNC_CODES,
  MIGRATION_PHASES,
  MIGRATION_SCHEMA_VERSION,
  type MigrationPhase,
  type PathState,
  RETRYABLE_WINDOWS_CODES,
  type RuntimeMigrationJournal
} from './runtime-data-dir-migration-types'



export type SettingsSelection = {
  authority: CanonicalKunDataDirKind | 'unknown'
  sourcePath?: string
  writePath?: string
}

export function pathState(path: string): PathState {
  try {
    const stats = lstatSync(path)
    if (stats.isSymbolicLink()) return 'symlink'
    if (stats.isDirectory()) return 'dir'
    return 'other'
  } catch (error) {
    return errnoCode(error) === 'ENOENT' ? 'missing' : 'inaccessible'
  }
}

export function errnoCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined
}

export function defaultSleep(milliseconds: number): void {
  if (milliseconds <= 0) return
  const signal = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(signal, 0, 0, milliseconds)
}

export function retryRuntimeMigrationMutation(
  operation: () => void,
  options: { platform: NodeJS.Platform; sleep: (milliseconds: number) => void }
): void {
  const delays = options.platform === 'win32' ? [0, 50, 150, 350] : [0]
  let lastError: unknown
  for (const delay of delays) {
    options.sleep(delay)
    try {
      operation()
      return
    } catch (error) {
      lastError = error
      if (
        options.platform !== 'win32' ||
        !RETRYABLE_WINDOWS_CODES.has(errnoCode(error) ?? '')
      ) {
        throw error
      }
    }
  }
  throw lastError
}

export function canIgnoreRuntimeMigrationFsyncError(
  error: unknown,
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform === 'win32' && BEST_EFFORT_WINDOWS_FSYNC_CODES.has(errnoCode(error) ?? '')
}

export function fsyncFileBestEffort(handle: number): void {
  try {
    fsyncSync(handle)
  } catch (error) {
    if (canIgnoreRuntimeMigrationFsyncError(error)) return
    throw error
  }
}

export function writeDurableJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  const handle = openSync(temporary, 'wx', 0o600)
  try {
    writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    fsyncFileBestEffort(handle)
  } finally {
    closeSync(handle)
  }
  retryRuntimeMigrationMutation(
    () => renameSync(temporary, path),
    { platform: process.platform, sleep: defaultSleep }
  )
  fsyncDirectoryBestEffort(dirname(path))
}

export function fsyncDirectoryBestEffort(path: string): void {
  try {
    const directoryHandle = openSync(path, 'r')
    try {
      fsyncSync(directoryHandle)
    } finally {
      closeSync(directoryHandle)
    }
  } catch {
    // Windows does not consistently allow opening directories for fsync.
  }
}

export function fsyncRenameParents(sourcePath: string, targetPath: string): void {
  const sourceParent = dirname(sourcePath)
  const targetParent = dirname(targetPath)
  fsyncDirectoryBestEffort(sourceParent)
  if (targetParent !== sourceParent) fsyncDirectoryBestEffort(targetParent)
}

export function readJournal(path: string): RuntimeMigrationJournal | null {
  if (pathState(path) !== 'other') return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<RuntimeMigrationJournal>
    const stringArray = (value: unknown): value is string[] =>
      Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    const inventory = parsed.sourceInventory
    const cutoverConflictBackupPaths = parsed.cutoverConflictBackupPaths ?? []
    const extensionRegistryBackupPaths = parsed.extensionRegistryBackupPaths ?? []
    if (
      parsed.schemaVersion !== MIGRATION_SCHEMA_VERSION ||
      typeof parsed.phase !== 'string' ||
      !MIGRATION_PHASES.has(parsed.phase as MigrationPhase) ||
      typeof parsed.sourcePath !== 'string' ||
      typeof parsed.targetPath !== 'string' ||
      (parsed.destinationBackupPath !== undefined && typeof parsed.destinationBackupPath !== 'string') ||
      !stringArray(cutoverConflictBackupPaths) ||
      (parsed.settingsSourcePath !== undefined && typeof parsed.settingsSourcePath !== 'string') ||
      (parsed.settingsWritePath !== undefined && typeof parsed.settingsWritePath !== 'string') ||
      !stringArray(parsed.settingsBackupPaths) ||
      (parsed.settingsBackedUp !== undefined && typeof parsed.settingsBackedUp !== 'boolean') ||
      !stringArray(extensionRegistryBackupPaths) ||
      (
        parsed.extensionRegistryRebasedRecords !== undefined &&
        (
          !Number.isSafeInteger(parsed.extensionRegistryRebasedRecords) ||
          parsed.extensionRegistryRebasedRecords < 0
        )
      ) ||
      (
        parsed.extensionRegistryRebasedAt !== undefined &&
        (
          typeof parsed.extensionRegistryRebasedAt !== 'string' ||
          Number.isNaN(Date.parse(parsed.extensionRegistryRebasedAt))
        )
      ) ||
      (parsed.sourceWasMissing !== undefined && typeof parsed.sourceWasMissing !== 'boolean') ||
      !stringArray(parsed.sourceThreadIds) ||
      (
        inventory !== undefined &&
        (
          typeof inventory !== 'object' ||
          inventory === null ||
          !Number.isSafeInteger(inventory.files) ||
          inventory.files < 0 ||
          !Number.isSafeInteger(inventory.directories) ||
          inventory.directories < 0 ||
          !Number.isSafeInteger(inventory.symlinks) ||
          inventory.symlinks < 0 ||
          !Number.isSafeInteger(inventory.bytes) ||
          inventory.bytes < 0
        )
      ) ||
      (
        parsed.destinationInventory !== undefined &&
        (
          typeof parsed.destinationInventory !== 'object' ||
          parsed.destinationInventory === null ||
          !Number.isSafeInteger(parsed.destinationInventory.files) ||
          parsed.destinationInventory.files < 0 ||
          !Number.isSafeInteger(parsed.destinationInventory.directories) ||
          parsed.destinationInventory.directories < 0 ||
          !Number.isSafeInteger(parsed.destinationInventory.symlinks) ||
          parsed.destinationInventory.symlinks < 0 ||
          !Number.isSafeInteger(parsed.destinationInventory.bytes) ||
          parsed.destinationInventory.bytes < 0
        )
      ) ||
      (
        parsed.targetInventory !== undefined &&
        (
          typeof parsed.targetInventory !== 'object' ||
          parsed.targetInventory === null ||
          !Number.isSafeInteger(parsed.targetInventory.files) ||
          parsed.targetInventory.files < 0 ||
          !Number.isSafeInteger(parsed.targetInventory.directories) ||
          parsed.targetInventory.directories < 0 ||
          !Number.isSafeInteger(parsed.targetInventory.symlinks) ||
          parsed.targetInventory.symlinks < 0 ||
          !Number.isSafeInteger(parsed.targetInventory.bytes) ||
          parsed.targetInventory.bytes < 0
        )
      ) ||
      (
        parsed.sqliteQuickCheck !== undefined &&
        parsed.sqliteQuickCheck !== 'missing' &&
        parsed.sqliteQuickCheck !== 'ok' &&
        parsed.sqliteQuickCheck !== 'invalid'
      ) ||
      !Number.isSafeInteger(parsed.salvaged) ||
      (parsed.salvaged ?? -1) < 0 ||
      !stringArray(parsed.conflicts) ||
      typeof parsed.startedAt !== 'string' ||
      typeof parsed.updatedAt !== 'string' ||
      (parsed.completedAt !== undefined && typeof parsed.completedAt !== 'string') ||
      (parsed.runtimeVerifiedAt !== undefined && typeof parsed.runtimeVerifiedAt !== 'string') ||
      (
        parsed.runtimeVerificationAttempts !== undefined &&
        (!Number.isSafeInteger(parsed.runtimeVerificationAttempts) || parsed.runtimeVerificationAttempts < 0)
      ) ||
      (
        parsed.runtimeVerificationLastAttemptAt !== undefined &&
        typeof parsed.runtimeVerificationLastAttemptAt !== 'string'
      ) ||
      (
        parsed.runtimeVerificationMissingThreadIds !== undefined &&
        !stringArray(parsed.runtimeVerificationMissingThreadIds)
      ) ||
      (
        parsed.runtimeVerificationStoppedAt !== undefined &&
        typeof parsed.runtimeVerificationStoppedAt !== 'string'
      ) ||
      (parsed.error !== undefined && typeof parsed.error !== 'string')
    ) {
      return null
    }
    parsed.cutoverConflictBackupPaths = cutoverConflictBackupPaths
    parsed.extensionRegistryBackupPaths = extensionRegistryBackupPaths
    return parsed as RuntimeMigrationJournal
  } catch {
    return null
  }
}

export function comparableFilesystemPath(path: string, platform: NodeJS.Platform): string {
  const normalized = path.replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  return platform === 'win32'
    ? normalized.toLocaleLowerCase('en-US')
    : normalized
}

export function sameFilesystemPath(
  left: string | undefined,
  right: string | undefined,
  platform: NodeJS.Platform
): boolean {
  if (left === undefined || right === undefined) return left === right
  return comparableFilesystemPath(left, platform) === comparableFilesystemPath(right, platform)
}

export function isMigrationOwnedSiblingBackup(
  backupPath: string,
  originalPath: string,
  label: string,
  platform: NodeJS.Platform
): boolean {
  if (!sameFilesystemPath(dirname(backupPath), dirname(originalPath), platform)) return false
  const expectedPrefix = `${basename(originalPath)}.${label}-`
  const candidateName = basename(backupPath)
  const comparableName = platform === 'win32'
    ? candidateName.toLocaleLowerCase('en-US')
    : candidateName
  const comparablePrefix = platform === 'win32'
    ? expectedPrefix.toLocaleLowerCase('en-US')
    : expectedPrefix
  const suffix = comparableName.slice(comparablePrefix.length, -4)
  return (
    comparableName.startsWith(comparablePrefix) &&
    comparableName.endsWith('.bak') &&
    /^\d{8}t\d{9}z(?:-\d+)?$/i.test(suffix)
  )
}

export function validateJournalForRecovery(
  journal: RuntimeMigrationJournal,
  input: {
    userDataPath: string
    homeDir: string
    platform: NodeJS.Platform
  }
): string | null {
  const expectedSource = canonicalLegacyKunDataDir(input.homeDir, input.platform)
  const expectedTarget = canonicalCurrentKunDataDir(input.homeDir, input.platform)
  if (
    !sameFilesystemPath(journal.sourcePath, expectedSource, input.platform) ||
    !sameFilesystemPath(journal.targetPath, expectedTarget, input.platform)
  ) {
    return 'the Runtime migration journal contains non-canonical source or target paths'
  }
  if (
    journal.destinationBackupPath &&
    !isMigrationOwnedSiblingBackup(
      journal.destinationBackupPath,
      expectedTarget,
      'pre-deepseekgui-migration',
      input.platform
    )
  ) {
    return 'the Runtime migration journal contains an unsafe destination backup path'
  }
  if (journal.cutoverConflictBackupPaths.some((backupPath) =>
    !isMigrationOwnedSiblingBackup(
      backupPath,
      expectedSource,
      'cutover-conflict',
      input.platform
    ))) {
    return 'the Runtime migration journal contains an unsafe cutover-conflict backup path'
  }

  if (journal.settingsSourcePath) {
    const candidates = settingsReadCandidates(input.userDataPath)
    if (!candidates.some((candidate) =>
      sameFilesystemPath(candidate, journal.settingsSourcePath, input.platform))) {
      return 'the Runtime migration journal contains an unknown settings source path'
    }
  }
  if (journal.settingsWritePath && !journal.settingsSourcePath) {
    return 'the Runtime migration journal has a settings write path without a source path'
  }
  if (
    journal.settingsSourcePath &&
    journal.settingsWritePath &&
    !sameFilesystemPath(journal.settingsSourcePath, journal.settingsWritePath, input.platform) &&
    journal.phase !== 'completed'
  ) {
    try {
      if (
        !lstatSync(journal.settingsSourcePath).isSymbolicLink() ||
        !sameFilesystemPath(
          realpathSync(journal.settingsSourcePath),
          journal.settingsWritePath,
          input.platform
        )
      ) {
        return 'the Runtime migration journal settings symlink target is inconsistent'
      }
    } catch {
      return 'the Runtime migration journal settings symlink target is unavailable'
    }
  }
  const recognizedSettingsPaths = settingsReadCandidates(input.userDataPath)
  if (journal.settingsBackupPaths.some((backupPath) => {
    if (journal.settingsWritePath) {
      return !isMigrationOwnedSiblingBackup(
        backupPath,
        journal.settingsWritePath,
        'pre-runtime-data-migration',
        input.platform
      )
    }
    return !recognizedSettingsPaths.some((settingsPath) =>
      isMigrationOwnedSiblingBackup(
        backupPath,
        settingsPath,
        'pre-runtime-data-migration',
        input.platform
      ))
  })) {
    return 'the Runtime migration journal contains an unsafe settings backup path'
  }
  const extensionRegistryPath = join(expectedTarget, 'extensions', 'registry.json')
  if ((journal.extensionRegistryBackupPaths ?? []).some((backupPath) =>
    !isMigrationOwnedSiblingBackup(
      backupPath,
      extensionRegistryPath,
      'pre-runtime-extension-path-migration',
      input.platform
    ))) {
    return 'the Runtime migration journal contains an unsafe extension registry backup path'
  }
  if (journal.phase === 'completed' && !journal.completedAt) {
    return 'the Runtime migration journal completed phase has no completion timestamp'
  }
  if (
    (journal.phase === 'salvaged' ||
      journal.phase === 'extension-registry-backed-up' ||
      journal.phase === 'extension-registry-rebased' ||
      journal.phase === 'settings-rewritten' ||
      journal.phase === 'completed') &&
    journal.settingsBackedUp !== true
  ) {
    return 'the Runtime migration journal phase is inconsistent with settings backup state'
  }
  if (
    journal.phase === 'extension-registry-backed-up' &&
    (journal.extensionRegistryBackupPaths ?? []).length === 0
  ) {
    return 'the Runtime migration journal has no extension registry backup'
  }
  if (
    journal.phase === 'extension-registry-rebased' &&
    !journal.extensionRegistryRebasedAt
  ) {
    return 'the Runtime migration journal has no extension registry repair timestamp'
  }
  if (
    journal.phase === 'rollback-conflict-planned' &&
    journal.cutoverConflictBackupPaths.length === 0
  ) {
    return 'the Runtime migration rollback journal has no cutover-conflict backup path'
  }
  return null
}
