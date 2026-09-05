/**
 * Sliding-window flow control for renderer-acknowledged SSE batches.
 *
 * The original stop-and-wait design sent one batch, blocked all further
 * upstream reads until the renderer acknowledged it, and only then advanced
 * the reconnect cursor. That couples the token stream's throughput to the
 * renderer's dispatch latency: a busy React commit stalls the SSE reader
 * even though the socket buffers are healthy.
 *
 * This controller allows at most `maxInflight` sent-but-unacknowledged
 * batches. The reconnect cursor advances when a batch is *sent*, not when
 * it is acknowledged: IPC delivery to a live renderer is reliable, a dead
 * renderer re-subscribes from its own snapshot cursor, and an ACK timeout
 * tears the stream down so recovery replays durable events from the
 * runtime. No event can be lost or duplicated across those paths.
 */

export const MAX_INFLIGHT_SSE_BATCHES = 4
export const SSE_ACK_TIMEOUT_MS = 15_000
const MAX_RETAINED_BATCH_SAMPLES = 1_000

type InflightBatch = {
  batchId: string
  sentAt: number
  eventCount: number
  settled: boolean
  timer: NodeJS.Timeout
  signal: AbortSignal
  onAbort: () => void
  resolvers: Set<(acknowledged: boolean) => void>
}

export type SseAckWindowStats = {
  inflight: number
  sentBatches: number
  ackedBatches: number
  timedOutBatches: number
  /** Milliseconds between batch send and acknowledgement, per batch. */
  ackLatenciesMs: number[]
  /** Event counts per flushed batch, in flush order. */
  batchSizes: number[]
  /** Send timestamps (ms) per flushed batch, bounded to recent samples. */
  batchSentAtMs: number[]
}

export class SseAckWindow {
  private readonly inflight = new Map<string, InflightBatch>()
  private stats: SseAckWindowStats = {
    inflight: 0,
    sentBatches: 0,
    ackedBatches: 0,
    timedOutBatches: 0,
    ackLatenciesMs: [],
    batchSizes: [],
    batchSentAtMs: []
  }

  constructor(
    private readonly maxInflight: number = MAX_INFLIGHT_SSE_BATCHES,
    private readonly ackTimeoutMs: number = SSE_ACK_TIMEOUT_MS,
    private readonly now: () => number = Date.now,
    private readonly onTimeout: (batchId: string) => void = () => undefined
  ) {}

  get inflightCount(): number {
    return this.inflight.size
  }

  getStats(): SseAckWindowStats {
    return {
      ...this.stats,
      inflight: this.inflight.size,
      ackLatenciesMs: [...this.stats.ackLatenciesMs],
      batchSizes: [...this.stats.batchSizes],
      batchSentAtMs: [...this.stats.batchSentAtMs]
    }
  }

  /**
   * Awaits a free window slot before the caller sends its next batch.
   * Resolves `false` when the stream aborted or a watched batch timed out so
   * the caller stops reading.
   */
  async waitForCapacity(signal: AbortSignal): Promise<boolean> {
    while (this.inflight.size >= this.maxInflight) {
      const oldest = this.oldestInflight()
      if (!oldest) return true
      if (signal.aborted) return false
      const acknowledged = await new Promise<boolean>((resolve) => {
        oldest.resolvers.add(resolve)
      })
      if (signal.aborted) return false
      if (!acknowledged) return false
    }
    return !signal.aborted
  }

  /**
   * Registers an already-sent batch and starts its per-batch ACK watchdog.
   * A timeout settles the batch as unacknowledged and notifies the stream
   * owner; the owner aborts the current fetch/read so the existing transient
   * error handling can reconnect and replay durable events.
   */
  registerSentBatch(options: {
    batchId: string
    eventCount: number
    signal: AbortSignal
  }): void {
    const { batchId, eventCount, signal } = options
    this.stats.sentBatches += 1
    this.pushBounded(this.stats.batchSizes, eventCount)
    this.pushBounded(this.stats.batchSentAtMs, this.now())
    const batch: InflightBatch = {
      batchId,
      sentAt: this.now(),
      eventCount,
      settled: false,
      timer: setTimeout(() => {
        this.stats.timedOutBatches += 1
        this.settle(batch, false)
        // Timeouts are fatal for this subscription even when the window is
        // not full; otherwise a frozen renderer would receive later events.
        this.onTimeout(batchId)
      }, this.ackTimeoutMs),
      signal,
      onAbort: () => undefined,
      resolvers: new Set()
    }
    batch.onAbort = () => this.settle(batch, false)
    signal.addEventListener('abort', batch.onAbort, { once: true })
    this.inflight.set(batchId, batch)
  }

  /** Resolves an acknowledged batch. Unknown ids (already settled) are ignored. */
  acknowledge(batchId: string): boolean {
    const batch = this.inflight.get(batchId)
    if (!batch) return false
    this.settle(batch, true)
    return true
  }

  /** Resolves every in-flight batch as unacknowledged (stream teardown). */
  rejectAll(): void {
    for (const batch of [...this.inflight.values()]) this.settle(batch, false)
  }

  private oldestInflight(): InflightBatch | undefined {
    for (const batch of this.inflight.values()) return batch
    return undefined
  }

  private settle(batch: InflightBatch, acknowledged: boolean): void {
    if (batch.settled) return
    batch.settled = true
    clearTimeout(batch.timer)
    batch.signal.removeEventListener('abort', batch.onAbort)
    this.inflight.delete(batch.batchId)
    if (acknowledged) {
      this.stats.ackedBatches += 1
      this.pushBounded(
        this.stats.ackLatenciesMs,
        Math.max(0, this.now() - batch.sentAt)
      )
    }
    for (const resolve of batch.resolvers) resolve(acknowledged)
    batch.resolvers.clear()
  }

  private pushBounded<T>(values: T[], value: T): void {
    values.push(value)
    if (values.length > MAX_RETAINED_BATCH_SAMPLES) values.shift()
  }
}
