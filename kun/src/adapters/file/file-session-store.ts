import { appendFile, mkdir, open, readFile, stat, type FileHandle } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { join, resolve } from 'node:path'
import type {
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
import {
  parseReplayEventRecord,
  readItemPageFromJsonl,
  readLatestItemsFromJsonl,
  firstEventSeqFromJsonl,
  trimEventsWithGuards,
  warnUsageCompaction
} from './file-session-jsonl.js'
import { ItemsCache } from './file-session-items-cache.js'
import { atomicWriteFile } from './atomic-write.js'
import { isPathBelowDirectory } from './path-containment.js'
import { buildPublicItemHistoryPage } from '../../services/item-history-page.js'
import { SessionCompactionScheduler } from './session-compaction-scheduler.js'
import { searchItemTextFile } from './file-session-text-search.js'
import { writeSessionArchive } from './session-history-archive.js'
import { compactUsageEventsIfLarge, sessionDirectoryExists } from './file-session-usage-compaction.js'
import { scanHighestSeqFromTail } from './file-session-seq-tail-scan.js'
import { FileSessionUsageIndex } from './file-session-usage-index.js'
import {
  listThreadDirs,
  loadLatestUsageSnapshotsFromIndex,
  loadUsageRecordsFromIndex
} from './file-session-usage-read.js'

export { readLatestItemsFromJsonl } from './file-session-jsonl.js'
const DEFAULT_USAGE_EVENT_COMPACTION_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_USAGE_EVENT_RETENTION_DAYS = 365
/** Log a warning when a cold loadItems read blocks the loop for at least this long (#621). */
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
const HIGHEST_SEQ_CACHE_MAX_THREADS = 256
const ITEM_HISTORY_REVISION_MAX_THREADS = 512
const EVENT_HISTORY_REVISION_MAX_THREADS = 512
// A valid model tool argument may contain 1 MiB of JSON, whose escaping can
// nearly double the persisted item event. Unresolved `__raw` strings are
// summarized before persistence, while replay remains bounded for valid calls.
export const DEFAULT_EVENT_REPLAY_MAX_RECORD_BYTES = 4 * 1024 * 1024

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
  /** Opaque revisions used to fence stale read-compute-rewrite snapshots. */
  private readonly itemHistoryRevisions = new Map<string, number>()
  private nextItemHistoryRevision = 0
  private readonly eventHistoryRevisions = new Map<string, number>()
  private nextEventHistoryRevision = 0
  private readonly highestSeqCache = new Map<string, { seq: number; size: number; mtimeMs: number }>()
  private readonly writeQueues = new Map<string, Promise<unknown>>()
  private readonly compactionScheduler: SessionCompactionScheduler
  private readonly usageIndex: FileSessionUsageIndex

  constructor(options: {
    dataDir: string
    usageEventCompaction?: {
      maxBytes?: number
      retentionDays?: number
      nowIso?: () => string
    }
    itemsCacheMaxBytes?: number
    itemHistoryCompactionMinBytes?: number
    compactionDelayMs?: number
  }) {
    this.dataDir = resolve(options.dataDir, 'threads')
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
    this.usageEventCompaction = {
      maxBytes: Math.max(1, Math.floor(
        options.usageEventCompaction?.maxBytes ?? DEFAULT_USAGE_EVENT_COMPACTION_MAX_BYTES
      )),
      retentionDays: Math.max(1, Math.floor(
        options.usageEventCompaction?.retentionDays ?? DEFAULT_USAGE_EVENT_RETENTION_DAYS
      )),
      nowIso: options.usageEventCompaction?.nowIso ?? (() => new Date().toISOString())
    }
    this.compactionScheduler = new SessionCompactionScheduler({
      delayMs: options.compactionDelayMs,
      run: async (threadId, kind) => {
        if (kind === 'items') {
          await this.compactItems(threadId)
          return
        }
        await this.compactUsageEventsIfLarge(threadId)
      },
      onError: (threadId, kind, error) => {
        if (kind === 'usage') {
          warnUsageCompaction(threadId, error)
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        console.warn(
          `[kun] item history compaction skipped for ${threadId}; keeping source log: ${message}`
        )
      }
    })
  }

  async appendEvent(threadId: string, event: RuntimeEvent): Promise<void> {
    assertSafeThreadId(threadId)
    await this.withThreadWrite(threadId, async () => {
      await mkdir(this.threadDir(threadId), { recursive: true, mode: 0o700 })
      const path = this.eventsPath(threadId)
      await appendFile(path, `${JSON.stringify(event)}\n`, { encoding: 'utf-8', mode: 0o600 })
      this.bumpEventHistoryRevision(threadId)
      this.cacheHighestSeq(threadId, event.seq, await stat(path), { preserveHigher: true })
      if (event.kind === 'usage') await this.usageIndex.recordUsage(threadId, event)
    })
    // Never await usage compaction on the live append path — a multi-hundred-MB
    // events.jsonl rewrite would starve lease heartbeats (#621 family).
    if (event.kind === 'usage') this.scheduleUsageEventCompaction(threadId)
  }

  async appendItem(threadId: string, item: TurnItem): Promise<void> {
    assertSafeThreadId(threadId)
    await this.withThreadWrite(threadId, async () => {
      await mkdir(this.threadDir(threadId), { recursive: true, mode: 0o700 })
      const path = this.messagesPath(threadId)
      await appendFile(path, `${JSON.stringify(item)}\n`, { encoding: 'utf-8', mode: 0o600 })
      this.bumpItemsVersion(threadId)
      this.applyItemToCache(threadId, item)
      this.bumpItemHistoryRevision(threadId)
    })
  }

  async rewriteItems(threadId: string, items: TurnItem[]): Promise<void> {
    assertSafeThreadId(threadId)
    await this.withThreadWrite(threadId, async () => {
      await mkdir(this.threadDir(threadId), { recursive: true, mode: 0o700 })
      const contents = items.map((item) => JSON.stringify(item)).join('\n')
      await atomicWriteFile(this.messagesPath(threadId), contents ? `${contents}\n` : '')
      this.bumpItemsVersion(threadId)
      this.cacheItems(threadId, [...items])
      this.bumpItemHistoryRevision(threadId)
    })
  }

  async loadItemSnapshot(threadId: string): Promise<ItemHistorySnapshot> {
    if (!isSafeThreadId(threadId)) return { revision: 0, items: [] }
    return this.withThreadWrite(threadId, async () => ({
      revision: this.itemHistoryRevision(threadId),
      items: await this.loadItemsUnlocked(threadId)
    }))
  }

  async rewriteItemsIfRevision(
    threadId: string,
    expectedRevision: number,
    items: TurnItem[]
  ): Promise<ItemHistoryCommit> {
    assertSafeThreadId(threadId)
    return this.withThreadWrite(threadId, async () => {
      const revision = this.itemHistoryRevision(threadId)
      if (revision !== expectedRevision) {
        return { applied: false, reason: 'conflict', revision }
      }
      await mkdir(this.threadDir(threadId), { recursive: true, mode: 0o700 })
      const contents = items.map((item) => JSON.stringify(item)).join('\n')
      await atomicWriteFile(this.messagesPath(threadId), contents ? `${contents}\n` : '')
      this.bumpItemsVersion(threadId)
      this.cacheItems(threadId, [...items])
      return { applied: true, revision: this.bumpItemHistoryRevision(threadId) }
    })
  }

  async updateItem(threadId: string, itemId: string, patch: Partial<TurnItem>): Promise<TurnItem | null> {
    assertSafeThreadId(threadId)
    return this.withThreadWrite(threadId, async () => {
      const items = await this.loadItemsUnlocked(threadId)
      const current = items.find((item) => item.id === itemId)
      if (!current) return null
      const updated = { ...current, ...patch } as TurnItem
      await mkdir(this.threadDir(threadId), { recursive: true, mode: 0o700 })
      await appendFile(this.messagesPath(threadId), `${JSON.stringify(updated)}\n`, { encoding: 'utf-8', mode: 0o600 })
      this.bumpItemsVersion(threadId)
      this.applyItemToCache(threadId, updated)
      this.bumpItemHistoryRevision(threadId)
      return updated
    })
  }

  async compactItems(
    threadId: string,
    options: { force?: boolean } = {}
  ): Promise<ItemHistoryCompactionResult> {
    assertSafeThreadId(threadId)
    const path = this.messagesPath(threadId)
    const info = await stat(path).catch(() => null)
    if (!info) {
      return { compacted: false, beforeBytes: 0, afterBytes: 0, itemCount: 0 }
    }
    if (!options.force && info.size < this.itemHistoryCompactionMinBytes) {
      return {
        compacted: false,
        beforeBytes: info.size,
        afterBytes: info.size,
        itemCount: this.itemsCache.get(threadId)?.length ?? 0
      }
    }
    // Scan unlocked so appendItem/updateItem are not queued behind a 350MB parse.
    const revisionBefore = this.itemHistoryRevision(threadId)
    const parsed = await readLatestItemsFromJsonl(path)
    const contents = parsed.items.map((item) => JSON.stringify(item)).join('\n')
    const output = contents ? `${contents}\n` : ''
    const afterBytes = Buffer.byteLength(output, 'utf-8')
    return this.withThreadWrite(threadId, async () => {
      const currentInfo = await stat(path).catch(() => null)
      if (
        this.itemHistoryRevision(threadId) !== revisionBefore ||
        !currentInfo ||
        currentInfo.size !== info.size ||
        currentInfo.mtimeMs !== info.mtimeMs
      ) {
        // A concurrent append invalidated the snapshot; coalesce another pass.
        this.scheduleItemHistoryCompaction(threadId)
        return {
          compacted: false,
          beforeBytes: info.size,
          afterBytes: info.size,
          itemCount: parsed.items.length
        }
      }
      const malformedCount = parsed.malformedCount + (parsed.incompleteTrailingRecord ? 1 : 0)
      if (malformedCount > 0) {
        throw new Error(`item history contains ${malformedCount} malformed record(s)`)
      }
      if (afterBytes >= currentInfo.size) {
        this.cacheItems(threadId, parsed.items)
        return {
          compacted: false,
          beforeBytes: currentInfo.size,
          afterBytes: currentInfo.size,
          itemCount: parsed.items.length
        }
      }
      await atomicWriteFile(path, output, { allowDirectWriteFallback: false })
      this.bumpItemsVersion(threadId)
      this.cacheItems(threadId, parsed.items)
      this.bumpItemHistoryRevision(threadId)
      return {
        compacted: true,
        beforeBytes: info.size,
        afterBytes,
        itemCount: parsed.items.length
      }
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
    // Stream forward so callers that only need a tail never allocate the full
    // append-only log. Sort remains for stores that historically emitted out of
    // order; healthy writers already append in seq order.
    const events: RuntimeEvent[] = []
    for await (const event of this.iterateEventsSince(threadId, sinceSeq)) {
      events.push(event)
    }
    return events.sort((a, b) => a.seq - b.seq)
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
    let remainder = ''
    try {
      const stream = createReadStream(this.eventsPath(threadId), {
        encoding: 'utf-8',
        // Keep the raw chunk well below one record budget. A malformed line
        // without a newline therefore cannot force a whole-log allocation.
        highWaterMark: Math.min(maxRecordBytes, 64 * 1024)
      })
      for await (const chunk of stream) {
        remainder += typeof chunk === 'string' ? chunk : chunk.toString('utf-8')
        let newline = remainder.indexOf('\n')
        while (newline >= 0) {
          const line = remainder.slice(0, newline)
          remainder = remainder.slice(newline + 1)
          const event = parseReplayEventRecord(line, maxRecordBytes)
          if (event && event.seq > sinceSeq) yield event
          newline = remainder.indexOf('\n')
        }
        if (Buffer.byteLength(remainder, 'utf-8') > maxRecordBytes) {
          throw new Error(`event replay record exceeds ${maxRecordBytes} bytes`)
        }
      }
      // Bytes after the final newline belong to an in-flight append.
      if (remainder.trim() && Buffer.byteLength(remainder, 'utf-8') > maxRecordBytes) {
        throw new Error(`event replay record exceeds ${maxRecordBytes} bytes`)
      }
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return
      throw error
    }
  }

  async loadItems(threadId: string): Promise<TurnItem[]> {
    if (!isSafeThreadId(threadId)) return []
    return this.withThreadWrite(threadId, () => this.loadItemsUnlocked(threadId))
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
    return searchItemTextFile({
      path: this.messagesPath(threadId),
      query,
      maxBytes,
      cachedItems: this.itemsCache.get(threadId),
      options
    })
  }

  async loadItemPage(
    threadId: string,
    options: ItemHistoryPageOptions
  ): Promise<ItemHistoryPage> {
    if (!isSafeThreadId(threadId)) {
      return { items: [], hasMore: false, itemBytes: 0 }
    }
    type PageSource =
      | { kind: 'cached'; items: TurnItem[] }
      | { kind: 'file'; handle: FileHandle; size: number }
    const source = await this.withThreadWrite<PageSource | null>(threadId, async () => {
      const cached = this.itemsCache.get(threadId)
      if (cached) {
        this.cacheItems(threadId, cached)
        return { kind: 'cached', items: [...cached] }
      }
      let handle: FileHandle | undefined
      try {
        handle = await open(this.messagesPath(threadId), 'r')
        const info = await handle.stat()
        return { kind: 'file', handle, size: info.size }
      } catch (error) {
        await handle?.close().catch(() => undefined)
        if ((error as { code?: string }).code === 'ENOENT') return null
        throw error
      }
    })
    if (!source) return { items: [], hasMore: false, itemBytes: 0 }
    if (source.kind === 'cached') return buildPublicItemHistoryPage(source.items, options)
    if (source.size <= 0) {
      await source.handle.close()
      return { items: [], hasMore: false, itemBytes: 0 }
    }
    const page = await readItemPageFromJsonl(source.handle, source.size, options)
    if (source.size >= this.itemHistoryCompactionMinBytes) this.scheduleItemHistoryCompaction(threadId)
    return page
  }

  private async loadItemsUnlocked(threadId: string): Promise<TurnItem[]> {
    const cached = this.itemsCache.get(threadId)
    if (cached) {
      this.cacheItems(threadId, cached)
      return [...cached]
    }
    const info = await stat(this.messagesPath(threadId)).catch(() => null)
    if (info && info.size >= this.itemHistoryCompactionMinBytes) {
      // Defer rewrite; still return a cold deduped projection for this caller.
      this.scheduleItemHistoryCompaction(threadId)
    }
    const startedAt = performance.now()
    const { items: ordered, rawCount } = await readLatestItemsFromJsonl(
      this.messagesPath(threadId)
    )
    const elapsedMs = performance.now() - startedAt
    if (elapsedMs >= SLOW_LOAD_ITEMS_LOG_MS) {
      // A slow cold read points at an oversized thread log as the likely
      // event-loop staller behind a watchdog restart (#621); counts show the bloat.
      console.warn(
        `[kun] loadItems(${threadId}) took ${Math.round(elapsedMs)}ms ` +
          `for ${rawCount} raw → ${ordered.length} items`
      )
    }
    this.cacheItems(threadId, ordered)
    return [...ordered]
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
    const info = await stat(path).catch(() => null)
    if (!info) {
      this.highestSeqCache.delete(threadId)
      return 0
    }
    const cached = this.highestSeqCache.get(threadId)
    if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
      this.cacheHighestSeq(threadId, cached.seq, info)
      return cached.seq
    }
    // Events append in seq order: the newest max sits at the tail, so a
    // backwards scan avoids stream-parsing the whole log on a cache miss (#621).
    const tail = await scanHighestSeqFromTail({ path, fileSize: info.size })
    if (tail.ok) {
      this.cacheHighestSeq(threadId, tail.highestSeq, info)
      return tail.highestSeq
    }
    let highest = 0
    for await (const event of this.iterateEventsSince(threadId, -1)) {
      highest = Math.max(highest, event.seq)
    }
    // Cache against the size captured before the streaming scan. If a writer
    // appended concurrently, the next stat differs and forces another scan
    // rather than pairing an old sequence with the new file size.
    this.cacheHighestSeq(threadId, highest, info)
    return highest
  }

  async resetMemory(): Promise<void> {
    await this.compactionScheduler.cancelPending().catch(() => undefined)
    this.itemsCache.clear()
    this.itemHistoryRevisions.clear()
    this.eventHistoryRevisions.clear()
    this.highestSeqCache.clear()
    this.usageIndex.resetMemory()
  }

  clearThreadMemory(threadId: string): void {
    this.itemsCache.removeAll(threadId)
    this.itemHistoryRevisions.delete(threadId)
    this.eventHistoryRevisions.delete(threadId)
    this.highestSeqCache.delete(threadId)
    this.usageIndex.clearThreadMemory(threadId)
  }

  itemCacheStats(): { entries: number; bytes: number; maxBytes: number } {
    return this.itemsCache.stats()
  }

  private bumpItemsVersion(threadId: string): void {
    this.itemsCache.bumpVersion(threadId)
  }

  private itemHistoryRevision(threadId: string): number {
    const revision = this.itemHistoryRevisions.get(threadId)
    if (revision === undefined) return this.bumpItemHistoryRevision(threadId)
    this.itemHistoryRevisions.delete(threadId)
    this.itemHistoryRevisions.set(threadId, revision)
    return revision
  }

  private bumpItemHistoryRevision(threadId: string): number {
    this.nextItemHistoryRevision += 1
    this.itemHistoryRevisions.delete(threadId)
    this.itemHistoryRevisions.set(threadId, this.nextItemHistoryRevision)
    while (this.itemHistoryRevisions.size > ITEM_HISTORY_REVISION_MAX_THREADS) {
      const oldest = this.itemHistoryRevisions.keys().next().value
      if (oldest === undefined) break
      this.itemHistoryRevisions.delete(oldest)
    }
    return this.nextItemHistoryRevision
  }

  private eventHistoryRevision(threadId: string): number {
    const revision = this.eventHistoryRevisions.get(threadId)
    if (revision === undefined) return this.bumpEventHistoryRevision(threadId)
    this.eventHistoryRevisions.delete(threadId)
    this.eventHistoryRevisions.set(threadId, revision)
    return revision
  }

  private bumpEventHistoryRevision(threadId: string): number {
    this.nextEventHistoryRevision += 1
    this.eventHistoryRevisions.delete(threadId)
    this.eventHistoryRevisions.set(threadId, this.nextEventHistoryRevision)
    while (this.eventHistoryRevisions.size > EVENT_HISTORY_REVISION_MAX_THREADS) {
      const oldest = this.eventHistoryRevisions.keys().next().value
      if (oldest === undefined) break
      this.eventHistoryRevisions.delete(oldest)
    }
    return this.nextEventHistoryRevision
  }

  private cacheItems(threadId: string, items: TurnItem[]): void {
    this.itemsCache.set(threadId, items)
  }

  private cacheHighestSeq(
    threadId: string,
    seq: number,
    info: { size: number; mtimeMs: number },
    options: { preserveHigher?: boolean } = {}
  ): void {
    const current = this.highestSeqCache.get(threadId)?.seq ?? 0
    this.highestSeqCache.delete(threadId)
    this.highestSeqCache.set(threadId, {
      seq: options.preserveHigher ? Math.max(current, seq) : seq,
      size: info.size,
      mtimeMs: info.mtimeMs
    })
    while (this.highestSeqCache.size > HIGHEST_SEQ_CACHE_MAX_THREADS) {
      const oldest = this.highestSeqCache.keys().next().value
      if (oldest === undefined) return
      this.highestSeqCache.delete(oldest)
    }
  }

  async archiveItems(input: SessionArchiveInput): Promise<SessionArchiveResult> {
    assertSafeThreadId(input.threadId)
    return writeSessionArchive(this.threadDir(input.threadId), input)
  }

  private applyItemToCache(threadId: string, item: TurnItem): void {
    this.itemsCache.applyItem(threadId, item)
  }

  private threadDir(threadId: string): string {
    assertSafeThreadId(threadId)
    const path = resolve(this.dataDir, threadId)
    if (!isPathBelowDirectory(this.dataDir, path)) {
      throw new Error(`thread path escapes data directory: ${threadId}`)
    }
    return path
  }

  private async withThreadWrite<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
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

  async trimEventsFromSeq(threadId: string, fromSeqInclusive: number): Promise<{ afterBytes: number }> {
    assertSafeThreadId(threadId)
    const path = this.eventsPath(threadId)
    const info = await stat(path).catch(() => null)
    if (!info) return { afterBytes: 0 }
    return trimEventsWithGuards({
      path,
      fromSeqInclusive,
      maxRecordBytes: DEFAULT_EVENT_REPLAY_MAX_RECORD_BYTES,
      info,
      revisionBefore: this.eventHistoryRevision(threadId),
      readRevision: () => this.eventHistoryRevision(threadId),
      bumpRevision: () => this.bumpEventHistoryRevision(threadId),
      invalidateCache: () => this.highestSeqCache.delete(threadId),
      withWrite: (operation) => this.withThreadWrite(threadId, operation),
      scheduleRetry: () => this.scheduleUsageEventCompaction(threadId)
    })
  }

  async eventReplayFloorSeq(threadId: string): Promise<number> {
    if (!isSafeThreadId(threadId)) return 0
    // The first parseable event in the log defines the floor; trimming only
    // ever removes a prefix, so a single head record is sufficient.
    return firstEventSeqFromJsonl(this.eventsPath(threadId))
  }

  private async compactUsageEventsIfLarge(threadId: string): Promise<void> {
    await compactUsageEventsIfLarge({
      path: this.eventsPath(threadId),
      maxBytes: this.usageEventCompaction.maxBytes,
      nowIso: this.usageEventCompaction.nowIso(),
      retentionDays: this.usageEventCompaction.retentionDays,
      maxRecordBytes: DEFAULT_EVENT_REPLAY_MAX_RECORD_BYTES,
      readRevision: () => this.eventHistoryRevision(threadId),
      bumpRevision: () => this.bumpEventHistoryRevision(threadId),
      withWrite: (operation) => this.withThreadWrite(threadId, operation),
      scheduleRetry: () => this.scheduleUsageEventCompaction(threadId),
      invalidateCache: () => this.highestSeqCache.delete(threadId)
    })
  }

  /** Used by the loop during shutdown to verify the file actually exists. */
  async exists(threadId: string): Promise<boolean> {
    return sessionDirectoryExists(this.threadDir(threadId))
  }
}
