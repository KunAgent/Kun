import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { ThreadRecord } from '../../contracts/threads.js'
import { ThreadSchema, ThreadSchemaReadable } from '../../contracts/threads.js'
import type { TurnItem } from '../../contracts/items.js'
import { readJsonl } from '../file/file-thread-store.js'
import { readLatestItemsFromJsonl } from '../file/file-session-store.js'
import { JsonlFileAccessCoordinator } from '../file/jsonl-file-access.js'
import {
  hydrateThreadItems,
  normalizeThreadMetadata,
  type ThreadMetadataLine
} from './hybrid-thread-projection.js'

const THREAD_RECORD_CACHE_LIMIT = 128
const DEFAULT_THREAD_RECORD_CACHE_MAX_BYTES = 16 * 1024 * 1024

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
    const entries = await this.fileAccess.withRead(path, () => readJsonl<ThreadMetadataLine>(path))
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      if (entry?.kind !== 'thread_metadata' || entry.thread?.id !== threadId) continue
      const parsed = ThreadSchemaReadable.safeParse(entry.thread)
      if (parsed.success) return normalizeThreadMetadata(parsed.data, entries.slice(0, index + 1))
    }
    return null
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
    return (await this.fileAccess.withRead(path, () => readLatestItemsFromJsonl(path))).items
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

async function fileSignature(path: string): Promise<string> {
  try {
    const info = await stat(path)
    return `${info.size}:${info.mtimeMs}`
  } catch { return 'missing' }
}
