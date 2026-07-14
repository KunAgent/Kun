export const STORAGE_CLEANUP_CATEGORIES = [
  'threads',
  'attachments',
  'checkpoints',
  'worktrees',
  'logs',
  'diagnostics',
  'extensions',
  'models'
] as const

export type StorageCleanupCategory = typeof STORAGE_CLEANUP_CATEGORIES[number]

export type StorageCleanupCandidate = {
  category: StorageCleanupCategory
  id: string
  bytes: number
  lastUsedAt: string
  activeThread?: boolean
  unmergedWorktree?: boolean
  pinnedCheckpoint?: boolean
  rescueSnapshot?: boolean
}

export type StorageCleanupDecisionReason =
  | 'eligible'
  | 'protected-active-thread'
  | 'protected-unmerged-worktree'
  | 'protected-pinned-checkpoint'
  | 'protected-recent-rescue-snapshot'
  | 'not-old-enough'
  | 'invalid-candidate'

export type StorageCleanupDecision = {
  safeToDelete: boolean
  reason: StorageCleanupDecisionReason
}

export type StorageCleanupPolicyOptions = {
  now?: Date
  minAgeMs?: Partial<Record<StorageCleanupCategory, number>>
  rescueSnapshotMinAgeMs?: number
}

const DEFAULT_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_RESCUE_SNAPSHOT_MIN_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Decide whether a candidate may be deleted. This function is pure and never
 * resolves or removes a path; the deletion service must perform its own path
 * and race checks after this policy decision.
 */
export function evaluateStorageCleanupCandidate(
  candidate: StorageCleanupCandidate,
  options: StorageCleanupPolicyOptions = {}
): StorageCleanupDecision {
  if (!isValidCandidate(candidate)) return { safeToDelete: false, reason: 'invalid-candidate' }
  if (candidate.activeThread) return { safeToDelete: false, reason: 'protected-active-thread' }
  if (candidate.unmergedWorktree) return { safeToDelete: false, reason: 'protected-unmerged-worktree' }
  if (candidate.pinnedCheckpoint) return { safeToDelete: false, reason: 'protected-pinned-checkpoint' }

  const now = options.now?.getTime() ?? Date.now()
  const lastUsed = Date.parse(candidate.lastUsedAt)
  if (!Number.isFinite(lastUsed) || lastUsed > now) return { safeToDelete: false, reason: 'invalid-candidate' }

  const age = now - lastUsed
  if (candidate.rescueSnapshot && age < normalizeAge(options.rescueSnapshotMinAgeMs, DEFAULT_RESCUE_SNAPSHOT_MIN_AGE_MS)) {
    return { safeToDelete: false, reason: 'protected-recent-rescue-snapshot' }
  }

  const minAge = normalizeAge(options.minAgeMs?.[candidate.category], DEFAULT_MIN_AGE_MS)
  return age >= minAge
    ? { safeToDelete: true, reason: 'eligible' }
    : { safeToDelete: false, reason: 'not-old-enough' }
}

function isValidCandidate(candidate: StorageCleanupCandidate): boolean {
  const allowedKeys = new Set([
    'category',
    'id',
    'bytes',
    'lastUsedAt',
    'activeThread',
    'unmergedWorktree',
    'pinnedCheckpoint',
    'rescueSnapshot'
  ])
  return Boolean(
    candidate &&
      Object.keys(candidate).every((key) => allowedKeys.has(key)) &&
      typeof candidate.id === 'string' &&
      candidate.id.trim().length > 0 &&
      STORAGE_CLEANUP_CATEGORIES.includes(candidate.category) &&
      Number.isSafeInteger(candidate.bytes) &&
      candidate.bytes >= 0 &&
      isUtcTimestamp(candidate.lastUsedAt) &&
      isOptionalBoolean(candidate.activeThread) &&
      isOptionalBoolean(candidate.unmergedWorktree) &&
      isOptionalBoolean(candidate.pinnedCheckpoint) &&
      isOptionalBoolean(candidate.rescueSnapshot)
  )
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean'
}

function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    return false
  }
  const parsed = Date.parse(value)
  const canonical = value.includes('.') ? value : value.replace('Z', '.000Z')
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === canonical
}

function normalizeAge(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : fallback
}
