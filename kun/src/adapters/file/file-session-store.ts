import { appendFile, mkdir, readFile, stat } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { join, resolve } from 'node:path'
import type { SessionStore } from '../../ports/session-store.js'
import type { RuntimeEvent } from '../../contracts/events.js'
import type { TurnItem } from '../../contracts/items.js'
import type { AgentSession } from '../../domain/session.js'
import { readJsonl } from './file-thread-store.js'
import { atomicWriteFile } from './atomic-write.js'

const DEFAULT_USAGE_EVENT_COMPACTION_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_USAGE_EVENT_RETENTION_DAYS = 365
const MS_PER_DAY = 86_400_000
/** Log a warning when a cold loadItems read blocks the loop for at least this long (#621). */
const SLOW_LOAD_ITEMS_LOG_MS = 1_000

/**
 * The agent loop reloads the full item history on every model step, so
 * keep the deduped array for recently touched threads in memory instead
 * of re-reading and re-parsing messages.jsonl each time.
 */
const ITEMS_CACHE_MAX_THREADS = 4

/**
 * File-backed session store. Appends events and items to per-thread
 * JSONL files and keeps the canonical session snapshot in a small
 * JSON file. Replay reads the JSONL files end-to-end.
 */
export class FileSessionStore implements SessionStore {
  private readonly dataDir: string
  private readonly usageEventCompaction: {
    maxBytes: number
    retentionDays: number
    nowIso: () => string
  }
  private readonly itemsCache = new Map<string, TurnItem[]>()
  private readonly itemsCacheVersion = new Map<string, number>()

  constructor(options: {
    dataDir: string
    usageEventCompaction?: {
      maxBytes?: number
      retentionDays?: number
      nowIso?: () => string
    }
  }) {
    this.dataDir = resolve(options.dataDir, 'threads')
    this.usageEventCompaction = {
      maxBytes: Math.max(
        1,
        Math.floor(options.usageEventCompaction?.maxBytes ?? DEFAULT_USAGE_EVENT_COMPACTION_MAX_BYTES)
      ),
      retentionDays: Math.max(
        1,
        Math.floor(options.usageEventCompaction?.retentionDays ?? DEFAULT_USAGE_EVENT_RETENTION_DAYS)
      ),
      nowIso: options.usageEventCompaction?.nowIso ?? (() => new Date().toISOString())
    }
  }

  async appendEvent(threadId: string, event: RuntimeEvent): Promise<void> {
    await this.ensureDir(this.threadDir(threadId))
    const path = this.eventsPath(threadId)
    await appendFile(path, `${JSON.stringify(event)}\n`, 'utf-8')
    if (event.kind === 'usage') {
      await this.compactUsageEventsIfLarge(threadId).catch((error) => {
        warnUsageCompaction(threadId, error)
      })
    }
  }

  async appendItem(threadId: string, item: TurnItem): Promise<void> {
    await this.ensureDir(this.threadDir(threadId))
    const path = this.messagesPath(threadId)
    await appendFile(path, `${JSON.stringify(item)}\n`, 'utf-8')
    this.bumpItemsVersion(threadId)
    this.applyItemToCache(threadId, item)
  }

  async rewriteItems(threadId: string, items: TurnItem[]): Promise<void> {
    await this.ensureDir(this.threadDir(threadId))
    const contents = items.map((item) => JSON.stringify(item)).join('\n')
    await this.atomicWrite(this.messagesPath(threadId), contents ? `${contents}\n` : '')
    this.bumpItemsVersion(threadId)
    this.cacheItems(threadId, [...items])
  }

  async updateItem(threadId: string, itemId: string, patch: Partial<TurnItem>): Promise<TurnItem | null> {
    const items = await this.loadItems(threadId)
    const current = items.find((item) => item.id === itemId)
    if (!current) return null
    const updated = { ...current, ...patch } as TurnItem
    await this.ensureDir(this.threadDir(threadId))
    await appendFile(this.messagesPath(threadId), `${JSON.stringify(updated)}\n`, 'utf-8')
    this.bumpItemsVersion(threadId)
    this.applyItemToCache(threadId, updated)
    return updated
  }

  async loadEventsSince(threadId: string, sinceSeq: number): Promise<RuntimeEvent[]> {
    const all = await readJsonl<RuntimeEvent>(this.eventsPath(threadId))
    return all
      .filter((event) => event.seq > sinceSeq)
      .sort((a, b) => a.seq - b.seq)
  }

  async loadItems(threadId: string): Promise<TurnItem[]> {
    const cached = this.itemsCache.get(threadId)
    if (cached) {
      this.cacheItems(threadId, cached)
      return [...cached]
    }
    const version = this.itemsVersionOf(threadId)
    const startedAt = performance.now()
    const raw = await readJsonl<TurnItem>(this.messagesPath(threadId))
    const latestById = new Map<string, TurnItem>()
    for (const item of raw) {
      latestById.set(item.id, item)
    }
    const seen = new Set<string>()
    // Walk newest→oldest keeping each id's latest write, push (O(1) amortized),
    // then reverse once. The previous unshift-per-item was O(n²) and blocked the
    // event loop for seconds on large threads, starving /health (KunAgent/Kun#621).
    const deduped: TurnItem[] = []
    for (let index = raw.length - 1; index >= 0; index -= 1) {
      const item = raw[index]!
      if (seen.has(item.id)) continue
      seen.add(item.id)
      deduped.push(latestById.get(item.id)!)
    }
    const ordered = deduped.reverse()
    const elapsedMs = performance.now() - startedAt
    if (elapsedMs >= SLOW_LOAD_ITEMS_LOG_MS) {
      // A slow cold read points at an oversized thread log as the likely
      // event-loop staller behind a watchdog restart (#621); the counts say
      // how bloated messages.jsonl has become.
      console.warn(
        `[kun] loadItems(${threadId}) took ${Math.round(elapsedMs)}ms ` +
          `for ${raw.length} raw → ${ordered.length} items`
      )
    }
    // A write that landed while we were reading invalidates this snapshot.
    if (this.itemsVersionOf(threadId) === version) {
      this.cacheItems(threadId, ordered)
      return [...ordered]
    }
    return ordered
  }

  async loadSession(threadId: string): Promise<AgentSession | null> {
    try {
      const raw = await readFile(this.sessionPath(threadId), 'utf-8')
      return JSON.parse(raw) as AgentSession
    } catch {
      return null
    }
  }

  async upsertSession(session: AgentSession): Promise<void> {
    await this.ensureDir(this.threadDir(session.threadId))
    await this.atomicWrite(this.sessionPath(session.threadId), JSON.stringify(session))
  }

  async highestSeq(threadId: string): Promise<number> {
    const events = await readJsonl<RuntimeEvent>(this.eventsPath(threadId))
    return events.reduce((max, event) => Math.max(max, event.seq), 0)
  }

  async resetMemory(): Promise<void> {
    this.itemsCache.clear()
    this.itemsCacheVersion.clear()
  }

  private itemsVersionOf(threadId: string): number {
    return this.itemsCacheVersion.get(threadId) ?? 0
  }

  private bumpItemsVersion(threadId: string): void {
    this.itemsCacheVersion.set(threadId, this.itemsVersionOf(threadId) + 1)
  }

  private cacheItems(threadId: string, items: TurnItem[]): void {
    this.itemsCache.delete(threadId)
    this.itemsCache.set(threadId, items)
    while (this.itemsCache.size > ITEMS_CACHE_MAX_THREADS) {
      const oldest = this.itemsCache.keys().next().value
      if (oldest === undefined) break
      this.itemsCache.delete(oldest)
    }
  }

  private applyItemToCache(threadId: string, item: TurnItem): void {
    const cached = this.itemsCache.get(threadId)
    if (!cached) return
    const index = cached.findIndex((existing) => existing.id === item.id)
    if (index >= 0) cached[index] = item
    else cached.push(item)
  }

  private threadDir(threadId: string): string {
    return join(this.dataDir, threadId)
  }

  private eventsPath(threadId: string): string {
    return join(this.threadDir(threadId), 'events.jsonl')
  }

  private messagesPath(threadId: string): string {
    return join(this.threadDir(threadId), 'messages.jsonl')
  }

  private sessionPath(threadId: string): string {
    return join(this.threadDir(threadId), 'session.json')
  }

  private async ensureDir(path: string): Promise<void> {
    await mkdir(path, { recursive: true })
  }

  private async atomicWrite(path: string, contents: string): Promise<void> {
    await atomicWriteFile(path, contents)
  }

  private async compactUsageEventsIfLarge(threadId: string): Promise<void> {
    const path = this.eventsPath(threadId)
    const info = await stat(path).catch(() => null)
    if (!info || info.size <= this.usageEventCompaction.maxBytes) return
    const events = await readJsonl<RuntimeEvent>(path)
    const compacted = compactUsageEvents(events, {
      nowIso: this.usageEventCompaction.nowIso(),
      retentionDays: this.usageEventCompaction.retentionDays
    })
    if (compacted.length >= events.length) return
    const contents = compacted.map((event) => JSON.stringify(event)).join('\n')
    await this.atomicWrite(path, contents ? `${contents}\n` : '')
  }

  /** Used by the loop during shutdown to verify the file actually exists. */
  async exists(threadId: string): Promise<boolean> {
    try {
      await stat(this.threadDir(threadId))
      return true
    } catch {
      return false
    }
  }
}

function compactUsageEvents(
  events: RuntimeEvent[],
  options: { nowIso: string; retentionDays: number }
): RuntimeEvent[] {
  const cutoffMs = Date.parse(options.nowIso) - options.retentionDays * MS_PER_DAY
  if (!Number.isFinite(cutoffMs)) return events

  let latestUsageIndex = -1
  let latestBeforeCutoffIndex = -1
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event?.kind !== 'usage') continue
    latestUsageIndex = index
    const timestamp = Date.parse(event.timestamp)
    if (Number.isFinite(timestamp) && timestamp < cutoffMs) {
      latestBeforeCutoffIndex = index
    }
  }
  if (latestUsageIndex < 0) return events

  const keep = new Set<number>()
  const latestUsageIndexByBucket = new Map<string, number>()
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event.kind !== 'usage') {
      keep.add(index)
      continue
    }
    if (!shouldRetainUsageEvent(event, index, {
      cutoffMs,
      latestUsageIndex,
      latestBeforeCutoffIndex
    })) {
      continue
    }
    const bucket = usageCoalescingBucket(event)
    const previous = latestUsageIndexByBucket.get(bucket)
    if (previous !== undefined && previous !== latestBeforeCutoffIndex) {
      keep.delete(previous)
    }
    keep.add(index)
    latestUsageIndexByBucket.set(bucket, index)
  }

  return events.filter((_event, index) => keep.has(index))
}

function shouldRetainUsageEvent(
  event: RuntimeEvent,
  index: number,
  options: { cutoffMs: number; latestUsageIndex: number; latestBeforeCutoffIndex: number }
): boolean {
  if (event.kind !== 'usage') return true
  if (index === options.latestUsageIndex || index === options.latestBeforeCutoffIndex) return true
  const timestamp = Date.parse(event.timestamp)
  if (!Number.isFinite(timestamp)) return true
  return timestamp >= options.cutoffMs
}

function usageCoalescingBucket(event: RuntimeEvent): string {
  if (event.kind !== 'usage') return ''
  const day = Number.isFinite(Date.parse(event.timestamp))
    ? new Date(event.timestamp).toISOString().slice(0, 10)
    : event.timestamp
  return `${day}:${event.model ?? ''}`
}

function warnUsageCompaction(threadId: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`[kun] usage event compaction failed for ${threadId}; keeping append-only log: ${message}`)
}
