import { stat } from 'node:fs/promises'

export type EventsFileSizeInfo = {
  size: number
  dev: number
  ino: number
}

/**
 * Tracks the canonical events.jsonl size across appends so the hot per-event
 * write path does not pay a `stat()` after every `appendFile`. The first
 * observation for a thread stats the file; later appends add their record
 * bytes.
 *
 * Deliberately does NOT track `mtimeMs`: the highest-seq cache contract
 * requires a real `stat`-backed mtime, and pairing a computed size with a
 * stale seed mtime makes the read-path validation miss on every call (the
 * exact regression reverted in b803fd553). Only size/dev/ino consumers
 * (`recordAppend`) receive this info; highest-seq cache entries written from
 * the append path use `mtimeMs: null` and are upgraded by the read path's
 * real stat.
 *
 * Mutation points that replace or trim the file (event retention trim, usage
 * compaction, memory reset) invalidate the tracked entry so the next append
 * re-stats authoritative bytes.
 */
export class FileSessionEventsSizeTracker {
  private readonly tracked = new Map<string, EventsFileSizeInfo>()

  constructor(
    private readonly pathFor: (threadId: string) => string,
    private readonly maxThreads = 512
  ) {}

  async observeAfterAppend(
    threadId: string,
    recordBytes: number
  ): Promise<EventsFileSizeInfo> {
    const current = this.tracked.get(threadId)
    if (current) {
      const next = { ...current, size: current.size + recordBytes }
      this.remember(threadId, next)
      return next
    }
    // No tracked entry: a stat issued after the append already includes its
    // bytes, so do not add recordBytes again.
    const info = await stat(this.pathFor(threadId))
    const next: EventsFileSizeInfo = { size: info.size, dev: info.dev, ino: info.ino }
    this.remember(threadId, next)
    return next
  }

  invalidate(threadId: string): void {
    this.tracked.delete(threadId)
  }

  clear(): void {
    this.tracked.clear()
  }

  private remember(threadId: string, info: EventsFileSizeInfo): void {
    this.tracked.delete(threadId)
    this.tracked.set(threadId, info)
    while (this.tracked.size > this.maxThreads) {
      const oldest = this.tracked.keys().next().value
      if (oldest === undefined) return
      this.tracked.delete(oldest)
    }
  }
}
