import {
  readFileSync
} from 'node:fs'
import {
  canonicalCurrentKunDataDir,
  canonicalLegacyKunDataDir
} from './kun-data-dir-paths'
import {
  settingsReadCandidates
} from './settings-file-paths'
import {
  isRuntimeStoreInventory,
  PRESERVATION_PHASES,
  PRESERVATION_SCHEMA_VERSION,
  type PreservationJournal,
  type PreservationPhase,
  type RuntimeMigrationJournal
} from './runtime-data-dir-migration-types'
import {
  isMigrationOwnedSiblingBackup,
  pathState,
  sameFilesystemPath,
  writeDurableJson
} from './runtime-data-dir-migration-journal-v2'



export function readPreservationJournal(path: string): PreservationJournal | null {
  if (pathState(path) !== 'other') return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<PreservationJournal>
    const stringArray = (value: unknown): value is string[] =>
      Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    const inventory = parsed.sourceInventory
    const targetInventory = parsed.targetInventory
    if (
      parsed.schemaVersion !== PRESERVATION_SCHEMA_VERSION ||
      typeof parsed.phase !== 'string' ||
      !PRESERVATION_PHASES.has(parsed.phase as PreservationPhase) ||
      (
        parsed.provenance !== 'original-legacy-source' &&
        parsed.provenance !== 'reconstructed-from-current' &&
        parsed.provenance !== 'no-legacy-source'
      ) ||
      typeof parsed.sourcePath !== 'string' ||
      typeof parsed.targetPath !== 'string' ||
      typeof parsed.stagingPath !== 'string' ||
      (parsed.destinationBackupPath !== undefined && typeof parsed.destinationBackupPath !== 'string') ||
      (
        parsed.compatibilityLinkBackupPath !== undefined &&
        typeof parsed.compatibilityLinkBackupPath !== 'string'
      ) ||
      (parsed.settingsSourcePath !== undefined && typeof parsed.settingsSourcePath !== 'string') ||
      (parsed.settingsWritePath !== undefined && typeof parsed.settingsWritePath !== 'string') ||
      !stringArray(parsed.settingsBackupPaths) ||
      (parsed.mergeIntoCurrent !== undefined && typeof parsed.mergeIntoCurrent !== 'boolean') ||
      !stringArray(parsed.sourceThreadIds) ||
      !isRuntimeStoreInventory(inventory) ||
      (targetInventory !== undefined && !isRuntimeStoreInventory(targetInventory)) ||
      (
        parsed.sqliteQuickCheck !== undefined &&
        parsed.sqliteQuickCheck !== 'missing' &&
        parsed.sqliteQuickCheck !== 'ok' &&
        parsed.sqliteQuickCheck !== 'invalid'
      ) ||
      (parsed.sourceFingerprint !== undefined && typeof parsed.sourceFingerprint !== 'string') ||
      (parsed.candidateFingerprint !== undefined && typeof parsed.candidateFingerprint !== 'string') ||
      (
        parsed.activationFingerprint !== undefined &&
        (
          typeof parsed.activationFingerprint !== 'string' ||
          !/^[a-f0-9]{64}$/u.test(parsed.activationFingerprint)
        )
      ) ||
      (
        parsed.extensionRegistryRebasedRecords !== undefined &&
        (
          !Number.isSafeInteger(parsed.extensionRegistryRebasedRecords) ||
          parsed.extensionRegistryRebasedRecords < 0
        )
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
    return parsed as PreservationJournal
  } catch {
    return null
  }
}

export function validatePreservationJournalForRecovery(
  journal: PreservationJournal,
  input: {
    userDataPath: string
    homeDir: string
    platform: NodeJS.Platform
  }
): string | null {
  const expectedLegacy = canonicalLegacyKunDataDir(input.homeDir, input.platform)
  const expectedCurrent = canonicalCurrentKunDataDir(input.homeDir, input.platform)
  const expectedSource =
    journal.provenance === 'reconstructed-from-current' ? expectedCurrent : expectedLegacy
  const stagingOriginal =
    journal.provenance === 'reconstructed-from-current' ? expectedLegacy : expectedCurrent
  if (
    !sameFilesystemPath(journal.sourcePath, expectedSource, input.platform) ||
    !sameFilesystemPath(journal.targetPath, expectedCurrent, input.platform)
  ) {
    return 'the Runtime preservation journal contains non-canonical source or target paths'
  }
  if (
    !isMigrationOwnedSiblingBackup(
      journal.stagingPath,
      stagingOriginal,
      'history-preserving-staging',
      input.platform
    )
  ) {
    return 'the Runtime preservation journal contains an unsafe staging path'
  }
  if (
    journal.destinationBackupPath &&
    !isMigrationOwnedSiblingBackup(
      journal.destinationBackupPath,
      expectedCurrent,
      'pre-history-preserving-migration',
      input.platform
    )
  ) {
    return 'the Runtime preservation journal contains an unsafe destination backup path'
  }
  if (
    journal.compatibilityLinkBackupPath &&
    !isMigrationOwnedSiblingBackup(
      journal.compatibilityLinkBackupPath,
      expectedLegacy,
      'pre-preservation-compatibility-link',
      input.platform
    )
  ) {
    return 'the Runtime preservation journal contains an unsafe compatibility-link backup path'
  }
  if (journal.settingsSourcePath) {
    const candidates = settingsReadCandidates(input.userDataPath)
    if (!candidates.some((candidate) =>
      sameFilesystemPath(candidate, journal.settingsSourcePath, input.platform))) {
      return 'the Runtime preservation journal contains an unknown settings source path'
    }
  }
  if (journal.settingsWritePath && !journal.settingsSourcePath) {
    return 'the Runtime preservation journal has a settings write path without a source path'
  }
  if (journal.settingsBackupPaths.some((backupPath) => {
    if (!journal.settingsWritePath) return true
    return !isMigrationOwnedSiblingBackup(
      backupPath,
      journal.settingsWritePath,
      'pre-runtime-data-migration',
      input.platform
    )
  })) {
    return 'the Runtime preservation journal contains an unsafe settings backup path'
  }
  if (journal.phase === 'completed' && !journal.completedAt) {
    return 'the Runtime preservation journal completed phase has no completion timestamp'
  }
  if (
    (
      journal.phase === 'candidate-verified' ||
      journal.phase === 'candidate-rebased' ||
      journal.phase === 'destination-backed-up' ||
      journal.phase === 'destination-salvaged' ||
      journal.phase === 'target-activated' ||
      journal.phase === 'settings-rewritten' ||
      journal.phase === 'legacy-link-backed-up' ||
      journal.phase === 'completed'
    ) &&
    (!journal.sourceFingerprint || !journal.candidateFingerprint)
  ) {
    return 'the Runtime preservation journal phase has no verified source fingerprint'
  }
  return null
}

export function updatePreservationJournal(
  path: string,
  journal: PreservationJournal,
  patch: Partial<PreservationJournal>,
  now: () => Date
): PreservationJournal {
  const next: PreservationJournal = {
    ...journal,
    ...patch,
    updatedAt: now().toISOString()
  }
  writeDurableJson(path, next)
  return next
}

export function updateJournal(
  path: string,
  journal: RuntimeMigrationJournal,
  patch: Partial<RuntimeMigrationJournal>,
  now: () => Date
): RuntimeMigrationJournal {
  const next: RuntimeMigrationJournal = {
    ...journal,
    ...patch,
    updatedAt: now().toISOString()
  }
  writeDurableJson(path, next)
  return next
}
