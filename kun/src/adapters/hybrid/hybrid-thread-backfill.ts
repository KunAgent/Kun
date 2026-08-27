export type BackfillScan<TUsage> = { highWater: number; usage: TUsage[] }

type UsageBackfillState = { completed: boolean; highWater: number }
type IndexedRow = { id: string; usage_backfilled?: number; usage_backfill_high_water?: number }

export type HybridThreadBackfillDeps<TUsage> = {
  indexedRows: () => IndexedRow[]
  filesystemThreadIds: () => Promise<string[]>
  readMissingThread: (threadId: string) => Promise<boolean>
  scanEvents: (threadId: string) => Promise<BackfillScan<TUsage>>
  upsertMissing: (threadId: string, highWater: number) => Promise<void>
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
  private rows: IndexedRow[] = []
  private filesystemThreadIds: string[] = []
  private indexed = new Map<string, UsageBackfillState>()
  private readonly readableMissingThreadIds = new Set<string>()

  constructor(private readonly deps: HybridThreadBackfillDeps<TUsage>) {}

  start(): void {
    if (this.promise || this.stopped) return
    this.indexPromise = this.indexMissingThreads()
      .catch((error) => this.deps.warn('background index backfill', error))
    this.promise = this.indexPromise
      .then(() => this.backfillUsageAndCleanStaleRows())
      .catch((error) => this.deps.warn('background backfill', error))
  }

  stop(): void { this.stopped = true }
  async waitForIndex(): Promise<void> { await this.indexPromise }
  async wait(): Promise<void> { await this.promise }

  private async indexMissingThreads(): Promise<void> {
    if (this.stopped) return
    this.rows = this.deps.indexedRows()
    this.indexed = new Map(this.rows.map((row) => [row.id, {
      completed: row.usage_backfilled === 1,
      highWater: Math.max(0, row.usage_backfill_high_water ?? 0)
    }]))
    this.filesystemThreadIds = await this.deps.filesystemThreadIds()
    if (this.stopped) return
    for (const threadId of this.filesystemThreadIds) {
      if (this.stopped) return
      if (this.indexed.has(threadId)) continue
      const readable = await this.deps.readMissingThread(threadId)
      if (this.stopped) return
      if (!readable) continue
      await this.deps.upsertMissing(threadId, 0)
      if (this.stopped) return
      this.readableMissingThreadIds.add(threadId)
      this.indexed.set(threadId, { completed: false, highWater: 0 })
      await this.deps.yieldToEventLoop()
    }
  }

  private async backfillUsageAndCleanStaleRows(): Promise<void> {
    if (this.stopped) return
    for (const threadId of this.filesystemThreadIds) {
      if (this.stopped) return
      const state = this.indexed.get(threadId)
      if (state?.completed) continue
      if (!state && !this.readableMissingThreadIds.has(threadId)) continue
      let scan: BackfillScan<TUsage>
      try {
        scan = await this.deps.scanEvents(threadId)
      } catch (error) {
        this.deps.warn(`usage backfill scan for ${threadId}`, error)
        await this.deps.yieldToEventLoop()
        continue
      }
      if (this.stopped) return
      this.deps.noteExistingHighWater(threadId, scan.highWater)
      try {
        await this.deps.insertUsage(threadId, scan.usage, state?.highWater ?? 0)
        if (this.stopped) return
        this.deps.markUsageBackfilled(threadId)
      } catch (error) {
        this.deps.warn(`usage backfill write for ${threadId}`, error)
        await this.deps.yieldToEventLoop()
        continue
      }
      await this.deps.yieldToEventLoop()
      if (this.stopped) return
    }
    try {
      for (const row of this.rows) {
        if (this.stopped) return
        const exists = await this.deps.threadDirectoryExists(row.id)
        if (this.stopped) return
        if (!exists) this.deps.deleteIndexRow(row.id)
      }
    } catch (error) { this.deps.warn('backfill cleanup', error) }
  }
}
