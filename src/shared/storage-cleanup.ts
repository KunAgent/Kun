/**
 * Storage management contract shared by main, preload and the Settings page.
 *
 * Cleanup is tiered. Rebuildable caches can be cleared without asking. Old
 * content (idle thread replay logs, empty task worktree folders) is only
 * cleaned automatically after the user consents once to a rule set; shrinking
 * the age threshold or widening the rule set needs a fresh consent. Everything
 * the cleaner deletes from disk goes through a trash folder first.
 */

export const STORAGE_CLEANUP_DEFAULT_OLDER_THAN_DAYS = 30
export const STORAGE_CLEANUP_MIN_DAYS = 1
export const STORAGE_CLEANUP_MAX_DAYS = 3650
export const STORAGE_CLEANUP_DEFAULT_TRASH_DAYS = 7
/** Trajectory records and other diagnostics are kept this long by the auto tier. */
export const STORAGE_DIAGNOSTICS_RETENTION_DAYS = 14
/** Automatic runs happen at most this often. */
export const STORAGE_CLEANUP_RUN_INTERVAL_DAYS = 7
/** How long the advance notice waits before an automatic run proceeds. */
export const STORAGE_CLEANUP_NOTICE_LEAD_MS = 24 * 60 * 60 * 1000

export type StorageUsageCategoryId =
  | 'worktrees'
  | 'threads'
  | 'agents'
  | 'caches'
  | 'attachments'
  | 'other'

export type StorageUsageCategory = {
  id: StorageUsageCategoryId
  bytes: number
  /** Optional detail, e.g. how much of `threads` is replay events. */
  detailBytes?: number
}

export type StorageManualItemId =
  | 'agentRuntimes'
  | 'toolchains'
  | 'avatar3d'
  | 'indexDatabase'
  | 'migrationBackups'

export type StorageManualItem = {
  id: StorageManualItemId
  bytes: number
  path: string
  /** Backups can be moved to the trash from Settings; the others are reveal-only. */
  removable: boolean
}

export type StorageUsageSnapshot = {
  scannedAt: string
  totalBytes: number
  kunDataRoot: string
  categories: StorageUsageCategory[]
  /** Bytes the "clear caches" action can reclaim now. */
  safeCleanBytes: number
  manual: StorageManualItem[]
}

export type StorageCleanupConsent = {
  at: string
  olderThanDays: number
  rulesVersion: number
}

/** Bumped whenever a new category joins the consented automatic rules. */
export const STORAGE_CLEANUP_RULES_VERSION = 1

export type StorageCleanupConfig = {
  enabled: boolean
  olderThanDays: number
  notifyBefore: boolean
  trashDays: number
  consent?: StorageCleanupConsent
  lastRunAt?: string
  /** A notice was shown; the automatic run proceeds after this instant. */
  pendingRunAt?: string
  /** The user skipped the pending run; no notice before this instant. */
  skipUntil?: string
}

export type StorageCleanupState =
  | 'off'
  | 'needs_consent'
  | 'scheduled'
  | 'pending'

export type StorageCleanupStatus = {
  config: StorageCleanupConfig
  state: StorageCleanupState
  nextRunAt?: string
  trash: StorageTrashSummary
}

export type StoragePlanItemKind = 'threadSlim' | 'emptyWorktree' | 'trajectoryRecord'

export type StoragePlanItem = {
  /** Stable id within a plan: kind + thread id or relative path. */
  id: string
  kind: StoragePlanItemKind
  title: string
  detail?: string
  updatedAt?: string
  bytes: number
}

export type StoragePlanSkipCounts = {
  pinned: number
  active: number
  room: number
  goal: number
  recent: number
}

export type StorageCleanupPlan = {
  createdAt: string
  olderThanDays: number
  idleBefore: string
  items: StoragePlanItem[]
  totalBytes: number
  skipped: StoragePlanSkipCounts
  /** Thread candidates beyond this cap are left for the next run. */
  truncated: boolean
}

export type StorageCleanupRunReason = 'manual' | 'scheduled' | 'caches'

export type StorageCleanupResult = {
  runId: string
  reason: StorageCleanupRunReason
  startedAt: string
  finishedAt: string
  /** Released right away (slimmed logs, cleared caches). */
  freedBytes: number
  /** Moved to the trash; released when the trash run expires or is emptied. */
  trashedBytes: number
  slimmedThreads: number
  movedToTrash: number
  failed: number
  lines: Array<{ kind: StoragePlanItemKind | 'cache' | 'backup'; count: number; bytes: number }>
}

export type StorageTrashRun = {
  runId: string
  createdAt: string
  expiresAt: string
  entries: number
  bytes: number
}

export type StorageTrashSummary = {
  runs: StorageTrashRun[]
  bytes: number
  entries: number
}

export type StorageCleanupHistoryEntry = StorageCleanupResult | {
  runId: string
  reason: 'skipped'
  startedAt: string
}

export type StorageCleanupConfigPatch = {
  olderThanDays?: number
  notifyBefore?: boolean
  trashDays?: number
}

export type StorageCleanupApi = {
  getStatus: () => Promise<StorageCleanupStatus>
  scan: () => Promise<StorageUsageSnapshot>
  /** Enabling requires the age threshold the user saw in the consent dialog. */
  enable: (input: { olderThanDays: number }) => Promise<StorageCleanupStatus>
  disable: () => Promise<StorageCleanupStatus>
  updateConfig: (patch: StorageCleanupConfigPatch) => Promise<StorageCleanupStatus>
  preview: (input?: { olderThanDays?: number }) => Promise<StorageCleanupPlan>
  /** Run the given plan items now (a subset of a preview the user reviewed). */
  run: (input: { olderThanDays: number; itemIds: string[] }) => Promise<StorageCleanupResult>
  clearCaches: () => Promise<StorageCleanupResult>
  removeMigrationBackups: () => Promise<StorageCleanupResult>
  skipPendingRun: () => Promise<StorageCleanupStatus>
  history: () => Promise<StorageCleanupHistoryEntry[]>
  restoreTrashRun: (runId: string) => Promise<StorageTrashSummary>
  emptyTrash: () => Promise<StorageTrashSummary>
  reveal: (itemId: StorageManualItemId | 'dataRoot') => Promise<void>
  /** The advance-notice notification was clicked. */
  onNoticeClicked: (handler: () => void) => () => void
}

export function clampStorageCleanupDays(value: unknown, fallback = STORAGE_CLEANUP_DEFAULT_OLDER_THAN_DAYS): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(STORAGE_CLEANUP_MAX_DAYS, Math.max(STORAGE_CLEANUP_MIN_DAYS, Math.round(number)))
}

export function normalizeStorageCleanupConfig(raw: unknown): StorageCleanupConfig {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const consentRaw = value.consent && typeof value.consent === 'object' ? value.consent as Record<string, unknown> : null
  const iso = (input: unknown): string | undefined =>
    typeof input === 'string' && Number.isFinite(Date.parse(input)) ? input : undefined
  const consentAt = iso(consentRaw?.at)
  return {
    enabled: value.enabled === true,
    olderThanDays: clampStorageCleanupDays(value.olderThanDays),
    notifyBefore: value.notifyBefore !== false,
    trashDays: clampStorageCleanupDays(value.trashDays, STORAGE_CLEANUP_DEFAULT_TRASH_DAYS),
    ...(consentRaw && consentAt ? {
      consent: {
        at: consentAt,
        olderThanDays: clampStorageCleanupDays(consentRaw.olderThanDays),
        rulesVersion: typeof consentRaw.rulesVersion === 'number' ? consentRaw.rulesVersion : 0
      }
    } : {}),
    ...(iso(value.lastRunAt) ? { lastRunAt: iso(value.lastRunAt) } : {}),
    ...(iso(value.pendingRunAt) ? { pendingRunAt: iso(value.pendingRunAt) } : {}),
    ...(iso(value.skipUntil) ? { skipUntil: iso(value.skipUntil) } : {})
  }
}

/**
 * The automatic run may only proceed while the stored consent covers the
 * current rules: same rules version, and an age threshold no shorter than the
 * one the user agreed to (a shorter threshold deletes more).
 */
export function storageCleanupConsentCovers(config: StorageCleanupConfig): boolean {
  const consent = config.consent
  if (!consent) return false
  return consent.rulesVersion === STORAGE_CLEANUP_RULES_VERSION && config.olderThanDays >= consent.olderThanDays
}

export function storageCleanupState(config: StorageCleanupConfig): StorageCleanupState {
  if (!config.enabled) return 'off'
  if (!storageCleanupConsentCovers(config)) return 'needs_consent'
  return config.pendingRunAt ? 'pending' : 'scheduled'
}
