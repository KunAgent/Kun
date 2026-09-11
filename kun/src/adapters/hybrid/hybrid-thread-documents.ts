import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { ThreadRecord } from '../../contracts/threads.js'
import { ThreadSchemaReadable } from '../../contracts/threads.js'
import type { TurnItem } from '../../contracts/items.js'
import { readJsonlTail } from '../file/file-session-jsonl.js'
import { JsonlFileAccessCoordinator } from '../file/jsonl-file-access.js'
import {
  accumulateTurnMetadata,
  hydrateThreadItems,
  normalizeThreadMetadataFromRecovered,
  type RecoveredTurnMetadata,
  type ThreadMetadataLine
} from './hybrid-thread-projection.js'

const THREAD_RECORD_CACHE_LIMIT = 128
const DEFAULT_THREAD_RECORD_CACHE_MAX_BYTES = 16 * 1024 * 1024
// Mirrors keep incremental read state per thread. Metadata mirrors are small
// (turn fields plus the latest snapshot); item mirrors hold raw TurnItems and
// are capped much lower since hydrated records already carry the data.
const METADATA_MIRROR_LIMIT = 256
const ITEMS_MIRROR_LIMIT = 16

type FileMark = {
  ino: number | null
  byteOffset: number
  mtimeMs: number
}

type MetadataMirror = FileMark & {
  recovered: Map<string, RecoveredTurnMetadata>
  latest: ThreadRecord | null
  record: ThreadRecord | null
}

type ItemsMirror = FileMark & {
  byId: Map<string, TurnItem>
  order: string[]
}

/** Owns canonical JSONL/legacy reads, recovery precedence, and record caching. */
export class HybridThreadDocumentRepository {
  private readonly dataDir: string
  private readonly cacheMaxBytes: number
  private readonly fileAccess: JsonlFileAccessCoordinator
  private cacheBytes = 0
  private readonly cache = new Map<string, {
    metadataSig: string
    itemsSig: string
    record: ThreadRecord
    bytes: number
  }>()
  // Both logs are append-only between compaction rewrites. Mirrors fold only
  // the appended tail so per-item mutations no longer re-parse full history.
  private readonly metadataMirrors = new Map<string, MetadataMirror>()
  private readonly itemsMirrors = new Map<string, ItemsMirror>()

  constructor(dataDir: string, options: {
    cacheMaxBytes?: number
    fileAccess?: JsonlFileAccessCoordinator
  } = {}) {
    this.dataDir = resolve(dataDir, 'threads')
    this.fileAccess = options.fileAccess ?? new JsonlFileAccessCoordinator()
    this.cacheMaxBytes = Math.max(
      1,
      Math.floor(options.cacheMaxBytes ?? DEFAULT_THREAD_RECORD_CACHE_MAX_BYTES)
    )
  }

  invalidate(threadId: string): void {
    const cached = this.cache.get(threadId)
    if (cached) this.cacheBytes = Math.max(0, this.cacheBytes - cached.bytes)
    this.cache.delete(threadId)
    this.metadataMirrors.delete(threadId)
    this.itemsMirrors.delete(threadId)
  }
  threadDir(threadId: string): string { return join(this.dataDir, threadId) }
  metadataPath(threadId: string): string { return join(this.threadDir(threadId), 'metadata.jsonl') }
  legacyThreadPath(threadId: string): string { return join(this.threadDir(threadId), 'thread.json') }
  messagesPath(threadId: string): string { return join(this.threadDir(threadId), 'messages.jsonl') }
  eventsPath(threadId: string): string { return join(this.threadDir(threadId), 'events.jsonl') }

  async readThread(threadId: string): Promise<ThreadRecord | null> {
    const [metadataSig, itemsSig] = await Promise.all([
      fileSignature(this.metadataPath(threadId)), fileSignature(this.messagesPath(threadId))
    ])
    const cached = this.cache.get(threadId)
    if (cached && cached.metadataSig === metadataSig && cached.itemsSig === itemsSig) {
      this.cache.delete(threadId)
      this.cache.set(threadId, cached)
      return cached.record
    }
    const metadata = await this.readLatestMetadata(threadId)
    const legacy = metadata ? null : await this.readLegacyThread(threadId)
    const source = metadata ?? legacy
    if (!source) return null
    const record = hydrateThreadItems(source, await this.loadItems(threadId), {
      preserveExistingItemsWhenNoFileItems: Boolean(legacy)
    })
    this.cacheRecord(threadId, { metadataSig, itemsSig, record })
    return record
  }

  async readLatestMetadata(threadId: string): Promise<ThreadRecord | null> {
    const path = this.metadataPath(threadId)
    const info = await stat(path).catch(() => null)
    if (!info) {
      this.metadataMirrors.delete(threadId)
      return null
    }
    const mark = fileMark(info)
    const mirror = touch(this.metadataMirrors, threadId)
    if (mirror && isContinuation(mirror, mark)) {
      if (mark.byteOffset === mirror.byteOffset) return mirror.record
      const { lines, endOffset } = await this.fileAccess.withRead(
        path,
        () => readJsonlTail(path, mirror.byteOffset)
      )
      foldMetadataLines(threadId, mirror, lines)
      mirror.byteOffset = endOffset
      mirror.mtimeMs = mark.mtimeMs
      return mirror.record
    }
    const fresh: MetadataMirror = {
      ...mark,
      byteOffset: 0,
      recovered: new Map(),
      latest: null,
      record: null
    }
    const { lines, endOffset } = await this.fileAccess.withRead(
      path,
      () => readJsonlTail(path, 0)
    )
    foldMetadataLines(threadId, fresh, lines)
    fresh.byteOffset = endOffset
    setBounded(this.metadataMirrors, threadId, fresh, METADATA_MIRROR_LIMIT)
    return fresh.record
  }

  async readMetadata(threadId: string): Promise<ThreadRecord | null> {
    return (await this.readLatestMetadata(threadId)) ?? this.readLegacyThread(threadId)
  }

  cacheStats(): { entries: number; bytes: number; maxBytes: number } {
    return {
      entries: this.cache.size,
      bytes: this.cacheBytes,
      maxBytes: this.cacheMaxBytes
    }
  }

  private async readLegacyThread(threadId: string): Promise<ThreadRecord | null> {
    try {
      const parsed = ThreadSchemaReadable.safeParse(JSON.parse(await readFile(this.legacyThreadPath(threadId), 'utf-8')))
      return parsed.success ? parsed.data : null
    } catch { return null }
  }

  private async loadItems(threadId: string): Promise<TurnItem[]> {
    const path = this.messagesPath(threadId)
    const info = await stat(path).catch(() => null)
    if (!info) {
      this.itemsMirrors.delete(threadId)
      return []
    }
    const mark = fileMark(info)
    const mirror = touch(this.itemsMirrors, threadId)
    if (mirror && isContinuation(mirror, mark)) {
      if (mark.byteOffset === mirror.byteOffset) return materializeItems(mirror)
      const { lines, endOffset } = await this.fileAccess.withRead(
        path,
        () => readJsonlTail(path, mirror.byteOffset)
      )
      foldItemLines(mirror, lines)
      mirror.byteOffset = endOffset
      mirror.mtimeMs = mark.mtimeMs
      return materializeItems(mirror)
    }
    const fresh: ItemsMirror = { ...mark, byteOffset: 0, byId: new Map(), order: [] }
    const { lines, endOffset } = await this.fileAccess.withRead(
      path,
      () => readJsonlTail(path, 0)
    )
    foldItemLines(fresh, lines)
    fresh.byteOffset = endOffset
    setBounded(this.itemsMirrors, threadId, fresh, ITEMS_MIRROR_LIMIT)
    return materializeItems(fresh)
  }

  private cacheRecord(
    threadId: string,
    entry: { metadataSig: string; itemsSig: string; record: ThreadRecord }
  ): void {
    this.invalidate(threadId)
    const bytes = Buffer.byteLength(JSON.stringify(entry.record), 'utf-8')
    if (bytes > this.cacheMaxBytes / 2 || bytes > this.cacheMaxBytes) return
    this.cache.set(threadId, { ...entry, bytes })
    this.cacheBytes += bytes
    while (
      this.cache.size > THREAD_RECORD_CACHE_LIMIT ||
      this.cacheBytes > this.cacheMaxBytes
    ) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.invalidate(oldest)
    }
  }
}

function fileMark(info: { size: number; mtimeMs: number; ino: number }): FileMark {
  // Some filesystems report ino=0; a missing inode only weakens the rewrite
  // check, while a same-size same-mtime rewrite stays covered by mtimeMs.
  return { ino: info.ino > 0 ? info.ino : null, byteOffset: info.size, mtimeMs: info.mtimeMs }
}

/**
 * True when the file can be read as a tail continuation of the mirror: same
 * inode (or inode unavailable) and grown-or-equal size. A shrunken file or an
 * inode swap (atomic compaction rename) forces a full re-read.
 */
function isContinuation(mirror: FileMark, mark: FileMark): boolean {
  if (mirror.ino !== null && mark.ino !== null && mirror.ino !== mark.ino) return false
  if (mark.byteOffset < mirror.byteOffset) return false
  // Same size with a changed mtime means an in-place rewrite, not an append.
  if (mark.byteOffset === mirror.byteOffset && mark.mtimeMs !== mirror.mtimeMs) return false
  return true
}

function touch<V>(map: Map<string, V>, key: string): V | undefined {
  const value = map.get(key)
  if (value !== undefined) {
    map.delete(key)
    map.set(key, value)
  }
  return value
}

function setBounded<V>(map: Map<string, V>, key: string, value: V, limit: number): void {
  map.delete(key)
  map.set(key, value)
  while (map.size > limit) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

function foldMetadataLines(
  threadId: string,
  mirror: MetadataMirror,
  lines: string[]
): void {
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let entry: ThreadMetadataLine | undefined
    try {
      entry = JSON.parse(trimmed) as ThreadMetadataLine
    } catch {
      continue
    }
    if (entry?.kind !== 'thread_metadata' || entry.thread?.id !== threadId) continue
    const parsed = ThreadSchemaReadable.safeParse(entry.thread)
    if (!parsed.success) continue
    accumulateTurnMetadata(mirror.recovered, parsed.data)
    mirror.latest = parsed.data
  }
  mirror.record = mirror.latest
    ? normalizeThreadMetadataFromRecovered(mirror.latest, mirror.recovered)
    : null
}

function foldItemLines(mirror: ItemsMirror, lines: string[]): void {
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const item = JSON.parse(trimmed) as TurnItem
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) continue
      if (!mirror.byId.has(item.id)) mirror.order.push(item.id)
      mirror.byId.set(item.id, item)
    } catch {
      // A malformed complete line is skipped exactly like a full scan does;
      // an in-flight partial line is never consumed past its newline anyway.
      continue
    }
  }
}

function materializeItems(mirror: ItemsMirror): TurnItem[] {
  return mirror.order.map((id) => mirror.byId.get(id)!)
}

async function fileSignature(path: string): Promise<string> {
  try {
    const info = await stat(path)
    return `${info.size}:${info.mtimeMs}`
  } catch { return 'missing' }
}
