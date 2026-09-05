import { stat } from 'node:fs/promises'
import { compactUsageEventsJsonlFile } from './file-session-jsonl.js'
import type { UsageCompactionDebtTracker } from './file-session-usage-debt.js'

export async function compactUsageEventsIfLarge(options: {
  path: string
  maxBytes: number
  nowIso: string
  retentionDays: number
  maxRecordBytes: number
  readRevision: () => number
  bumpRevision: () => void
  withWrite: (operation: () => Promise<boolean>) => Promise<boolean>
  withRead: <T>(operation: () => Promise<T>) => Promise<T>
  withReplacement: <T>(operation: () => Promise<T>) => Promise<T>
  scheduleRetry: () => void
  invalidateCache: () => void
}): Promise<{ inspected: boolean; compacted: boolean; conflicted: boolean }> {
  const info = await stat(options.path).catch(() => null)
  if (!info || info.size <= options.maxBytes) {
    return { inspected: false, compacted: false, conflicted: false }
  }
  const revisionBefore = options.readRevision()
  let conflicted = false
  const compacted = await compactUsageEventsJsonlFile(options.path, {
    nowIso: options.nowIso,
    retentionDays: options.retentionDays,
    maxRecordBytes: options.maxRecordBytes,
    withSourceRead: options.withRead,
    commitReplacement: (replace) => options.withReplacement(() => options.withWrite(async () => {
      const currentInfo = await stat(options.path).catch(() => null)
      if (
        options.readRevision() !== revisionBefore ||
        !currentInfo ||
        currentInfo.size !== info.size ||
        currentInfo.mtimeMs !== info.mtimeMs
      ) {
        conflicted = true
        return false
      }
      await replace()
      options.bumpRevision()
      return true
    }))
  })
  if (conflicted) options.scheduleRetry()
  if (compacted) options.invalidateCache()
  return { inspected: true, compacted, conflicted }
}

export async function sessionDirectoryExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export class FileSessionUsageMaintenance {
  constructor(private readonly options: {
    pathFor: (threadId: string) => string
    maxBytes: number
    nowIso: () => string
    retentionDays: number
    maxRecordBytes: number
    readRevision: (threadId: string) => number
    bumpRevision: (threadId: string) => void
    withWrite: (threadId: string, operation: () => Promise<boolean>) => Promise<boolean>
    withRead: <T>(path: string, operation: () => Promise<T>) => Promise<T>
    withReplacement: <T>(path: string, operation: () => Promise<T>) => Promise<T>
    scheduleRetry: (threadId: string) => void
    invalidateCache: (threadId: string) => void
    debt: UsageCompactionDebtTracker
  }) {}

  async compact(threadId: string): Promise<void> {
    const path = this.options.pathFor(threadId)
    const result = await compactUsageEventsIfLarge({
      path,
      maxBytes: this.options.maxBytes,
      nowIso: this.options.nowIso(),
      retentionDays: this.options.retentionDays,
      maxRecordBytes: this.options.maxRecordBytes,
      readRevision: () => this.options.readRevision(threadId),
      bumpRevision: () => this.options.bumpRevision(threadId),
      withWrite: (operation) => this.options.withWrite(threadId, operation),
      withRead: (operation) => this.options.withRead(path, operation),
      withReplacement: (operation) => this.options.withReplacement(path, operation),
      scheduleRetry: () => this.options.scheduleRetry(threadId),
      invalidateCache: () => this.options.invalidateCache(threadId)
    })
    if (result.inspected && !result.conflicted) this.options.debt.inspected(threadId, result.compacted)
  }
}
