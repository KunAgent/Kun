/**
 * Coalesces per-thread background compaction so live turns never await a
 * full JSONL rewrite. Multiple schedule() calls within the debounce window
 * collapse into one run.
 */
export type CompactionScheduleKind = 'events' | 'items' | 'usage'

export type SessionCompactionSchedulerOptions = {
  delayMs?: number
  run: (threadId: string, kind: CompactionScheduleKind) => Promise<void>
  onError?: (threadId: string, kind: CompactionScheduleKind, error: unknown) => void
  setTimer?: typeof setTimeout
  clearTimer?: typeof clearTimeout
}

const DEFAULT_DELAY_MS = 2_000

export class SessionCompactionScheduler {
  private readonly delayMs: number
  private readonly run: SessionCompactionSchedulerOptions['run']
  private readonly onError: NonNullable<SessionCompactionSchedulerOptions['onError']>
  private readonly setTimer: typeof setTimeout
  private readonly clearTimer: typeof clearTimeout
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly inflight = new Map<string, Promise<void>>()
  private serialTail: Promise<void> = Promise.resolve()
  private closed = false

  constructor(options: SessionCompactionSchedulerOptions) {
    this.delayMs = Math.max(0, Math.floor(options.delayMs ?? DEFAULT_DELAY_MS))
    this.run = options.run
    this.onError = options.onError ?? ((threadId, kind, error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[kun] scheduled ${kind} compaction skipped for ${threadId}: ${message}`)
    })
    this.setTimer = options.setTimer ?? setTimeout
    this.clearTimer = options.clearTimer ?? clearTimeout
  }

  schedule(threadId: string, kind: CompactionScheduleKind): void {
    if (this.closed || !threadId) return
    const key = `${kind}:${threadId}`
    const existing = this.timers.get(key)
    if (existing) this.clearTimer(existing)
    const timer = this.setTimer(() => {
      this.timers.delete(key)
      void this.launch(threadId, kind)
    }, this.delayMs)
    timer.unref?.()
    this.timers.set(key, timer)
  }

  async flush(threadId?: string): Promise<void> {
    const matches = (key: string): boolean => !threadId || key.endsWith(`:${threadId}`)
    // A revision conflict can schedule a retry while the first rewrite is in
    // flight. Drain until no matching timer or run remains, rather than taking
    // one snapshot that can strand that retry during shutdown/tests.
    do {
      const launches: Promise<void>[] = []
      for (const key of [...this.timers.keys()].filter(matches)) {
        const timer = this.timers.get(key)
        if (timer) this.clearTimer(timer)
        this.timers.delete(key)
        const sep = key.indexOf(':')
        launches.push(this.launch(
          key.slice(sep + 1),
          key.slice(0, sep) as CompactionScheduleKind
        ))
      }
      await Promise.all(launches)
      await Promise.all([...this.inflight.entries()]
        .filter(([key]) => matches(key))
        .map(([, promise]) => promise))
    } while (
      [...this.timers.keys()].some(matches) || [...this.inflight.keys()].some(matches)
    )
  }

  /** Drop pending timers without running them; wait for in-flight work. */
  async cancelPending(): Promise<void> {
    for (const timer of this.timers.values()) this.clearTimer(timer)
    this.timers.clear()
    await Promise.all([...this.inflight.values()])
  }

  async close(): Promise<void> {
    this.closed = true
    await this.cancelPending()
  }

  private async launch(threadId: string, kind: CompactionScheduleKind): Promise<void> {
    const key = `${kind}:${threadId}`
    // A profile can contain many oversized legacy threads. Keep all physical
    // rewrites behind one tail so post-readiness repair cannot saturate disk or
    // the shared Manager with concurrent multi-gigabyte scans.
    const previous = this.serialTail
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        if (this.closed) return
        try {
          await this.run(threadId, kind)
        } catch (error) {
          this.onError(threadId, kind, error)
        }
      })
    const guard = run.then(() => undefined, () => undefined)
    this.serialTail = guard
    this.inflight.set(key, guard)
    try {
      await run
    } finally {
      if (this.inflight.get(key) === guard) this.inflight.delete(key)
    }
  }
}
