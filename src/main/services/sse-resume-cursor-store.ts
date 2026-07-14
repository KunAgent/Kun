import { mkdir, readFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { atomicWriteFile } from '../../../kun/src/adapters/file/atomic-write.js'
import {
  SSE_RESUME_CURSOR_SCHEMA_VERSION,
  SseResumeCursorFileSchema,
  SseResumeCursorSchema,
  type SseResumeCursor
} from '../../shared/sse-cursor'

const DEFAULT_MAX_ENTRIES = 256
const MAX_CURSOR_FILE_BYTES = 4 * 1024 * 1024

function sameGeneration(left: SseResumeCursor, right: SseResumeCursor): boolean {
  return !left.runtimeGeneration || !right.runtimeGeneration || left.runtimeGeneration === right.runtimeGeneration
}

/**
 * Small, bounded, single-writer store for renderer resume cursors.
 *
 * It deliberately does not delete a malformed file: a corrupt cursor file is
 * evidence for diagnostics, while a fresh in-memory state lets the app recover
 * without losing the authoritative thread history.
 */
export class SseResumeCursorStore {
  private readonly maxEntries: number
  private loaded = false
  private entries = new Map<string, SseResumeCursor>()
  private operationTail: Promise<void> = Promise.resolve()

  constructor(
    private readonly filePath: string,
    options: { maxEntries?: number } = {}
  ) {
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 10_000) {
      throw new Error('maxEntries must be a safe integer between 1 and 10000')
    }
    this.maxEntries = maxEntries
  }

  async get(scopeId: string): Promise<SseResumeCursor | null> {
    return this.enqueue(async () => {
      await this.ensureLoaded()
      const cursor = this.entries.get(scopeId)
      return cursor ? { ...cursor } : null
    })
  }

  async list(): Promise<SseResumeCursor[]> {
    return this.enqueue(async () => {
      await this.ensureLoaded()
      return [...this.entries.values()]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((cursor) => ({ ...cursor }))
    })
  }

  async save(cursor: SseResumeCursor): Promise<boolean> {
    return this.enqueue(async () => {
      await this.ensureLoaded()
      const normalized = SseResumeCursorSchema.parse(cursor)
      const previous = this.entries.get(normalized.scopeId)
      if (
        previous &&
        sameGeneration(previous, normalized) &&
        normalized.lastSequence < previous.lastSequence
      ) {
        return false
      }
      this.entries.set(normalized.scopeId, normalized)
      this.trim()
      await this.persist()
      return true
    })
  }

  async clear(scopeId: string): Promise<boolean> {
    return this.enqueue(async () => {
      await this.ensureLoaded()
      const removed = this.entries.delete(scopeId)
      if (removed) await this.persist()
      return removed
    })
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.operationTail.then(task, task)
    this.operationTail = next.then(() => undefined, () => undefined)
    return next
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    let fileSize: number
    try {
      fileSize = (await stat(this.filePath)).size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.loaded = true
        return
      }
      throw error
    }
    if (!Number.isSafeInteger(fileSize) || fileSize > MAX_CURSOR_FILE_BYTES) {
      // Keep oversized evidence untouched and fail open with an empty in-memory
      // cursor set. Future saves can replace it through the normal atomic path.
      this.entries = new Map()
      this.loaded = true
      return
    }
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.loaded = true
        return
      }
      throw error
    }
    if (Buffer.byteLength(raw, 'utf8') > MAX_CURSOR_FILE_BYTES) {
      this.entries = new Map()
      this.loaded = true
      return
    }
    try {
      const parsed = SseResumeCursorFileSchema.parse(JSON.parse(raw))
      this.entries = new Map(
        Object.entries(parsed.cursors)
          .filter(([scopeId, cursor]) => scopeId === cursor.scopeId)
      )
      this.trim()
    } catch {
      // Keep the malformed file untouched and start from a recoverable cursor set.
      this.entries = new Map()
    }
    this.loaded = true
  }

  private trim(): void {
    if (this.entries.size <= this.maxEntries) return
    const sorted = [...this.entries.values()]
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, this.maxEntries)
    this.entries = new Map(sorted.map((cursor) => [cursor.scopeId, cursor]))
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const cursors = Object.fromEntries(this.entries)
    await atomicWriteFile(this.filePath, JSON.stringify({
      version: SSE_RESUME_CURSOR_SCHEMA_VERSION,
      cursors
    }, null, 2))
  }
}
