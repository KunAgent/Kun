import type { TurnService } from '../services/turn-service.js'
import type { ThreadStore } from '../ports/thread-store.js'
import { runWithoutTurnMutationFence } from '../manager/turn-mutation-context.js'

/**
 * Runtime-level fair scheduler for durable queued turns.
 *
 * Threads with queued turns enter a FIFO ready queue; a single scheduling
 * pass walks that queue and promotes the oldest queued turn per thread via
 * `startNextQueuedTurn`. When promotion returns null, the thread's durable
 * record decides its fate: still-queued turns mean the thread is blocked on
 * global capacity (or a busy thread/external lease), so the thread stays
 * ready and sleeps until the next wake. Any slot release — turn settlement
 * of any terminal status — wakes the scheduler so capacity freed by thread
 * A can start queued work on thread B.
 *
 * Lost-wakeup safety: every hook marks (or evicts) ready state and bumps a
 * wake counter instead of being dropped when a pass is already running.
 * Events that arrive mid-pass either append to the fresh ready queue or
 * increment `pendingWakes`, which forces exactly one more pass afterwards.
 */
export class QueuedTurnDispatcher {
  private readonly readyIds: string[] = []
  private readonly readySet = new Set<string>()
  private pendingWakes = 0
  private passInFlight = false
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly retries = new Map<string, number>()
  private readonly paused = new Set<string>()
  private disposed = false
  private passPromise: Promise<void> | undefined

  constructor(
    private readonly input: {
      turns: Pick<TurnService, 'startNextQueuedTurn'>
      threadStore: ThreadStore
      runTurn: (threadId: string, turnId: string) => Promise<unknown> | void
    }
  ) {}

  /** Queue-commit / manual trigger: this thread has (or may have) queued work. */
  requestDrain(threadId: string): void {
    this.paused.delete(threadId)
    this.cancelRetry(threadId)
    this.markReady(threadId)
    this.wake()
  }

  /**
   * Terminal settlement trigger. Any status releases a global admission
   * slot, so the scheduler always wakes. `aborted` additionally evicts the
   * thread from the ready queue: an explicit user interrupt pauses that
   * thread's own queue (Stop reliably stops the conversation); it re-enters
   * only on the next queue-commit event.
   */
  onTurnSettled(threadId: string, status: 'completed' | 'failed' | 'aborted'): void {
    if (status === 'aborted') {
      this.paused.add(threadId)
      this.cancelRetry(threadId)
      this.evictReady(threadId)
    } else if (!this.paused.has(threadId)) {
      this.markReady(threadId)
    }
    this.wake()
  }

  /** Restart sweep: schedule every thread that still owns a queued turn. */
  async drainAllQueued(): Promise<number> {
    const summaries = await this.input.threadStore.list({ includeSide: true })
    let queuedThreads = 0
    for (const summary of summaries) {
      const metadata = await (
        this.input.threadStore.getMetadata?.(summary.id) ?? this.input.threadStore.get(summary.id)
      ).catch(() => null)
      if (!metadata?.turns.some((turn) => turn.status === 'queued')) continue
      queuedThreads += 1
      this.markReady(summary.id)
    }
    if (queuedThreads > 0) this.wake()
    return queuedThreads
  }

  private markReady(threadId: string): void {
    if (this.disposed || this.paused.has(threadId)) return
    if (this.readySet.has(threadId)) return
    this.readySet.add(threadId)
    this.readyIds.push(threadId)
  }

  private evictReady(threadId: string): void {
    if (!this.readySet.delete(threadId)) return
    const index = this.readyIds.indexOf(threadId)
    if (index >= 0) this.readyIds.splice(index, 1)
  }

  private wake(): void {
    this.pendingWakes += 1
    this.ensurePass()
  }

  private ensurePass(): void {
    if (this.disposed || this.passInFlight || this.readyIds.length === 0) return
    this.passInFlight = true
    this.passPromise = runWithoutTurnMutationFence(() => this.runPass())
      .catch((error) => {
        console.warn(
          '[kun] queued-turn dispatcher pass failed: ' +
          `${error instanceof Error ? error.message : String(error)}`
        )
      })
      .finally(() => {
        this.passInFlight = false
        // A wake that arrived mid-pass (counter > 0) means new or changed
        // ready state was not consumed by the pass that just ended.
        if (this.pendingWakes > 0) this.ensurePass()
      })
  }

  private async runPass(): Promise<void> {
    for (;;) {
      this.pendingWakes = 0
      const batch = this.readyIds.splice(0, this.readyIds.length)
      for (const id of batch) this.readySet.delete(id)
      if (batch.length === 0) return
      const requeued = new Set<string>()
      for (const threadId of batch) {
        if (this.disposed || this.paused.has(threadId)) continue
        try {
          const started = await this.input.turns.startNextQueuedTurn(threadId)
          if (started) {
            this.cancelRetry(threadId)
            // startNextQueuedTurn already admitted the turn; runTurn is
            // fire-and-forget because its settlement re-enters the thread
            // at the ready tail via onTurnSettled.
            void Promise.resolve(this.input.runTurn(threadId, started.turnId)).catch((error) => {
              console.warn(
                `[kun] queued-turn execution failed for ${threadId}: ` +
                `${error instanceof Error ? error.message : String(error)}`
              )
            })
            continue
          }
          if (await this.threadStillHasQueued(threadId)) {
            // Capacity/busy/lease-blocked: park the thread in the ready
            // queue; it sleeps until the next wake frees capacity.
            this.markReady(threadId)
            requeued.add(threadId)
            this.scheduleRetry(threadId)
          } else {
            this.cancelRetry(threadId)
          }
        } catch (error) {
          console.warn(
            `[kun] queued-turn promotion failed for ${threadId}: ` +
            `${error instanceof Error ? error.message : String(error)}`
          )
          // Transient store failure: keep the thread scheduled so the next
          // wake retries it instead of stranding its durable queue.
          this.markReady(threadId)
          requeued.add(threadId)
          this.scheduleRetry(threadId)
        }
      }
      // Loop only for ready entries added by hooks mid-pass; threads this
      // pass itself re-queued would otherwise spin while blocked. The
      // ensurePass finally-clause covers wakes that arrive after the pass.
      if (this.readyIds.every((id) => requeued.has(id))) return
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const timer of this.retryTimers.values()) clearTimeout(timer)
    this.retryTimers.clear()
    this.retries.clear()
    this.readyIds.length = 0
    this.readySet.clear()
    await this.passPromise
  }

  private cancelRetry(threadId: string): void {
    const timer = this.retryTimers.get(threadId)
    if (timer) clearTimeout(timer)
    this.retryTimers.delete(threadId)
    this.retries.delete(threadId)
  }

  private scheduleRetry(threadId: string): void {
    if (this.disposed || this.paused.has(threadId) || this.retryTimers.has(threadId)) return
    const attempt = this.retries.get(threadId) ?? 0
    this.retries.set(threadId, Math.min(5, attempt + 1))
    const timer = setTimeout(() => {
      this.retryTimers.delete(threadId)
      this.markReady(threadId)
      this.wake()
    }, Math.min(5000, 250 * 2 ** attempt))
    timer.unref?.()
    this.retryTimers.set(threadId, timer)
  }

  private async threadStillHasQueued(threadId: string): Promise<boolean> {
    try {
      const metadata = await (
        this.input.threadStore.getMetadata?.(threadId) ?? this.input.threadStore.get(threadId)
      )
      return Boolean(metadata?.turns.some((turn) => turn.status === 'queued'))
    } catch {
      return true
    }
  }
}
