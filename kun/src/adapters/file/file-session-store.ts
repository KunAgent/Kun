import { appendFile, mkdir, readFile, stat } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { join, resolve } from 'node:path'
import type {
  EventHistoryPage,
  EventHistoryPageOptions,
  ItemHistoryPage,
  ItemHistoryPageOptions,
  ItemHistoryCompactionResult,
  ItemHistoryCommit,
  ItemHistorySnapshot,
  ItemTextSearchOptions,
  SessionArchiveInput,
  SessionArchiveResult,
  SessionLatestUsageSnapshot,
  SessionStore,
  SessionUsageQueryOptions,
  SessionUsageRecord
} from '../../ports/session-store.js'
import type { RuntimeEvent } from '../../contracts/events.js'
import type { TurnItem } from '../../contracts/items.js'
import { assertSafeThreadId, isSafeThreadId } from '../../contracts/thread-id.js'
import type { AgentSession } from '../../domain/session.js'
import { DEFAULT_EVENT_REPLAY_MAX_RECORD_BYTES, readLatestItemsFromJsonl, warnUsageCompaction } from './file-session-jsonl.js'
import { ItemsCache } from './file-session-items-cache.js'
import { atomicWriteFile } from './atomic-write.js'
import { isPathBelowDirectory } from './path-containment.js'
import { SessionCompactionScheduler } from './session-compaction-scheduler.js'
import { searchItemTextFile } from './file-session-text-search.js'
import { writeSessionArchive } from './session-history-archive.js'
import { FileSessionUsageMaintenance, sessionDirectoryExists } from './file-session-usage-compaction.js'
import { FileSessionUsageIndex } from './file-session-usage-index.js'
import { listThreadDirs, loadLatestUsageSnapshotsFromIndex, loadUsageRecordsFromIndex } from './file-session-usage-read.js'
import { JsonlFileAccessCoordinator } from './jsonl-file-access.js'
import { loadIndexedLiveItemPageFromStore } from './file-session-page.js'
import { FileSessionLiveItems, liveReplayAfterSeq, overlayLiveItems, readRecoveredLiveItems, readLiveItems, serializeItemRecord, serializeItemRecords } from './file-session-live-items.js'
import { FileSessionLiveCheckpointCoordinator } from './file-session-live-checkpoint-coordinator.js'
import { FileSessionItemIndex } from './file-session-item-index.js'
import { compactFileSessionItems } from './file-session-item-compaction.js'
import { loadFileSessionHighestSeq } from './file-session-highest-seq.js'
import { makeHighestSeqCacheWriter } from './file-session-highest-seq-cache-writer.js'
import { ensureEventTailReady } from './file-session-event-tail.js'
import { FileSessionEventHistory, createFileSessionEventSubsystem, type FileSessionEventSubsystem, type FileSessionEventSubsystemHost } from './file-session-event-replay.js'
import { FileSessionEventRetention } from './file-session-event-retention.js'
import { FileSessionEventsSizeTracker } from './file-session-events-size-tracker.js'
import { UsageCompactionDebtTracker } from './file-session-usage-debt.js'
import { loadCursorCheckpoint, persistCursorCheckpointEvent } from './file-session-cursor-checkpoint.js'
import { FileSessionRevisionCache } from './file-session-revision-cache.js'
export { DEFAULT_EVENT_REPLAY_MAX_RECORD_BYTES, readLatestItemsFromJsonl } from './file-session-jsonl.js'
const DEFAULT_USAGE_EVENT_COMPACTION_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_USAGE_EVENT_RETENTION_DAYS = 365
const DEFAULT_EVENT_HISTORY_MAX_BYTES = 64 * 1024 * 1024
const DEFAULT_EVENT_HISTORY_RETAIN_BYTES = 48 * 1024 * 1024
const SLOW_LOAD_ITEMS_LOG_MS = 1_000

/**
 * The agent loop reloads the full item history on every model step, so
 * keep the deduped array for recently touched threads in memory instead
 * of re-reading and re-parsing messages.jsonl each time.
 */
const ITEMS_CACHE_MAX_THREADS = 4
const DEFAULT_ITEMS_CACHE_MAX_BYTES = 16 * 1024 * 1024
const DEFAULT_ITEM_HISTORY_COMPACTION_MIN_BYTES = 4 * 1024 * 1024
// Keep lock-free content-search reads well below the compaction threshold.
const DEFAULT_ITEM_TEXT_SEARCH_MAX_BYTES = 512 * 1024
const ITEM_HISTORY_REVISION_MAX_THREADS = 512
const EVENT_HISTORY_REVISION_MAX_THREADS = 512

/**
 * File-backed session store for per-thread append-only JSONL logs and the
 * canonical small session snapshot.
 */
export class FileSessionStore implements SessionStore {
  private readonly dataDir: string
  private readonly usageEventCompaction: {
    maxBytes: number
    retentionDays: number
    nowIso: () => string
  }
  private readonly itemsCache: ItemsCache
  private readonly itemHistoryCompactionMinBytes: number
  private readonly itemHistoryRevisions = new FileSessionRevisionCache(ITEM_HISTORY_REVISION_MAX_THREADS)
  private readonly eventHistoryRevisions = new FileSessionRevisionCache(EVENT_HISTORY_REVISION_MAX_THREADS)
  private readonly highestSeqCache = new Map<string, { seq: number; size: number; mtimeMs: number | null }>()
  private readonly cacheHighestSeq = makeHighestSeqCacheWriter(this.highestSeqCache)
  private readonly eventsSizeTracker = new FileSessionEventsSizeTracker((threadId) => this.eventsPath(threadId))
  private readonly writeQueues = new Map<string, Promise<unknown>>()
  private readonly compactionScheduler: SessionCompactionScheduler
  private readonly usageIndex: FileSessionUsageIndex
  private readonly fileAccess: JsonlFileAccessCoordinator
  readonly liveItems = new FileSessionLiveItems()
  private readonly liveCheckpoints: FileSessionLiveCheckpointCoordinator
  private readonly itemIndex = new FileSessionItemIndex()
  private readonly verifiedEventTails = new Set<string>()
  private readonly eventIndexRebuild: FileSessionEventSubsystem['eventIndexRebuild']
  private readonly eventHistory: FileSessionEventHistory
  private readonly eventRetention: FileSessionEventRetention
  private readonly usageCompactionDebt: UsageCompactionDebtTracker
  private readonly usageMaintenance: FileSessionUsageMaintenance

  constructor(options: {
    dataDir: string
    usageEventCompaction?: {
      maxBytes?: number
      retentionDays?: number
      nowIso?: () => string
    }
    itemsCacheMaxBytes?: number
    itemHistoryCompactionMinBytes?: number
    eventHistoryCompaction?: { maxBytes?: number; retainBytes?: number }
    compactionDelayMs?: number
    fileAccess?: JsonlFileAccessCoordinator
  }) {
    this.dataDir = resolve(options.dataDir, 'threads')
    this.fileAccess = options.fileAccess ?? new JsonlFileAccessCoordinator()
    this.liveCheckpoints = new FileSessionLiveCheckpointCoordinator(this)
    const events = createFileSessionEventSubsystem(this as unknown as FileSessionEventSubsystemHost)
    this.eventHistory = events.eventHistory
    this.eventIndexRebuild = events.eventIndexRebuild
    this.usageIndex = new FileSessionUsageIndex(
      this.dataDir,
      async function* (this: FileSessionStore, threadId: string, sinceSeq: number) {
        for await (const event of this.iterateEventsSince(threadId, sinceSeq)) {
          if (event.kind === 'usage') yield event
        }
      }.bind(this)
    )
    this.itemsCache = new ItemsCache(ITEMS_CACHE_MAX_THREADS, Math.max(1, Math.floor(
      options.itemsCacheMaxBytes ?? DEFAULT_ITEMS_CACHE_MAX_BYTES
    )))
    this.itemHistoryCompactionMinBytes = Math.max(1, Math.floor(
      options.itemHistoryCompactionMinBytes ?? DEFAULT_ITEM_HISTORY_COMPACTION_MIN_BYTES
    ))
    this.eventRetention = new FileSessionEventRetention({
      maxBytes: options.eventHistoryCompaction?.maxBytes ?? DEFAULT_EVENT_HISTORY_MAX_BYTES,
      retainBytes: options.eventHistoryCompaction?.retainBytes ?? DEFAULT_EVENT_HISTORY_RETAIN_BYTES,
      maxRecordBytes: DEFAULT_EVENT_REPLAY_MAX_RECORD_BYTES,
      pathFor: (threadId) => this.eventsPath(threadId),
      trim: (threadId, floor) => this.eventHistory.trim(threadId, floor)
    })
    this.usageEventCompaction = {
      maxBytes: Math.max(1, Math.floor(
        options.usageEventCompaction?.maxBytes ?? DEFAULT_USAGE_EVENT_COMPACTION_MAX_BYTES
      )),
      retentionDays: Math.max(1, Math.floor(
        options.usageEventCompaction?.retentionDays ?? DEFAULT_USAGE_EVENT_RETENTION_DAYS
      )),
      nowIso: options.usageEventCompaction?.nowIso ?? (() => new Date().toISOString())
    }
    this.usageCompactionDebt = new UsageCompactionDebtTracker(this.usageEventCompaction.maxBytes)
    this.usageMaintenance = new FileSessionUsageMaintenance({
      pathFor: (threadId) => this.eventsPath(threadId),
      ...this.usageEventCompaction,
      maxRecordBytes: DEFAULT_EVENT_REPLAY_MAX_RECORD_BYTES,
      readRevision: (threadId) => this.eventHistoryRevision(threadId),
      bumpRevision: (threadId) => this.bumpEventHistoryRevision(threadId),
      withWrite: (threadId, operation) => this.withThreadWrite(threadId, operation),
      withRead: (path, operation) => this.fileAccess.withRead(path, operation),
      withReplacement: (path, operation) => this.fileAccess.withReplacement(path, operation),
      scheduleRetry: (threadId) => this.scheduleUsageEventCompaction(threadId),
      invalidateCache: (threadId) => { this.highestSeqCache.delete(threadId); this.eventsSizeTracker.invalidate(threadId) },
      debt: this.usageCompactionDebt
    })
    this.compactionScheduler = new SessionCompactionScheduler({
      delayMs: options.compactionDelayMs,
      run: async (threadId, kind) => {
        if (kind === 'items') {
          await this.compactItems(threadId)
          return
        }
        if (kind === 'events') {
          await this.eventRetention.compact(threadId)
          return
        }
        await this.usageMaintenance.compact(threadId)
      },
      onError: (threadId, kind, error) => {
        if (kind === 'usage') {
          warnUsageCompaction(threadId, error)
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[kun] ${kind} compaction skipped for ${threadId}; keeping source log: ${message}`)
      }
    })
  }

  async appendEvent(threadId: string, event: RuntimeEvent): Promise<void> {
    assertSafeThreadId(threadId)
    if (await persistCursorCheckpointEvent(
      event, this.threadDir(threadId), (operation) => this.withThreadWrite(threadId, operation)
    )) {
      this.highestSeqCache.delete(threadId)
      return
    }
    const path = this.eventsPath(threadId)
    const record = `${JSON.stringify(event)}\n`
    let usageCompactionDue = false
    await this.eventHistory.withEventIndexMutation(threadId, () =>
      this.fileAccess.withRead(path, () => this.withThreadWrite(threadId, async () => {
        await mkdir(this.threadDir(threadId), { recursive: true, mode: 0o700 })
        if (!this.verifiedEventTails.has(threadId)) this.eventsSizeTracker.invalidate(threadId)
        await ensureEventTailReady({
          verified: this.verifiedEventTails, threadId, path,
          evidencePath: join(this.threadDir(threadId), 'events.torn-tail.json')
        })
        await appendFile(path, record, { encoding: 'utf-8', mode: 0o600 })
        this.verifiedEventTails.add(threadId)
        this.bumpEventHistoryRevision(threadId)
        const info = await this.eventsSizeTracker.observeAfterAppend(threadId, Buffer.byteLength(record))
        await this.eventHistory.recordAppend(threadId, event.seq, Buffer.byteLength(record), info).catch(() => undefined)
        this.cacheHighestSeq(threadId, event.seq, { size: info.size, mtimeMs: null }, { preserveHigher: true })
        if (this.eventRetention.shouldSchedule(info.size)) this.compactionScheduler.schedule(threadId, 'events')
        if (event.kind === 'usage') {
          await this.usageIndex.recordUsage(threadId, event)
          usageCompactionDue = this.usageCompactionDebt.record(threadId, event, Buffer.byteLength(record), info.size)
        }
      })))
    // Never await usage compaction on the live append path — a multi-hundred-MB
    // events.jsonl rewrite would starve lease heartbeats (#621 family).
    if (usageCompactionDue) this.scheduleUsageEventCompaction(threadId)
  }

  async appendItem(threadId: string, item: TurnItem): Promise<void> {
    assertSafeThreadId(threadId)
    const path = this.messagesPath(threadId)
    const record = serializeItemRecord(item)
    await this.fileAccess.withRead(path, () => this.withThreadWrite(threadId, async () => {
      await mkdir(this.threadDir(threadId), { recursive: true, mode: 0o700 })
      await this.itemIndex.append({
        sourcePath: path,
        indexPath: this.itemIndexPath(threadId),
        statePath: this.itemIndexStatePath(threadId),
        threadId,
        evidencePath: this.itemTailEvidencePath(threadId),
        item,
        record
      })
      this.bumpItemsVersion(threadId)
      this.applyItemToCache(threadId, item)
      this.bumpItemHistoryRevision(threadId)
    }))
  }

  async checkpointLiveItem(threadId: string, item: TurnItem, representedSeq: number): Promise<void> {
    assertSafeThreadId(threadId)
    await this.liveCheckpoints.checkpoint(threadId, item, representedSeq)
  }

  async finalizeLiveItem(threadId: string, item: TurnItem): Promise<void> {
    assertSafeThreadId(threadId)
    await this.liveCheckpoints.remove(threadId, item.id)
    const path = this.messagesPath(threadId)
    const record = serializeItemRecord(item)
    await this.fileAccess.withRead(path, () => this.withThreadWrite(threadId, async () => {
      await mkdir(this.threadDir(threadId), { recursive: true, mode: 0o700 })
      await this.liveItems.stageFinal(this.liveItemsPath(threadId), threadId, item)
      await this.itemIndex.append({
        sourcePath: path,
        indexPath: this.itemIndexPath(threadId),
        statePath: this.itemIndexStatePath(threadId),
        threadId,
        evidencePath: this.itemTailEvidencePath(threadId),
        item,
        record
      })
      await this.liveItems.remove(this.liveItemsPath(threadId), threadId, item.id)
      this.bumpItemsVersion(threadId)
      this.applyItemToCache(threadId, item)
      this.bumpItemHistoryRevision(threadId)
    }))
  }

  async rewriteItems(threadId: string, items: TurnItem[]): Promise<void> {
    assertSafeThreadId(threadId)
    const checkpointGeneration = await this.liveCheckpoints.flushThread(threadId)
    this.liveCheckpoints.clearThread(threadId, checkpointGeneration)
    const path = this.messagesPath(threadId)
    await this.fileAccess.withReplacement(path, () => this.withThreadWrite(threadId, async () => {
      await mkdir(this.threadDir(threadId), { recursive: true, mode: 0o700 })
      await atomicWriteFile(path, serializeItemRecords(items))
      await this.liveItems.reconcileAfterRewrite(this.liveItemsPath(threadId), threadId, items)
      await this.refreshItemIndex(threadId, items)
      this.bumpItemsVersion(threadId)
      this.cacheItems(threadId, [...items])
      this.bumpItemHistoryRevision(threadId)
    }))
  }

  async loadItemSnapshot(threadId: string): Promise<ItemHistorySnapshot> {
    if (!isSafeThreadId(threadId)) return { revision: 0, items: [] }
    return this.fileAccess.withRead(this.messagesPath(threadId), () => this.withThreadWrite(threadId, async () => {
      const live = await readLiveItems(this.liveItemsPath(threadId))
      return {
        revision: this.itemHistoryRevision(threadId),
        items: await this.loadItemsUnlocked(threadId),
        ...(liveReplayAfterSeq(live) === undefined
          ? {}
          : { replayAfterSeq: liveReplayAfterSeq(live) })
      }
    }))
  }

  async rewriteItemsIfRevision(
    threadId: string,
    expectedRevision: number,
    items: TurnItem[]
  ): Promise<ItemHistoryCommit> {
    assertSafeThreadId(threadId)
    const checkpointGeneration = await this.liveCheckpoints.flushThread(threadId)
    this.liveCheckpoints.clearThread(threadId, checkpointGeneration)
    const path = this.messagesPath(threadId)
    return this.fileAccess.withReplacement(path, () => this.withThreadWrite(threadId, async () => {
      const revision = this.itemHistoryRevision(threadId)
      if (revision !== expectedRevision) {
        return { applied: false, reason: 'conflict', revision }
      }
      await mkdir(this.threadDir(threadId), { recursive: true, mode: 0o700 })
      await atomicWriteFile(path, serializeItemRecords(items))
      await this.liveItems.reconcileAfterRewrite(this.liveItemsPath(threadId), threadId, items)
      await this.refreshItemIndex(threadId, items)
      this.bumpItemsVersion(threadId)
      this.cacheItems(threadId, [...items])
      return { applied: true, revision: this.bumpItemHistoryRevision(threadId) }
    }))
  }

  async updateItem(threadId: string, itemId: string, patch: Partial<TurnItem>): Promise<TurnItem | null> {
    assertSafeThreadId(threadId)
    await this.liveCheckpoints.remove(threadId, itemId)
    return this.fileAccess.withRead(this.messagesPath(threadId), () => this.withThreadWrite(threadId, async () => {
      const items = await this.loadItemsUnlocked(threadId)
      const current = items.find((item) => item.id === itemId)
      if (!current) return null
      const updated = { ...current, ...patch } as TurnItem
      const record = serializeItemRecord(updated)
      await mkdir(this.threadDir(threadId), { recursive: true, mode: 0o700 })
      await this.itemIndex.append({
        sourcePath: this.messagesPath(threadId),
        indexPath: this.itemIndexPath(threadId),
        statePath: this.itemIndexStatePath(threadId),
        threadId,
        evidencePath: this.itemTailEvidencePath(threadId),
        item: updated,
        record
      })
      await this.liveItems.remove(this.liveItemsPath(threadId), threadId, itemId)
      this.bumpItemsVersion(threadId)
      this.applyItemToCache(threadId, updated)
      this.bumpItemHistoryRevision(threadId)
      return updated
    }))
  }

  async compactItems(
    threadId: string,
    options: { force?: boolean } = {}
  ): Promise<ItemHistoryCompactionResult> {
    assertSafeThreadId(threadId)
    const path = this.messagesPath(threadId)
    return compactFileSessionItems({
      path,
      threadId,
      evidencePath: this.itemTailEvidencePath(threadId),
      force: options.force === true,
      minimumBytes: this.itemHistoryCompactionMinBytes,
      cachedItemCount: () => this.itemsCache.get(threadId)?.length ?? 0,
      fileAccess: this.fileAccess,
      readRevision: () => this.itemHistoryRevision(threadId),
      bumpRevision: () => { this.bumpItemHistoryRevision(threadId) },
      bumpItemsVersion: () => this.bumpItemsVersion(threadId),
      cacheItems: (items) => this.cacheItems(threadId, items),
      refreshIndex: (items) => this.refreshItemIndex(threadId, items),
      scheduleRetry: () => this.scheduleItemHistoryCompaction(threadId),
      withThreadWrite: (operation) => this.withThreadWrite(threadId, operation)
    })
  }

  scheduleItemHistoryCompaction(threadId: string): void {
    if (!isSafeThreadId(threadId)) return
    this.compactionScheduler.schedule(threadId, 'items')
  }

  scheduleUsageEventCompaction(threadId: string): void {
    if (!isSafeThreadId(threadId)) return
    this.compactionScheduler.schedule(threadId, 'usage')
  }

  async flushScheduledCompaction(threadId?: string): Promise<void> {
    await this.compactionScheduler.flush(threadId)
  }

  async loadUsageRecords(options: SessionUsageQueryOptions = {}): Promise<SessionUsageRecord[]> {
    return loadUsageRecordsFromIndex(this.usageIndex, () => listThreadDirs(this.dataDir), options)
  }

  async loadLatestUsageSnapshots(
    options: { threadIds?: string[] } = {}
  ): Promise<SessionLatestUsageSnapshot[]> {
    return loadLatestUsageSnapshotsFromIndex(this.usageIndex, () => listThreadDirs(this.dataDir), options)
  }

  async loadEventsSince(threadId: string, sinceSeq: number): Promise<RuntimeEvent[]> {
    if (!isSafeThreadId(threadId)) return []
    return this.eventHistory.load(threadId, sinceSeq)
  }

  async loadEventPage(threadId: string, options: EventHistoryPageOptions): Promise<EventHistoryPage> {
    if (!isSafeThreadId(threadId)) return { events: [], hasMore: false, eventBytes: 0 }
    return this.eventHistory.page(threadId, options)
  }

  async *iterateEventsSince(
    threadId: string,
    sinceSeq: number,
    options: { maxRecordBytes?: number } = {}
  ): AsyncIterable<RuntimeEvent> {
    if (!isSafeThreadId(threadId)) return
    const maxRecordBytes = Math.max(
      1,
      Math.floor(options.maxRecordBytes ?? DEFAULT_EVENT_REPLAY_MAX_RECORD_BYTES)
    )
    yield* this.eventHistory.iterate(threadId, sinceSeq, maxRecordBytes)
  }

  async loadItems(threadId: string): Promise<TurnItem[]> {
    if (!isSafeThreadId(threadId)) return []
    return this.fileAccess.withRead(
      this.messagesPath(threadId),
      () => this.withThreadWrite(threadId, () => this.loadItemsUnlocked(threadId))
    )
  }

  /**
   * Bounded, lock-free scan for the first item text containing `query`.
   *
   * Deliberately does not reuse `loadItems`: that path takes the per-thread
   * write queue and schedules a rewrite for logs at or above the compaction
   * threshold, so driving it from a search would let a keystroke contend with
   * an in-flight turn and queue a multi-megabyte rewrite (#621). This reads
   * the tail of messages.jsonl directly, biasing toward recent messages, and
   * neither mutates nor schedules anything.
   */
  async searchItemText(
    threadId: string,
    query: string,
    options: ItemTextSearchOptions = {}
  ): Promise<string | null> {
    if (!isSafeThreadId(threadId)) return null
    const maxBytes = Math.max(1, Math.floor(options.maxBytes ?? DEFAULT_ITEM_TEXT_SEARCH_MAX_BYTES))
    const path = this.messagesPath(threadId)
    return this.fileAccess.withRead(path, () => searchItemTextFile({
      path,
      query,
      maxBytes,
      cachedItems: this.itemsCache.get(threadId),
      options
    }))
  }

  async loadItemPage(
    threadId: string,
    options: ItemHistoryPageOptions
  ): Promise<ItemHistoryPage> {
    if (!isSafeThreadId(threadId)) {
      return { items: [], hasMore: false, itemBytes: 0 }
    }
    const path = this.messagesPath(threadId)
    return loadIndexedLiveItemPageFromStore({
      path,
      options,
      fileAccess: this.fileAccess,
      cachedItems: () => this.itemsCache.get(threadId),
      touchCache: (items) => this.cacheItems(threadId, items),
      withThreadWrite: (operation) => this.withThreadWrite(threadId, operation),
      scheduleCompaction: () => this.scheduleItemHistoryCompaction(threadId),
      compactionMinBytes: this.itemHistoryCompactionMinBytes,
      itemIndex: this.itemIndex,
      indexPath: this.itemIndexPath(threadId),
      indexStatePath: this.itemIndexStatePath(threadId),
      threadId,
      evidencePath: this.itemTailEvidencePath(threadId),
      liveItemsPath: this.liveItemsPath(threadId)
    })
  }

  private async loadItemsUnlocked(threadId: string): Promise<TurnItem[]> {
    const cached = this.itemsCache.get(threadId)
    if (cached) {
      this.cacheItems(threadId, cached)
      return [...cached]
    }
    const info = await stat(this.messagesPath(threadId)).catch(() => null)
    if (info && info.size >= this.itemHistoryCompactionMinBytes) {
      this.scheduleItemHistoryCompaction(threadId)
    }
    const startedAt = performance.now()
    const { items: ordered, rawCount } = await readLatestItemsFromJsonl(this.messagesPath(threadId))
    const elapsedMs = performance.now() - startedAt
    if (elapsedMs >= SLOW_LOAD_ITEMS_LOG_MS) {
      // A slow cold read points at an oversized thread log as the likely
      // event-loop staller behind a watchdog restart (#621); counts show the bloat.
      console.warn(
        `[kun] loadItems(${threadId}) took ${Math.round(elapsedMs)}ms ` +
          `for ${rawCount} raw → ${ordered.length} items`
      )
    }
    const overlaid = overlayLiveItems(ordered, await readRecoveredLiveItems(
      this.liveItemsPath(threadId), (seq) => this.loadEventsSince(threadId, seq)
    ))
    this.cacheItems(threadId, overlaid)
    return [...overlaid]
  }

  async loadSession(threadId: string): Promise<AgentSession | null> {
    try {
      const raw = await readFile(join(this.threadDir(threadId), 'session.json'), 'utf-8')
      return JSON.parse(raw) as AgentSession
    } catch {
      return null
    }
  }

  async upsertSession(session: AgentSession): Promise<void> {
    assertSafeThreadId(session.threadId)
    await this.withThreadWrite(session.threadId, async () => {
      await mkdir(this.threadDir(session.threadId), { recursive: true, mode: 0o700 })
      await atomicWriteFile(join(this.threadDir(session.threadId), 'session.json'), JSON.stringify(session))
    })
  }

  async highestSeq(threadId: string): Promise<number> {
    if (!isSafeThreadId(threadId)) return 0
    const path = this.eventsPath(threadId)
    const durable = await loadFileSessionHighestSeq({
      path,
      fileAccess: this.fileAccess,
      cached: () => this.highestSeqCache.get(threadId),
      clearCached: () => { this.highestSeqCache.delete(threadId) },
      cache: (seq, info) => this.cacheHighestSeq(threadId, seq, info),
      iterate: () => this.iterateEventsSince(threadId, -1)
    })
    return Math.max(durable, await loadCursorCheckpoint(this.threadDir(threadId)))
  }

  async resetMemory(): Promise<void> {
    await this.compactionScheduler.cancelPending().catch(() => undefined)
    this.itemsCache.clear()
    this.itemHistoryRevisions.clear()
    this.eventHistoryRevisions.clear()
    this.highestSeqCache.clear()
    this.eventsSizeTracker.clear()
    this.usageIndex.resetMemory()
    this.usageCompactionDebt.clear()
    this.liveItems.clear()
    this.itemIndex.clear()
  }

  clearThreadMemory(threadId: string): void {
    this.itemsCache.removeAll(threadId)
    this.itemHistoryRevisions.clear(threadId)
    this.eventHistoryRevisions.clear(threadId)
    this.highestSeqCache.delete(threadId)
    this.eventsSizeTracker.invalidate(threadId)
    this.usageIndex.clearThreadMemory(threadId)
    this.usageCompactionDebt.clear(threadId)
    this.liveItems.clearThread(threadId)
    this.itemIndex.clearSource(this.messagesPath(threadId))
  }

  itemCacheStats(): { entries: number; bytes: number; maxBytes: number } {
    return this.itemsCache.stats()
  }

  bumpItemsVersion(threadId: string): void {
    this.itemsCache.bumpVersion(threadId)
  }

  private itemHistoryRevision(threadId: string): number {
    return this.itemHistoryRevisions.read(threadId)
  }

  bumpItemHistoryRevision(threadId: string): number {
    return this.itemHistoryRevisions.bump(threadId)
  }

  private eventHistoryRevision(threadId: string): number {
    return this.eventHistoryRevisions.read(threadId)
  }

  private bumpEventHistoryRevision(threadId: string): number {
    return this.eventHistoryRevisions.bump(threadId)
  }

  private cacheItems(threadId: string, items: TurnItem[]): void {
    this.itemsCache.set(threadId, items)
  }

  async archiveItems(input: SessionArchiveInput): Promise<SessionArchiveResult> {
    assertSafeThreadId(input.threadId)
    return writeSessionArchive(this.threadDir(input.threadId), input)
  }

  applyItemToCache(threadId: string, item: TurnItem): void {
    this.itemsCache.applyItem(threadId, item)
  }

  threadDir(threadId: string): string {
    assertSafeThreadId(threadId)
    const path = resolve(this.dataDir, threadId)
    if (!isPathBelowDirectory(this.dataDir, path)) {
      throw new Error(`thread path escapes data directory: ${threadId}`)
    }
    return path
  }

  async withThreadWrite<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.writeQueues.get(threadId) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(operation)
    const guard = run.then(() => undefined, () => undefined)
    this.writeQueues.set(threadId, guard)
    try {
      return await run
    } finally {
      if (this.writeQueues.get(threadId) === guard) this.writeQueues.delete(threadId)
    }
  }

  private eventsPath(threadId: string): string {
    return join(this.threadDir(threadId), 'events.jsonl')
  }

  private messagesPath(threadId: string): string {
    return join(this.threadDir(threadId), 'messages.jsonl')
  }

  liveItemsPath(threadId: string): string {
    return join(this.threadDir(threadId), 'live-items.json')
  }

  private itemTailEvidencePath(threadId: string): string {
    return join(this.threadDir(threadId), 'messages.torn-tail.json')
  }

  private itemIndexPath(threadId: string): string {
    return join(this.threadDir(threadId), 'messages-index.jsonl')
  }

  private itemIndexStatePath(threadId: string): string {
    return join(this.threadDir(threadId), 'messages-index.state.json')
  }

  private async refreshItemIndex(threadId: string, items: readonly TurnItem[]): Promise<void> {
    await this.itemIndex.replaceForItems({
      sourcePath: this.messagesPath(threadId),
      indexPath: this.itemIndexPath(threadId),
      statePath: this.itemIndexStatePath(threadId),
      items
    }).catch((error) => {
      console.warn(`[kun] item history index refresh deferred: ${
        error instanceof Error ? error.message : String(error)
      }`)
    })
  }

  async trimEventsFromSeq(threadId: string, fromSeqInclusive: number): Promise<{ afterBytes: number }> {
    assertSafeThreadId(threadId)
    this.eventsSizeTracker.invalidate(threadId)
    return this.eventHistory.trim(threadId, fromSeqInclusive)
  }

  async eventReplayFloorSeq(threadId: string): Promise<number> {
    if (!isSafeThreadId(threadId)) return 0
    return this.eventHistory.floor(threadId)
  }

  async runEventIndexRebuildSlice(): Promise<boolean> {
    return this.eventIndexRebuild.runSlice()
  }

  setEventIndexRebuildWake(wake: () => void): void {
    this.eventIndexRebuild.setWake(wake)
  }

  async close(): Promise<void> {
    await this.liveCheckpoints.close()
    await this.compactionScheduler.close()
  }

  /** Used by the loop during shutdown to verify the file actually exists. */
  async exists(threadId: string): Promise<boolean> {
    return sessionDirectoryExists(this.threadDir(threadId))
  }
}
