import type { ThreadIndexStatusInfo } from '../../contracts/thread-index-status.js'
import type { ThreadIndexRecord } from './hybrid-thread-index-mapping.js'

export type BackfillScan<TUsage> = { highWater: number; usage: TUsage[] }

type UsageBackfillState = { completed: boolean; highWater: number }
type IndexedRow = { id: string; usage_backfilled?: number; usage_backfill_high_water?: number }

export type HybridThreadIndexStatus = 'not_started' | 'running' | 'ready' | 'failed'

const DEFAULT_INDEX_BATCH_SIZE = 200

export type HybridThreadBackfillDeps<TUsage> = {
  indexedRows: () => IndexedRow[]
  filesystemThreadIds: () => Promise<string[]>
  /** Batch-read metadata for the given ids (single read per thread, aligned with ids). */
  readMissingThreads: (ids: string[]) => Promise<Array<ThreadIndexRecord | null>>
  /** Persist a whole batch of freshly read index records in one transaction. */
  upsertMissingRecords: (records: ThreadIndexRecord[], highWater: number) => Promise<void>
  scanEvents: (threadId: string) => Promise<BackfillScan<TUsage>>
  noteExistingHighWater: (threadId: string, highWater: number) => void
  insertUsage: (threadId: string, usage: TUsage[], resumeAfterSeq: number) => Promise<void>
  markUsageBackfilled: (threadId: string) => void
  threadDirectoryExists: (threadId: string) => Promise<boolean>
  deleteIndexRow: (threadId: string) => void
  yieldToEventLoop: () => Promise<void>
  warn: (action: string, error: unknown) => void
}

/** Single-flight owner for startup index/usage recovery and stale-row cleanup. */
export class HybridThreadBackfillCoordinator<TUsage> {
  private indexPromise: Promise<void> | null = null
  private promise: Promise<void> | null = null
  private stopped = false
  private indexStatus: HybridThreadIndexStatus = 'not_started'
  private usageReady = false
  private rows: IndexedRow[] = []
  private filesystemThreadIds: string[] = []
  private indexed = new Map<string, UsageBackfillState>()
  private readonly readableMissingThreadIds = new Set<string>()
  private indexedCount = 0
  private total = 0
  private readonly batchSize: number

  constructor(
    private readonly deps: HybridThreadBackfillDeps<TUsage>,
    options: { batchSize?: number } = {}
  ) {
    this.batchSize = Math.max(1, Math.floor(options.batchSize ?? DEFAULT_INDEX_BATCH_SIZE))
  }

  start(): void {
    if (this.promise || this.stopped || this.usageReady) return
    this.indexStatus = 'running'
    this.indexPromise = this.indexMissingThreads()
      .then(() => {
        this.indexedCount = this.total
        this.indexStatus = this.stopped ? 'failed' : 'ready'
      })
      .catch((error) => {
        this.indexStatus = 'failed'
        this.deps.warn('background index backfill', error)
      })
    this.promise = this.indexPromise
      .then(() => this.indexStatus === 'ready' ? this.backfillUsageAndCleanStaleRows() : false)
      .then((complete) => { this.usageReady = complete })
      .catch((error) => this.deps.warn('background backfill', error))
      .finally(() => { this.promise = null })
  }

  stop(): void { this.stopped = true }
  async waitForIndex(): Promise<void> { await this.indexPromise }
  async wait(): Promise<void> { await this.promise }
  isIndexReady(): boolean { return this.indexStatus === 'ready' }
  progress(): ThreadIndexStatusInfo {
    return { status: this.indexStatus, indexed: this.indexedCount, total: this.total }
  }
  isUsageReady(threadIds?: string[]): boolean {
    if (!threadIds || threadIds.length === 0) return this.usageReady
    if (this.indexStatus !== 'ready') return false
    return threadIds.every((threadId) => {
      if (!this.filesystemThreadIds.includes(threadId)) return true
      return this.indexed.get(threadId)?.completed === true
    })
  }

  private async indexMissingThreads(): Promise<void> {
    if (this.stopped) return
    this.rows = this.deps.indexedRows()
    this.indexed = new Map(this.rows.map((row) => [row.id, {
      completed: row.usage_backfilled === 1,
      highWater: Math.max(0, row.usage_backfill_high_water ?? 0)
    }]))
    this.filesystemThreadIds = await this.deps.filesystemThreadIds()
    if (this.stopped) return
    this.total = this.filesystemThreadIds.length
    this.indexedCount = this.filesystemThreadIds.filter((id) => this.indexed.has(id)).length
    const unreadableThreadIds = new Set<string>()
    const writeFailures = new Set<string>()
    const missingIds = this.filesystemThreadIds.filter((id) => !this.indexed.has(id))
    for (let offset = 0; offset < missingIds.length; offset += this.batchSize) {
      if (this.stopped) return
      const batch = missingIds.slice(offset, offset + this.batchSize)
      const records = await this.deps.readMissingThreads(batch)
      if (this.stopped) return
      const writable: ThreadIndexRecord[] = []
      for (let index = 0; index < batch.length; index += 1) {
        const threadId = batch[index]
        const record = records[index]
        if (!record) {
          unreadableThreadIds.add(threadId)
          this.deps.warn('index missing thread', threadId)
          continue
        }
        writable.push(record)
        this.readableMissingThreadIds.add(threadId)
        this.indexed.set(threadId, { completed: false, highWater: 0 })
      }
      if (writable.length > 0) {
        try {
          await this.deps.upsertMissingRecords(writable, 0)
        } catch (error) {
          for (const record of writable) writeFailures.add(record.thread.id)
          this.deps.warn('index backfill upsert batch', error)
        }
      }
      this.indexedCount += batch.length
      await this.deps.yieldToEventLoop()
    }
    if (this.stopped) return
    const rowIds = new Set(this.deps.indexedRows().map((row) => row.id))
    const uncovered = this.filesystemThreadIds.filter(
      (threadId) => !rowIds.has(threadId) && !unreadableThreadIds.has(threadId)
    )
    if (writeFailures.size > 0 || uncovered.length > 0) {
      throw new Error(
        `index backfill incomplete: ${writeFailures.size} write failures, ${uncovered.length} uncovered threads`
      )
    }
  }

  private async backfillUsageAndCleanStaleRows(): Promise<boolean> {
    if (this.stopped) return false
    let complete = true
    for (const threadId of this.filesystemThreadIds) {
      if (this.stopped) return false
      const state = this.indexed.get(threadId)
      if (state?.completed) continue
      if (!state && !this.readableMissingThreadIds.has(threadId)) continue
      let scan: BackfillScan<TUsage>
      try {
        scan = await this.deps.scanEvents(threadId)
      } catch (error) {
        complete = false
        this.deps.warn(`usage backfill scan for ${threadId}`, error)
        await this.deps.yieldToEventLoop()
        continue
      }
      if (this.stopped) return false
      this.deps.noteExistingHighWater(threadId, scan.highWater)
      try {
        await this.deps.insertUsage(threadId, scan.usage, state?.highWater ?? 0)
        if (this.stopped) return false
        this.deps.markUsageBackfilled(threadId)
        this.indexed.set(threadId, { completed: true, highWater: scan.highWater })
      } catch (error) {
        complete = false
        this.deps.warn(`usage backfill write for ${threadId}`, error)
        await this.deps.yieldToEventLoop()
        continue
      }
      await this.deps.yieldToEventLoop()
      if (this.stopped) return false
    }
    try {
      for (const row of this.rows) {
        if (this.stopped) return false
        const exists = await this.deps.threadDirectoryExists(row.id)
        if (this.stopped) return false
        if (!exists) this.deps.deleteIndexRow(row.id)
      }
    } catch (error) {
      this.deps.warn('backfill cleanup', error)
    }
    return complete && !this.stopped
  }
}
