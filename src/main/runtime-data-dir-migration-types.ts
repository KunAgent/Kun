import {
  type CanonicalKunDataDirKind
} from './kun-data-dir-paths'
import {
  type MigrationLogger
} from './legacy-data-migration'



export const JOURNAL_FILE_NAME = 'kun-runtime-data-migration-v2.json'
export const REPORT_FILE_NAME = 'kun-runtime-data-migration-v2-report.json'
export const PRESERVATION_JOURNAL_FILE_NAME = 'kun-runtime-data-migration-v3.json'
export const PRESERVATION_REPORT_FILE_NAME = 'kun-runtime-data-migration-v3-report.json'
export const SALVAGE_ROOTS = [
  'threads',
  'attachments',
  'artifacts',
  'child-runs',
  'delegated-sessions',
  'extensions',
  'extension-data',
  'memory',
  'task-graphs',
  'model-routing',
  'observability'
] as const
export const PROTECTED_IDENTITY_ENTRIES = [
  'credentials',
  'mcp-oauth',
  'extensions/providers.json',
  'extensions/accounts.json',
  'extensions/provider-bindings.json',
  'extensions/legacy-credential-migrations.json',
  'secret.key'
] as const
export const PROTECTED_EXTENSION_ENTRY_NAMES = new Set(
  PROTECTED_IDENTITY_ENTRIES
    .filter((entry) => entry.startsWith('extensions/'))
    .map((entry) => entry.slice('extensions/'.length))
)
export const RETRYABLE_WINDOWS_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
export const BEST_EFFORT_WINDOWS_FSYNC_CODES = new Set([
  'EPERM',
  'EBUSY',
  'EACCES',
  'EINVAL',
  'ENOSYS',
  'ENOTSUP'
])
export const MIGRATION_SCHEMA_VERSION = 2 as const
export const PRESERVATION_SCHEMA_VERSION = 3 as const
export const COPY_CAPACITY_MIN_RESERVE_BYTES = 5 * 1024 * 1024 * 1024
export const COPY_CAPACITY_SOURCE_RESERVE_RATIO = 0.1

export type PathState = 'missing' | 'symlink' | 'dir' | 'other' | 'inaccessible'
export type MigrationPhase =
  | 'prepared'
  | 'settings-backed-up'
  | 'destination-backed-up'
  | 'source-promoted'
  | 'rollback-conflict-planned'
  | 'rollback-conflict-backed-up'
  | 'rollback-source-restored'
  | 'link-created'
  | 'salvaged'
  | 'extension-registry-backed-up'
  | 'extension-registry-rebased'
  | 'settings-rewritten'
  | 'completed'
export const MIGRATION_PHASES = new Set<MigrationPhase>([
  'prepared',
  'settings-backed-up',
  'destination-backed-up',
  'source-promoted',
  'rollback-conflict-planned',
  'rollback-conflict-backed-up',
  'rollback-source-restored',
  'link-created',
  'salvaged',
  'extension-registry-backed-up',
  'extension-registry-rebased',
  'settings-rewritten',
  'completed'
])
export const ROLLBACK_PHASES = new Set<MigrationPhase>([
  'rollback-conflict-planned',
  'rollback-conflict-backed-up',
  'rollback-source-restored'
])

export type RuntimeMigrationJournal = {
  schemaVersion: typeof MIGRATION_SCHEMA_VERSION
  phase: MigrationPhase
  sourcePath: string
  targetPath: string
  destinationBackupPath?: string
  cutoverConflictBackupPaths: string[]
  settingsSourcePath?: string
  settingsWritePath?: string
  settingsBackupPaths: string[]
  settingsBackedUp?: boolean
  extensionRegistryBackupPaths?: string[]
  extensionRegistryRebasedRecords?: number
  extensionRegistryRebasedAt?: string
  sourceWasMissing?: boolean
  sourceThreadIds: string[]
  sourceInventory?: RuntimeStoreInventory
  destinationInventory?: RuntimeStoreInventory
  targetInventory?: RuntimeStoreInventory
  sqliteQuickCheck?: 'missing' | 'ok' | 'invalid'
  salvaged: number
  conflicts: string[]
  startedAt: string
  updatedAt: string
  completedAt?: string
  runtimeVerifiedAt?: string
  runtimeVerificationAttempts?: number
  runtimeVerificationLastAttemptAt?: string
  runtimeVerificationMissingThreadIds?: string[]
  runtimeVerificationStoppedAt?: string
  error?: string
}

export type RuntimeDataDirMigrationResult = {
  status: 'not-needed' | 'completed' | 'blocked'
  authority: CanonicalKunDataDirKind | 'unknown'
  sourcePath: string
  targetPath: string
  destinationBackupPath?: string
  journalPath: string
  reportPath?: string
  message?: string
}

export type RuntimeDataDirMigrationOptions = {
  userDataPath: string
  homeDir: string
  platform?: NodeJS.Platform
  log?: MigrationLogger
  now?: () => Date
  sleep?: (milliseconds: number) => void
  statDevice?: (path: string) => string | number | bigint
  assertLegacyRuntimeInactive?: (sourcePath: string) => void
  afterPhase?: (phase: MigrationPhase) => void
  afterPreservationPhase?: (phase: PreservationPhase) => void
  beforeCompatibilityLink?: () => void
  availableCopyBytes?: (path: string) => number
  /**
   * Keeps version-2 recovery coverage available without exposing rename-based
   * migration to production startup. New callers must never set this flag.
   */
  skipHistoryPreservationForTests?: boolean
}

export type RuntimeStoreInventory = {
  files: number
  directories: number
  symlinks: number
  bytes: number
}

export function isRuntimeStoreInventory(value: unknown): value is RuntimeStoreInventory {
  if (!isObjectRecord(value)) return false
  return Number.isSafeInteger(value.files) &&
    (value.files as number) >= 0 &&
    Number.isSafeInteger(value.directories) &&
    (value.directories as number) >= 0 &&
    Number.isSafeInteger(value.symlinks) &&
    (value.symlinks as number) >= 0 &&
    Number.isSafeInteger(value.bytes) &&
    (value.bytes as number) >= 0
}

export type PreservationPhase =
  | 'prepared'
  | 'settings-backed-up'
  | 'candidate-copied'
  | 'candidate-verified'
  | 'candidate-rebased'
  | 'destination-backed-up'
  | 'destination-salvaged'
  | 'target-activated'
  | 'settings-rewritten'
  | 'legacy-link-backed-up'
  | 'completed'

export const PRESERVATION_PHASES = new Set<PreservationPhase>([
  'prepared',
  'settings-backed-up',
  'candidate-copied',
  'candidate-verified',
  'candidate-rebased',
  'destination-backed-up',
  'destination-salvaged',
  'target-activated',
  'settings-rewritten',
  'legacy-link-backed-up',
  'completed'
])

export type PreservationProvenance =
  | 'original-legacy-source'
  | 'reconstructed-from-current'
  | 'no-legacy-source'

export type PreservationJournal = {
  schemaVersion: typeof PRESERVATION_SCHEMA_VERSION
  phase: PreservationPhase
  provenance: PreservationProvenance
  sourcePath: string
  targetPath: string
  stagingPath: string
  destinationBackupPath?: string
  compatibilityLinkBackupPath?: string
  settingsSourcePath?: string
  settingsWritePath?: string
  settingsBackupPaths: string[]
  mergeIntoCurrent?: boolean
  sourceThreadIds: string[]
  sourceInventory: RuntimeStoreInventory
  sourceFingerprint?: string
  candidateFingerprint?: string
  activationFingerprint?: string
  extensionRegistryRebasedRecords?: number
  salvaged: number
  conflicts: string[]
  targetInventory?: RuntimeStoreInventory
  sqliteQuickCheck?: 'missing' | 'ok' | 'invalid'
  startedAt: string
  updatedAt: string
  completedAt?: string
  runtimeVerifiedAt?: string
  runtimeVerificationAttempts?: number
  runtimeVerificationLastAttemptAt?: string
  runtimeVerificationMissingThreadIds?: string[]
  runtimeVerificationStoppedAt?: string
  error?: string
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
