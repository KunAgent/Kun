import { lstat, opendir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const STORAGE_USAGE_CATEGORIES = [
  'threads',
  'attachments',
  'checkpoints',
  'worktrees',
  'logs',
  'diagnostics',
  'extensions',
  'models'
] as const

export type StorageUsageCategory = typeof STORAGE_USAGE_CATEGORIES[number]

export type StorageUsageEntry = {
  category: StorageUsageCategory
  root: string | null
  bytes: number
  files: number
  directories: number
  lastModifiedAt: string | null
  truncated: boolean
  error?: string
}

export type StorageUsageReport = {
  schemaVersion: 1
  generatedAt: string
  entries: StorageUsageEntry[]
  totalBytes: number
  totalFiles: number
  truncated: boolean
}

export type StorageUsageOptions = {
  roots: Partial<Record<StorageUsageCategory, string | undefined>>
  maxEntriesPerCategory?: number
  now?: () => Date
}

const DEFAULT_MAX_ENTRIES = 50_000

/** Read-only, bounded disk usage scan. Symlinks are counted as entries but never followed. */
export async function scanStorageUsage(options: StorageUsageOptions): Promise<StorageUsageReport> {
  const maxEntries = normalizeLimit(options.maxEntriesPerCategory)
  const generatedAt = (options.now?.() ?? new Date()).toISOString()
  const entries = await Promise.all(STORAGE_USAGE_CATEGORIES.map(async (category) => {
    const rawRoot = options.roots[category]
    return scanCategory(category, rawRoot, maxEntries)
  }))
  return {
    schemaVersion: 1,
    generatedAt,
    entries,
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    totalFiles: entries.reduce((sum, entry) => sum + entry.files, 0),
    truncated: entries.some((entry) => entry.truncated)
  }
}

async function scanCategory(
  category: StorageUsageCategory,
  rawRoot: string | undefined,
  maxEntries: number
): Promise<StorageUsageEntry> {
  const root = rawRoot?.trim() ? resolve(rawRoot) : null
  const result: StorageUsageEntry = {
    category,
    root,
    bytes: 0,
    files: 0,
    directories: 0,
    lastModifiedAt: null,
    truncated: false
  }
  if (!root) return result

  const queue = [root]
  let visited = 0
  let latestMtime = 0
  while (queue.length > 0) {
    const current = queue.pop()!
    let directory
    try {
      directory = await opendir(current)
    } catch (error) {
      if (!isMissing(error)) result.error = result.error ?? describeError(error)
      continue
    }
    result.directories += 1
    try {
      for await (const child of directory) {
        if (visited >= maxEntries) {
          result.truncated = true
          break
        }
        visited += 1
        const path = join(current, child.name)
        let metadata
        try {
          metadata = await lstat(path)
        } catch (error) {
          result.error = result.error ?? describeError(error)
          continue
        }
        latestMtime = Math.max(latestMtime, metadata.mtimeMs)
        if (metadata.isDirectory()) {
          queue.push(path)
        } else if (metadata.isFile()) {
          result.files += 1
          result.bytes += metadata.size
        }
      }
    } finally {
      await directory.close().catch(() => undefined)
    }
    if (result.truncated) break
  }
  result.lastModifiedAt = latestMtime > 0 ? new Date(latestMtime).toISOString() : null
  return result
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_ENTRIES
  if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_MAX_ENTRIES) {
    throw new Error(`maxEntriesPerCategory must be an integer between 1 and ${DEFAULT_MAX_ENTRIES}`)
  }
  return value
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 256) : String(error).slice(0, 256)
}
