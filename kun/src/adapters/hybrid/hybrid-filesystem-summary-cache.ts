import type { ThreadRecord, ThreadSummary } from '../../contracts/threads.js'
import { compareThreadSummaries } from '../../domain/thread-list-query.js'
import { toThreadSummary } from '../../domain/thread.js'
import { requiresLegacyWorkThreadHydration } from './hybrid-thread-legacy-surface.js'

export type HybridFilesystemSummarySource = {
  threadIds(): Promise<string[]>
  readMetadata(threadId: string): Promise<ThreadRecord | null>
  readThread(threadId: string): Promise<ThreadRecord | null>
  warn(threadId: string, error: unknown): void
}

export class HybridFilesystemSummaryCache {
  private cache: { summaries: ThreadSummary[]; expiresAt: number; generation: number } | null = null
  private load: { generation: number; promise: Promise<ThreadSummary[]> } | null = null
  private generation = 0

  constructor(
    private readonly source: HybridFilesystemSummarySource,
    private readonly ttlMs = 30_000,
    private readonly concurrency = 8
  ) {}

  invalidate(): void {
    this.generation += 1
    this.cache = null
  }

  /**
   * Read summaries for a specific set of thread ids. When a warm scan is
   * available the result is filtered from it (no re-read); otherwise the ids
   * are read directly with bounded concurrency. Used by the list-page
   * transition path so a cold index only touches the not-yet-indexed threads.
   */
  async readByIds(ids: string[]): Promise<ThreadSummary[]> {
    if (ids.length === 0) return []
    const cached = this.cache
    if (cached && cached.expiresAt > Date.now() && cached.generation === this.generation) {
      const wanted = new Set(ids)
      return cached.summaries.filter((summary) => wanted.has(summary.id))
    }
    const summaries: ThreadSummary[] = []
    let nextIndex = 0
    const workerCount = Math.min(this.concurrency, ids.length)
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < ids.length) {
        const threadId = ids[nextIndex]
        nextIndex += 1
        try {
          const metadata = await this.source.readMetadata(threadId)
          const thread = metadata && requiresLegacyWorkThreadHydration(metadata)
            ? await this.source.readThread(threadId) ?? metadata
            : metadata
          if (thread) summaries.push(toThreadSummary(thread))
        } catch (error) {
          this.source.warn(threadId, error)
        }
      }
    }))
    return summaries
  }

  async list(): Promise<ThreadSummary[]> {
    const cached = this.cache
    if (cached && cached.expiresAt > Date.now() && cached.generation === this.generation) {
      return [...cached.summaries]
    }
    if (this.load?.generation === this.generation) return [...await this.load.promise]
    const generation = this.generation
    const promise = this.scan().then((summaries) => {
      if (generation === this.generation) {
        this.cache = { summaries, expiresAt: Date.now() + this.ttlMs, generation }
      }
      return summaries
    }).finally(() => {
      if (this.load?.promise === promise) this.load = null
    })
    this.load = { generation, promise }
    return [...await promise]
  }

  private async scan(): Promise<ThreadSummary[]> {
    const threadIds = await this.source.threadIds()
    const summaries: ThreadSummary[] = []
    let nextIndex = 0
    const workerCount = Math.min(this.concurrency, threadIds.length)
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < threadIds.length) {
        const threadId = threadIds[nextIndex]
        nextIndex += 1
        try {
          const metadata = await this.source.readMetadata(threadId)
          const thread = metadata && requiresLegacyWorkThreadHydration(metadata)
            ? await this.source.readThread(threadId) ?? metadata
            : metadata
          if (thread) summaries.push(toThreadSummary(thread))
        } catch (error) {
          this.source.warn(threadId, error)
        }
      }
    }))
    return summaries.sort(compareThreadSummaries)
  }
}
