import {
  readFileSync
} from 'node:fs'
import {
  dirname,
  join
} from 'node:path'
import {
  canonicalLegacyKunDataDir
} from './kun-data-dir-paths'
import {
  type MigrationLogger
} from './legacy-data-migration'
import {
  JOURNAL_FILE_NAME,
  PRESERVATION_JOURNAL_FILE_NAME,
  PRESERVATION_REPORT_FILE_NAME,
  PRESERVATION_SCHEMA_VERSION,
  type PreservationJournal,
  type PreservationPhase,
  type RuntimeDataDirMigrationOptions,
  type RuntimeDataDirMigrationResult,
  type RuntimeStoreInventory
} from './runtime-data-dir-migration-types'
import {
  pathState,
  readJournal,
  sameFilesystemPath,
  writeDurableJson
} from './runtime-data-dir-migration-journal-v2'
import {
  updatePreservationJournal
} from './runtime-data-dir-migration-journal-preservation'
import {
  readSettingsSelection,
  runtimeStoreInventory,
  threadIds
} from './runtime-data-dir-migration-inventory'
import {
  backUpSettingsFile,
  rewriteSettingsToCurrent,
  validateSqliteIndex
} from './runtime-data-dir-migration-copy'
import {
  inspectExtensionRegistryForRebase,
  repairCompletedExtensionRegistry
} from './runtime-data-dir-migration-extensions'
import {
  writeReport
} from './runtime-data-dir-migration-salvage'



export type PreservationMigrationOptions = Required<
  Pick<RuntimeDataDirMigrationOptions, 'userDataPath' | 'homeDir'>
> & {
  platform: NodeJS.Platform
  log: MigrationLogger
  now: () => Date
  sleep: (milliseconds: number) => void
  assertLegacyRuntimeInactive: (sourcePath: string) => void
  afterPhase: (phase: PreservationPhase) => void
  availableCopyBytes: (path: string) => number
}

export function assertPreservationSettingsSelectionStable(
  journal: PreservationJournal,
  options: Pick<PreservationMigrationOptions, 'userDataPath' | 'homeDir' | 'platform'>
): void {
  const current = readSettingsSelection(
    options.userDataPath,
    options.homeDir,
    options.platform,
    pathState(journal.sourcePath)
  )
  if (
    current.authority === 'custom' ||
    current.authority === 'unknown' ||
    (journal.mergeIntoCurrent === true && current.authority !== 'current') ||
    !sameFilesystemPath(current.sourcePath, journal.settingsSourcePath, options.platform) ||
    !sameFilesystemPath(current.writePath, journal.settingsWritePath, options.platform)
  ) {
    throw new Error(
      'the active settings source changed while history-preserving Runtime migration was in progress'
    )
  }
}

export function writePreservationReport(
  userDataPath: string,
  journal: PreservationJournal,
  preservedPath = canonicalLegacyKunDataDir(dirname(dirname(journal.targetPath)))
): string {
  const reportPath = join(userDataPath, PRESERVATION_REPORT_FILE_NAME)
  writeDurableJson(reportPath, {
    schemaVersion: PRESERVATION_SCHEMA_VERSION,
    status: journal.phase,
    provenance: journal.provenance,
    sourcePath: journal.sourcePath,
    targetPath: journal.targetPath,
    stagingPath: journal.stagingPath,
    destinationBackupPath: journal.destinationBackupPath,
    compatibilityLinkBackupPath: journal.compatibilityLinkBackupPath,
    settingsSourcePath: journal.settingsSourcePath,
    settingsBackupPaths: journal.settingsBackupPaths,
    mergeIntoCurrent: journal.mergeIntoCurrent,
    sourceThreadCount: journal.sourceThreadIds.length,
    sourceInventory: journal.sourceInventory,
    sourceFingerprint: journal.sourceFingerprint,
    candidateFingerprint: journal.candidateFingerprint,
    activationFingerprint: journal.activationFingerprint,
    extensionRegistryRebasedRecords: journal.extensionRegistryRebasedRecords,
    salvaged: journal.salvaged,
    conflicts: journal.conflicts,
    targetInventory: journal.targetInventory,
    sqliteQuickCheck: journal.sqliteQuickCheck,
    completedAt: journal.completedAt,
    runtimeVerifiedAt: journal.runtimeVerifiedAt,
    runtimeVerificationInventory: journal.runtimeVerificationInventory,
    runtimeVerificationAttempts: journal.runtimeVerificationAttempts,
    runtimeVerificationLastAttemptAt: journal.runtimeVerificationLastAttemptAt,
    runtimeVerificationMissingThreadIds: journal.runtimeVerificationMissingThreadIds,
    runtimeVerificationStoppedAt: journal.runtimeVerificationStoppedAt,
    exactPreMigrationSnapshot: journal.provenance !== 'reconstructed-from-current',
    ...(journal.provenance === 'no-legacy-source' ? { sourceExisted: false } : {}),
    ...(journal.provenance === 'reconstructed-from-current' ? {
      reconstructedPath: preservedPath,
      warning: 'The version-2 migration did not retain an independent original; ' +
        'this directory was reconstructed from the current store.'
    } : {})
  })
  return reportPath
}

export function validateHistoryPreservingTarget(
  journal: PreservationJournal
): {
  targetInventory: RuntimeStoreInventory
  sqliteQuickCheck: 'missing' | 'ok' | 'invalid'
} {
  if (pathState(journal.targetPath) !== 'dir') {
    throw new Error(`history-preserving Runtime target is unavailable: ${journal.targetPath}`)
  }
  const migratedThreadIds = new Set(threadIds(journal.targetPath))
  const missing = journal.sourceThreadIds.filter((threadId) => !migratedThreadIds.has(threadId))
  if (missing.length > 0) {
    throw new Error(
      `history-preserving Runtime target is missing ${missing.length} source thread directories`
    )
  }
  const configPath = join(journal.targetPath, 'config.json')
  const configState = pathState(configPath)
  if (configState === 'other' || configState === 'symlink') {
    JSON.parse(readFileSync(configPath, 'utf8'))
  } else if (configState !== 'missing') {
    throw new Error(`history-preserving Runtime config is not a readable file: ${configPath}`)
  }
  const targetInventory = runtimeStoreInventory(journal.targetPath)
  if (
    targetInventory.files < journal.sourceInventory.files ||
    targetInventory.directories < journal.sourceInventory.directories ||
    targetInventory.symlinks < journal.sourceInventory.symlinks
  ) {
    throw new Error('history-preserving Runtime target inventory is missing source entries')
  }
  return {
    targetInventory,
    sqliteQuickCheck: validateSqliteIndex(journal.targetPath)
  }
}

export function validateHistoryPreservingCandidate(
  journal: PreservationJournal,
  platform: NodeJS.Platform
): void {
  if (pathState(journal.stagingPath) !== 'dir') {
    throw new Error(`history-preserving Runtime candidate is unavailable: ${journal.stagingPath}`)
  }
  const candidateThreadIds = new Set(threadIds(journal.stagingPath))
  const missing = journal.sourceThreadIds.filter(
    (threadId) => !candidateThreadIds.has(threadId)
  )
  if (missing.length > 0) {
    throw new Error(
      `history-preserving Runtime candidate is missing ${missing.length} source thread directories`
    )
  }
  const configPath = join(journal.stagingPath, 'config.json')
  const configState = pathState(configPath)
  if (configState === 'other' || configState === 'symlink') {
    try {
      JSON.parse(readFileSync(configPath, 'utf8'))
    } catch {
      throw new Error(
        `history-preserving Runtime candidate config is not valid JSON: ${configPath}`
      )
    }
  } else if (configState !== 'missing') {
    throw new Error(`history-preserving Runtime candidate config is unreadable: ${configPath}`)
  }
  const candidateInventory = runtimeStoreInventory(journal.stagingPath)
  if (
    candidateInventory.files < journal.sourceInventory.files ||
    candidateInventory.directories < journal.sourceInventory.directories ||
    candidateInventory.symlinks < journal.sourceInventory.symlinks
  ) {
    throw new Error('history-preserving Runtime candidate inventory is missing source entries')
  }
  const inspection = inspectExtensionRegistryForRebase(
    journal.sourcePath,
    journal.targetPath,
    platform,
    journal.stagingPath
  )
  if (inspection.kind === 'registry' && inspection.rebasedRecords > 0) {
    throw new Error('history-preserving Runtime candidate registry was not fully rebased')
  }
}

export function maintainCompletedPreservationMigration(
  initialJournal: PreservationJournal,
  options: PreservationMigrationOptions,
  skipPreservedHistoryDriftCheck = false
): RuntimeDataDirMigrationResult {
  const journalPath = join(options.userDataPath, PRESERVATION_JOURNAL_FILE_NAME)
  let journal = initialJournal
  try {
    if (pathState(journal.targetPath) !== 'dir') {
      throw new Error('committed history-preserving Runtime target is missing')
    }
    const selection = readSettingsSelection(
      options.userDataPath,
      options.homeDir,
      options.platform,
      pathState(journal.sourcePath)
    )
    if (selection.authority === 'custom') {
      return {
        status: 'not-needed',
        authority: 'custom',
        sourcePath: journal.sourcePath,
        targetPath: journal.targetPath,
        ...(journal.destinationBackupPath
          ? { destinationBackupPath: journal.destinationBackupPath }
          : {}),
        journalPath
      }
    }
    if (selection.authority === 'unknown') {
      throw new Error('could not determine Runtime data authority from the active settings source')
    }
    const preservedPath = canonicalLegacyKunDataDir(options.homeDir, options.platform)
    if (journal.provenance === 'original-legacy-source') {
      if (pathState(journal.sourcePath) !== 'dir') {
        throw new Error('preserved legacy Runtime source is no longer a real directory')
      }
    } else if (journal.provenance === 'reconstructed-from-current') {
      if (pathState(preservedPath) !== 'dir') {
        throw new Error('reconstructed legacy Runtime history is no longer a real directory')
      }
      const v2JournalPath = join(options.userDataPath, JOURNAL_FILE_NAME)
      const v2Journal = readJournal(v2JournalPath)
      if (v2Journal?.phase === 'completed') {
        const repairedV2 = repairCompletedExtensionRegistry(
          v2JournalPath,
          v2Journal,
          options
        )
        writeReport(options.userDataPath, repairedV2)
      }
    }
    if (selection.authority === 'legacy') {
      const settingsBackupPaths = backUpSettingsFile(selection.writePath, options.now)
      journal = updatePreservationJournal(
        journalPath,
        journal,
        {
          settingsSourcePath: selection.sourcePath,
          settingsWritePath: selection.writePath,
          settingsBackupPaths: [
            ...journal.settingsBackupPaths,
            ...settingsBackupPaths
          ],
          error: undefined
        },
        options.now
      )
      rewriteSettingsToCurrent(selection.writePath)
    }
    const reportPath = writePreservationReport(options.userDataPath, journal, preservedPath)
    // Activation has already checked the candidate bytes. A later audit of the
    // independent backup can report drift once the desktop is ready.
    const checkContents = process.env.KUN_VERIFY_PRESERVED_HISTORY === '1' ||
      (!journal.runtimeVerifiedAt && !journal.runtimeVerificationStoppedAt)
    const fingerprint = journal.provenance === 'reconstructed-from-current'
      ? journal.candidateFingerprint : journal.sourceFingerprint
    return {
      status: 'completed',
      authority: 'current',
      sourcePath: journal.sourcePath,
      targetPath: journal.targetPath,
      ...(journal.destinationBackupPath
        ? { destinationBackupPath: journal.destinationBackupPath }
        : {}),
      journalPath,
      reportPath,
      ...(!skipPreservedHistoryDriftCheck && journal.provenance !== 'no-legacy-source' ? {
        preservedHistoryCheck: {
          path: preservedPath,
          inventory: journal.sourceInventory,
          ...(checkContents ? { fingerprint } : {})
        }
      } : {})
    }
  } catch (error) {
    return {
      status: 'blocked',
      authority: 'current',
      sourcePath: journal.sourcePath,
      targetPath: journal.targetPath,
      ...(journal.destinationBackupPath
        ? { destinationBackupPath: journal.destinationBackupPath }
        : {}),
      journalPath,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
