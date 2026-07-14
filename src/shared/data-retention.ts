export const DATA_RETENTION_CATEGORIES = [
  'threads',
  'attachments',
  'checkpoints',
  'worktrees',
  'logs',
  'diagnostics',
  'extensionLogs',
  'models'
] as const
export type DataRetentionCategory = typeof DATA_RETENTION_CATEGORIES[number]

export type DataRetentionPolicy = Partial<Record<DataRetentionCategory, number | null>>

export type DataRetentionValidationError =
  | 'not-an-object'
  | 'unknown-category'
  | 'invalid-days'
  | 'empty-policy'

export type DataRetentionValidation =
  | { ok: true; value: DataRetentionPolicy }
  | { ok: false; error: DataRetentionValidationError }

export const MAX_RETENTION_DAYS = 3_650

export function normalizeDataRetentionPolicy(input: unknown): DataRetentionValidation {
  if (!isRecord(input)) return { ok: false, error: 'not-an-object' }
  const entries = Object.entries(input)
  if (entries.length === 0) return { ok: false, error: 'empty-policy' }
  const result: DataRetentionPolicy = {}
  for (const [category, days] of entries) {
    if (!DATA_RETENTION_CATEGORIES.includes(category as DataRetentionCategory)) {
      return { ok: false, error: 'unknown-category' }
    }
    if (days !== null && (typeof days !== 'number' || !Number.isSafeInteger(days) || days < 1 || days > MAX_RETENTION_DAYS)) {
      return { ok: false, error: 'invalid-days' }
    }
    result[category as DataRetentionCategory] = days
  }
  return { ok: true, value: result }
}

export function shouldRetainByAge(
  policy: unknown,
  category: unknown,
  createdAtMs: number,
  nowMs: number
): boolean {
  const normalized = normalizeDataRetentionPolicy(policy)
  if (!normalized.ok || !DATA_RETENTION_CATEGORIES.includes(category as DataRetentionCategory)) return true
  const days = normalized.value[category as DataRetentionCategory]
  if (days === null || days === undefined) return true
  if (!Number.isSafeInteger(createdAtMs) || !Number.isSafeInteger(nowMs) || createdAtMs < 0 || nowMs < 0) return true
  if (createdAtMs > nowMs) return true
  return nowMs - createdAtMs < days * 24 * 60 * 60 * 1_000
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}
