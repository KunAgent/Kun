import { writePersistedManagerState } from './service-manager-state-persistence.js'
import type { ServiceManagerStateSnapshot } from './service-manager-state-snapshot.js'

export type ManagerStateWriter = (
  path: string,
  snapshot: ServiceManagerStateSnapshot
) => Promise<void>

export type ManagerStateWriteQueueOptions = {
  /** Durable writer. Defaults to the real `writePersistedManagerState`. */
  writer?: ManagerStateWriter
  /** Retry budget for a recoverable write failure. Defaults to 3 attempts. */
  retry?: { attempts: number; baseDelayMs: number }
  /** Invoked exactly once when retries are exhausted (permanent failure). */
  onPermanentFailure?: (error: unknown) => void
}

export type ManagerStateWriteQueueStats = {
  /** Total snapshots enqueued since construction. */
  enqueued: number
  /** Successful durable writes performed. */
  durableWrites: number
  /** 1 when a newer snapshot is waiting behind the in-flight write, else 0. */
  pendingDepth: number
  /** `lastEnqueuedSeq - lastDurableSeq`: revisions not yet persisted. */
  durableLag: number
  /** Wall-clock duration of the last successful write, in ms. */
  lastWriteMs: number
  /** Timestamp of the last completed durable write. */
  lastDurableFlushAt: number
  /** True while a write failure is being retried or has become permanent. */
  degraded: boolean
}

type PendingSnapshot = { snapshot: ServiceManagerStateSnapshot; seq: number }

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

/**
 * Serialized durable-write queue for the Manager state file.
 *
 * A single drain worker consumes the latest pending snapshot. `enqueue()` only
 * overwrites that snapshot and starts the worker when it is not running, so a
 * burst of mutations collapses into at most two writes (the one already in
 * flight plus one trailing write). `flush()` waits until the snapshot enqueued
 * at call time has been durably persisted.
 *
 * A failed write marks the queue `degraded` and retries a bounded number of
 * times. If retries are exhausted the queue enters a permanent failure state:
 * `enqueue()` becomes a no-op, `flush()` rethrows, and `onPermanentFailure` is
 * called exactly once so the caller can trigger a controlled shutdown.
 */
export class ManagerStateWriteQueue {
  private readonly writer: ManagerStateWriter
  private readonly retryAttempts: number
  private readonly retryBaseDelayMs: number
  private readonly onPermanentFailure: ((error: unknown) => void) | undefined

  private pending: PendingSnapshot | undefined
  private lastEnqueuedSeq = 0
  private lastDurableSeq = 0
  private durableFlushAt = Date.now()
  private durableWrites = 0
  private lastWriteMs = 0
  private degradedFlag = false
  private failure: unknown
  private permanentFailure: unknown
  private workerRunning = false
  private waiters: Array<() => void> = []

  constructor(
    private readonly path: string,
    options: ManagerStateWriteQueueOptions = {}
  ) {
    this.writer = options.writer ?? writePersistedManagerState
    this.retryAttempts = Math.max(1, options.retry?.attempts ?? 3)
    this.retryBaseDelayMs = Math.max(0, options.retry?.baseDelayMs ?? 500)
    this.onPermanentFailure = options.onPermanentFailure
  }

  enqueue(snapshot: ServiceManagerStateSnapshot): void {
    if (this.permanentFailure !== undefined) return
    this.lastEnqueuedSeq += 1
    this.pending = { snapshot, seq: this.lastEnqueuedSeq }
    if (!this.workerRunning) {
      this.workerRunning = true
      void this.drain().finally(() => {
        this.workerRunning = false
        this.wakeWaiters()
      })
    }
  }

  async flush(): Promise<void> {
    if (this.permanentFailure !== undefined) throw this.permanentFailure
    const target = this.lastEnqueuedSeq
    await this.waitUntilDurable(target)
    if (this.permanentFailure !== undefined) throw this.permanentFailure
  }

  get failed(): unknown {
    return this.permanentFailure
  }

  get degraded(): boolean {
    return this.degradedFlag
  }

  get lastDurableFlushAt(): number {
    return this.durableFlushAt
  }

  stats(): ManagerStateWriteQueueStats {
    return {
      enqueued: this.lastEnqueuedSeq,
      durableWrites: this.durableWrites,
      pendingDepth: this.pending !== undefined ? 1 : 0,
      durableLag: this.lastEnqueuedSeq - this.lastDurableSeq,
      lastWriteMs: this.lastWriteMs,
      lastDurableFlushAt: this.durableFlushAt,
      degraded: this.degradedFlag
    }
  }

  private async waitUntilDurable(target: number): Promise<void> {
    while (this.lastDurableSeq < target && this.permanentFailure === undefined) {
      if (!this.workerRunning) return
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve)
      })
    }
  }

  private wakeWaiters(): void {
    const waiters = this.waiters
    this.waiters = []
    for (const resolve of waiters) resolve()
  }

  private async drain(): Promise<void> {
    let attempt = 0
    while (this.pending !== undefined) {
      const item = this.pending
      this.pending = undefined
      const startedAt = performance.now()
      try {
        await this.writer(this.path, item.snapshot)
        this.lastDurableSeq = item.seq
        this.durableFlushAt = Date.now()
        this.lastWriteMs = performance.now() - startedAt
        this.durableWrites += 1
        this.degradedFlag = false
        this.failure = undefined
        attempt = 0
        this.wakeWaiters()
      } catch (error) {
        this.degradedFlag = true
        this.failure = error
        // Restore the failed snapshot only when no newer mutation arrived in
        // the meantime; the next attempt then persists the latest state.
        if (this.pending === undefined) this.pending = item
        attempt += 1
        if (attempt >= this.retryAttempts) {
          this.permanentFailure = error
          this.onPermanentFailure?.(error)
          this.wakeWaiters()
          return
        }
        await delay(this.retryBaseDelayMs * attempt)
      }
    }
  }
}
