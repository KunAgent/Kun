import {
  cpSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync
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
  MIGRATION_SCHEMA_VERSION,
  type MigrationPhase,
  PROTECTED_EXTENSION_ENTRY_NAMES,
  PROTECTED_IDENTITY_ENTRIES,
  REPORT_FILE_NAME,
  type RuntimeMigrationJournal,
  type RuntimeStoreInventory,
  SALVAGE_ROOTS
} from './runtime-data-dir-migration-types'
import {
  fsyncRenameParents,
  pathState,
  retryRuntimeMigrationMutation,
  sameFilesystemPath,
  writeDurableJson
} from './runtime-data-dir-migration-journal-v2'
import {
  updateJournal
} from './runtime-data-dir-migration-journal-preservation'
import {
  readSettingsSelection,
  runtimeStoreInventory,
  threadIds,
  uniqueSiblingBackup
} from './runtime-data-dir-migration-inventory'
import {
  assertStoreInventoryContains,
  inventoryContains,
  linkResolvesToTarget,
  validateSqliteIndex
} from './runtime-data-dir-migration-copy'



export function salvageDestinationBackup(
  backupPath: string | undefined,
  targetPath: string,
  options: {
    platform: NodeJS.Platform
    sleep: (milliseconds: number) => void
  }
): { salvaged: number; conflicts: string[] } {
  if (!backupPath || pathState(backupPath) !== 'dir') {
    return { salvaged: 0, conflicts: [] }
  }
  let salvaged = 0
  const conflicts: string[] = []
  const protectedSources = PROTECTED_IDENTITY_ENTRIES
    .map((relativePath) => ({
      relativePath,
      source: join(backupPath, ...relativePath.split('/')),
      target: join(targetPath, ...relativePath.split('/'))
    }))
    .filter(({ source }) => pathState(source) !== 'missing')
  if (protectedSources.length > 0) {
    const protectedSourcePaths = new Set(
      protectedSources.map(({ relativePath }) => relativePath)
    )
    const targetHasUnpairedProtectedIdentity = PROTECTED_IDENTITY_ENTRIES.some(
      (relativePath) =>
        !protectedSourcePaths.has(relativePath) &&
        pathState(join(targetPath, ...relativePath.split('/'))) !== 'missing'
    )
    const targetHasDifferentProtectedIdentity = protectedSources.some(
      ({ source, target }) =>
        pathState(target) !== 'missing' &&
        !salvageTreesEqual(source, target)
    )
    const protectedSourcesAreSafe = protectedSources.every(
      ({ source }) => isSafeSalvageTree(source)
    )
    if (
      targetHasUnpairedProtectedIdentity ||
      targetHasDifferentProtectedIdentity ||
      !protectedSourcesAreSafe
    ) {
      conflicts.push(...protectedSources.map(({ relativePath }) => relativePath))
    } else {
      for (const { relativePath, source, target } of protectedSources) {
        if (pathState(target) !== 'missing') continue
        const stagingRoot = join(
          targetPath,
          '.kun-runtime-migration-staging',
          'protected-identity'
        )
        mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
        mkdirSync(stagingRoot, { recursive: true, mode: 0o700 })
        const temporary = join(stagingRoot, `${basename(relativePath)}-${randomUUID()}.tmp`)
        const metadata = lstatSync(source)
        cpSync(source, temporary, {
          recursive: metadata.isDirectory(),
          preserveTimestamps: true,
          errorOnExist: true,
          force: false,
          verbatimSymlinks: true
        })
        retryRuntimeMigrationMutation(
          () => renameSync(temporary, target),
          options
        )
        fsyncRenameParents(temporary, target)
        salvaged += 1
      }
    }
  }
  for (const rootName of SALVAGE_ROOTS) {
    const sourceRoot = join(backupPath, rootName)
    if (pathState(sourceRoot) !== 'dir') continue
    const targetRoot = join(targetPath, rootName)
    mkdirSync(targetRoot, { recursive: true, mode: 0o700 })
    for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
      if (rootName === 'threads' && !entry.isDirectory()) continue
      if (rootName === 'extensions' && PROTECTED_EXTENSION_ENTRY_NAMES.has(entry.name)) {
        continue
      }
      const source = join(sourceRoot, entry.name)
      const target = join(targetRoot, entry.name)
      if (pathState(target) !== 'missing') {
        conflicts.push(`${rootName}/${entry.name}`)
        continue
      }
      if (
        (!entry.isFile() && !entry.isDirectory()) ||
        !isSafeSalvageTree(source)
      ) {
        conflicts.push(`${rootName}/${entry.name}`)
        continue
      }
      const stagingRoot = join(targetPath, '.kun-runtime-migration-staging', rootName)
      mkdirSync(stagingRoot, { recursive: true, mode: 0o700 })
      const temporary = join(
        stagingRoot,
        `${entry.name}-${randomUUID()}.tmp`
      )
      cpSync(source, temporary, {
        recursive: entry.isDirectory(),
        preserveTimestamps: true,
        errorOnExist: true,
        force: false,
        verbatimSymlinks: true
      })
      retryRuntimeMigrationMutation(
        () => renameSync(temporary, target),
        options
      )
      fsyncRenameParents(temporary, target)
      salvaged += 1
    }
  }
  return { salvaged, conflicts: conflicts.sort() }
}

export function isSafeSalvageTree(path: string): boolean {
  const metadata = lstatSync(path)
  if (metadata.isFile()) return true
  if (!metadata.isDirectory()) return false
  return readdirSync(path).every((name) => isSafeSalvageTree(join(path, name)))
}

export function salvageTreesEqual(left: string, right: string): boolean {
  try {
    const leftMetadata = lstatSync(left)
    const rightMetadata = lstatSync(right)
    if (leftMetadata.isFile() && rightMetadata.isFile()) {
      return leftMetadata.size === rightMetadata.size &&
        readFileSync(left).equals(readFileSync(right))
    }
    if (!leftMetadata.isDirectory() || !rightMetadata.isDirectory()) return false
    const leftNames = readdirSync(left).sort()
    const rightNames = readdirSync(right).sort()
    return leftNames.length === rightNames.length &&
      leftNames.every((name, index) =>
        name === rightNames[index] &&
        salvageTreesEqual(join(left, name), join(right, name))
      )
  } catch {
    return false
  }
}

export function validatePromotedStore(
  journal: RuntimeMigrationJournal,
  platform: NodeJS.Platform
): {
  targetInventory: RuntimeStoreInventory
  sqliteQuickCheck: 'missing' | 'ok' | 'invalid'
} {
  if (pathState(journal.targetPath) !== 'dir') {
    throw new Error(`promoted Runtime target is unavailable: ${journal.targetPath}`)
  }
  if (!linkResolvesToTarget(journal.sourcePath, journal.targetPath, platform)) {
    throw new Error('legacy compatibility path does not resolve to the promoted Runtime store')
  }
  const migratedThreadIds = new Set(threadIds(journal.targetPath))
  const missing = journal.sourceThreadIds.filter((threadId) => !migratedThreadIds.has(threadId))
  if (missing.length > 0) {
    throw new Error(`promoted Runtime store is missing ${missing.length} legacy thread directories`)
  }
  const configPath = join(journal.targetPath, 'config.json')
  const configState = pathState(configPath)
  if (configState === 'other' || configState === 'symlink') {
    JSON.parse(readFileSync(configPath, 'utf8'))
  } else if (configState !== 'missing') {
    throw new Error(`promoted Runtime config is not a readable file: ${configPath}`)
  }
  const targetInventory = runtimeStoreInventory(journal.targetPath)
  if (
    journal.sourceInventory &&
    !inventoryContains(targetInventory, journal.sourceInventory)
  ) {
    throw new Error('promoted Runtime inventory is smaller than the authoritative source inventory')
  }
  if (journal.destinationBackupPath && journal.destinationInventory) {
    if (pathState(journal.destinationBackupPath) !== 'dir') {
      throw new Error('displaced Runtime destination backup is unavailable')
    }
    assertStoreInventoryContains(
      journal.destinationBackupPath,
      journal.destinationInventory,
      'displaced Runtime destination backup'
    )
  }
  return {
    targetInventory,
    sqliteQuickCheck: validateSqliteIndex(journal.targetPath)
  }
}

export function writeReport(
  userDataPath: string,
  journal: RuntimeMigrationJournal
): string {
  const reportPath = join(userDataPath, REPORT_FILE_NAME)
  writeDurableJson(reportPath, {
    schemaVersion: MIGRATION_SCHEMA_VERSION,
    status: journal.phase,
    sourcePath: journal.sourcePath,
    targetPath: journal.targetPath,
    destinationBackupPath: journal.destinationBackupPath,
    cutoverConflictBackupPaths: journal.cutoverConflictBackupPaths,
    settingsSourcePath: journal.settingsSourcePath,
    settingsBackupPaths: journal.settingsBackupPaths,
    settingsBackedUp: journal.settingsBackedUp === true,
    extensionRegistryBackupPaths: journal.extensionRegistryBackupPaths ?? [],
    extensionRegistryRebasedRecords: journal.extensionRegistryRebasedRecords,
    extensionRegistryRebasedAt: journal.extensionRegistryRebasedAt,
    sourceThreadCount: journal.sourceThreadIds.length,
    sourceInventory: journal.sourceInventory,
    destinationInventory: journal.destinationInventory,
    targetInventory: journal.targetInventory,
    sqliteQuickCheck: journal.sqliteQuickCheck,
    salvaged: journal.salvaged,
    conflicts: journal.conflicts,
    completedAt: journal.completedAt,
    runtimeVerifiedAt: journal.runtimeVerifiedAt,
    runtimeVerificationAttempts: journal.runtimeVerificationAttempts,
    runtimeVerificationLastAttemptAt: journal.runtimeVerificationLastAttemptAt,
    runtimeVerificationMissingThreadIds: journal.runtimeVerificationMissingThreadIds,
    runtimeVerificationStoppedAt: journal.runtimeVerificationStoppedAt
  })
  return reportPath
}

export function assertSettingsSelectionStable(
  journal: RuntimeMigrationJournal,
  options: {
    userDataPath: string
    homeDir: string
    platform: NodeJS.Platform
  }
): void {
  const current = readSettingsSelection(
    options.userDataPath,
    options.homeDir,
    options.platform,
    pathState(journal.sourcePath)
  )
  if (
    !sameFilesystemPath(current.sourcePath, journal.settingsSourcePath, options.platform) ||
    !sameFilesystemPath(current.writePath, journal.settingsWritePath, options.platform)
  ) {
    throw new Error('the active settings source changed while Runtime migration was in progress')
  }
}

export function restoreDestinationBackup(
  journal: RuntimeMigrationJournal,
  platform: NodeJS.Platform,
  sleep: (milliseconds: number) => void
): void {
  if (
    journal.destinationBackupPath &&
    pathState(journal.destinationBackupPath) === 'dir' &&
    pathState(journal.targetPath) === 'missing'
  ) {
    retryRuntimeMigrationMutation(
      () => renameSync(journal.destinationBackupPath!, journal.targetPath),
      { platform, sleep }
    )
  }
}

export function finishPromotedDirectoryRollback(
  journalPath: string,
  initialJournal: RuntimeMigrationJournal,
  options: {
    platform: NodeJS.Platform
    sleep: (milliseconds: number) => void
    now: () => Date
    afterPhase: (phase: MigrationPhase) => void
  }
): RuntimeMigrationJournal {
  let journal = initialJournal

  if (journal.phase === 'rollback-conflict-planned') {
    const conflictBackupPath = journal.cutoverConflictBackupPaths.at(-1)
    if (!conflictBackupPath) {
      throw new Error('rollback journal has no planned cutover-conflict backup path')
    }
    const sourceState = pathState(journal.sourcePath)
    const conflictState = pathState(conflictBackupPath)
    if (sourceState !== 'missing' && conflictState === 'missing') {
      retryRuntimeMigrationMutation(
        () => renameSync(journal.sourcePath, conflictBackupPath),
        { platform: options.platform, sleep: options.sleep }
      )
    } else if (!(sourceState === 'missing' && conflictState !== 'missing')) {
      throw new Error('cutover-conflict backup state is inconsistent with the rollback journal')
    }
    journal = updateJournal(
      journalPath,
      journal,
      { phase: 'rollback-conflict-backed-up' },
      options.now
    )
    options.afterPhase('rollback-conflict-backed-up')
  }

  if (journal.phase === 'rollback-conflict-backed-up') {
    const sourceState = pathState(journal.sourcePath)
    const targetState = pathState(journal.targetPath)
    if (sourceState === 'missing' && targetState === 'dir') {
      retryRuntimeMigrationMutation(
        () => renameSync(journal.targetPath, journal.sourcePath),
        { platform: options.platform, sleep: options.sleep }
      )
    } else if (!(sourceState === 'dir' && targetState === 'missing')) {
      throw new Error('promoted source restoration state is inconsistent with the rollback journal')
    }
    assertStoreInventoryContains(
      journal.sourcePath,
      journal.sourceInventory,
      'restored authoritative Runtime source'
    )
    journal = updateJournal(
      journalPath,
      journal,
      { phase: 'rollback-source-restored' },
      options.now
    )
    options.afterPhase('rollback-source-restored')
  }

  if (journal.phase === 'rollback-source-restored') {
    if (journal.destinationBackupPath) {
      const targetState = pathState(journal.targetPath)
      const backupState = pathState(journal.destinationBackupPath)
      if (targetState === 'missing' && backupState === 'dir') {
        retryRuntimeMigrationMutation(
          () => renameSync(journal.destinationBackupPath!, journal.targetPath),
          { platform: options.platform, sleep: options.sleep }
        )
      } else if (!(targetState === 'dir' && backupState === 'missing')) {
        throw new Error('destination restoration state is inconsistent with the rollback journal')
      }
      assertStoreInventoryContains(
        journal.targetPath,
        journal.destinationInventory,
        'restored displaced Runtime destination'
      )
    } else if (pathState(journal.targetPath) !== 'missing') {
      throw new Error('unexpected Runtime destination appeared while rollback was restoring names')
    }
    journal = updateJournal(
      journalPath,
      journal,
      { phase: 'settings-backed-up' },
      options.now
    )
    options.afterPhase('settings-backed-up')
  }

  return journal
}

export function rollBackPromotedDirectories(
  journalPath: string,
  initialJournal: RuntimeMigrationJournal,
  options: {
    platform: NodeJS.Platform
    sleep: (milliseconds: number) => void
    now: () => Date
    afterPhase: (phase: MigrationPhase) => void
  },
  error: unknown
): RuntimeMigrationJournal {
  let journal = initialJournal
  const sourceState = pathState(journal.sourcePath)
  if (sourceState !== 'missing') {
    const conflictBackupPath = uniqueSiblingBackup(
      journal.sourcePath,
      'cutover-conflict',
      options.now
    )
    journal = updateJournal(
      journalPath,
      journal,
      {
        phase: 'rollback-conflict-planned',
        cutoverConflictBackupPaths: [
          ...journal.cutoverConflictBackupPaths,
          conflictBackupPath
        ],
        error: error instanceof Error ? error.message : String(error)
      },
      options.now
    )
    options.afterPhase('rollback-conflict-planned')
  } else {
    journal = updateJournal(
      journalPath,
      journal,
      {
        phase: 'rollback-conflict-backed-up',
        error: error instanceof Error ? error.message : String(error)
      },
      options.now
    )
    options.afterPhase('rollback-conflict-backed-up')
  }

  return finishPromotedDirectoryRollback(journalPath, journal, options)
}
