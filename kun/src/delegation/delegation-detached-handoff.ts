import { createHash } from 'node:crypto'
import type { ThreadStore } from '../ports/thread-store.js'
import type { TurnService } from '../services/turn-service.js'
import { dispatchRoomContinuation } from '../rooms/room-continuation-dispatch.js'
import {
  formatDetachedChildNotice,
  proactiveRetryStatus
} from './delegation-proactive-retry.js'
import {
  formatDetachedChildDisplayText
} from './delegation-runtime-support.js'
import type { ChildRunRecord } from './delegation-runtime-contracts.js'
import {
  type DetachedChildHandoff,
  DetachedChildHandoffStore
} from './detached-child-handoff-store.js'

type RunTurn = (threadId: string, turnId: string) => Promise<unknown>

/**
 * Parent wake-ups for settled background children. Every pending obligation
 * of one parent is delivered in a single turn: siblings that settle inside
 * the merge window, or while the parent was busy, never cost a turn each.
 */
export class DetachedChildHandoffCoordinator {
  /** Keyed by parent thread. */
  private readonly retryTimers = new Map<string, NodeJS.Timeout>()
  private readonly mergeWindows = new Map<string, Promise<void>>()
  private readonly deliveries = new Map<string, Promise<void>>()

  constructor(private readonly options: {
    store: DetachedChildHandoffStore
    threadStore?: ThreadStore
    turns?: TurnService
    runTurn: () => RunTurn | null
    proactiveRetry: () => Parameters<typeof proactiveRetryStatus>[1]
    nowIso: () => string
    /** Wait after a child settles so near-simultaneous siblings share one parent turn; 0 delivers at once. */
    mergeWindowMs?: number
  }) {}

  async prepare(record: ChildRunRecord): Promise<DetachedChildHandoff | undefined> {
    if (!shouldNotify(record)) return undefined
    const id = handoffId(record)
    return this.options.store.prepare({
      version: 1,
      id,
      childId: record.id,
      childUpdatedAt: record.updatedAt,
      parentThreadId: record.parentThreadId,
      parentTurnId: record.parentTurnId,
      notice: formatDetachedChildNotice(record, proactiveRetryStatus(
        record,
        this.options.proactiveRetry()
      )),
      displayText: formatDetachedChildDisplayText(record),
      clientRequestId: id,
      createdAt: this.options.nowIso(),
      attempts: 0
    })
  }

  async deliverRecord(record: ChildRunRecord): Promise<void> {
    const pending = (await this.options.store.list())
      .some((handoff) => handoff.childId === record.id && handoff.childUpdatedAt === record.updatedAt)
    if (!pending) return
    const windowMs = this.options.mergeWindowMs ?? 0
    if (windowMs <= 0) return this.deliverParent(record.parentThreadId)
    const open = this.mergeWindows.get(record.parentThreadId)
    if (open) return open
    const window = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, windowMs)
      timer.unref?.()
    }).then(() => {
      this.mergeWindows.delete(record.parentThreadId)
      return this.deliverParent(record.parentThreadId)
    })
    this.mergeWindows.set(record.parentThreadId, window)
    return window
  }

  async replayPending(): Promise<number> {
    const pending = await this.options.store.list()
    const parents = [...new Set(pending.map((handoff) => handoff.parentThreadId))]
    await Promise.all(parents.map((parentThreadId) => this.deliverParent(parentThreadId)))
    return pending.length
  }

  async cleanupParent(parentThreadId: string): Promise<void> {
    this.clearRetry(parentThreadId)
    await this.options.store.cleanupParent(parentThreadId)
  }

  /** Serialize per parent so concurrent triggers share one pass over the pending set. */
  private deliverParent(parentThreadId: string): Promise<void> {
    const queued = (this.deliveries.get(parentThreadId) ?? Promise.resolve())
      .then(() => this.deliverPending(parentThreadId))
      .finally(() => {
        if (this.deliveries.get(parentThreadId) === queued) this.deliveries.delete(parentThreadId)
      })
    this.deliveries.set(parentThreadId, queued)
    return queued
  }

  private async deliverPending(parentThreadId: string): Promise<void> {
    this.clearRetry(parentThreadId)
    // Settle order keeps the merged notice and its idempotency key deterministic.
    const handoffs = (await this.options.store.list())
      .filter((handoff) => handoff.parentThreadId === parentThreadId)
      .sort((left, right) => left.childUpdatedAt.localeCompare(right.childUpdatedAt) ||
        left.childId.localeCompare(right.childId))
    if (!handoffs.length) return
    const { threadStore, turns } = this.options
    const runTurn = this.options.runTurn()
    if (!threadStore || !turns || !runTurn) return
    try {
      const thread = await threadStore.get(parentThreadId)
      if (!thread) {
        await Promise.all(handoffs.map((handoff) => this.options.store.ack(handoff.id)))
        return
      }
      if (thread.status === 'running') throw new Error('parent thread is still running')
      if (thread.roomContext) {
        // Room continuations are keyed per obligation by the room's own queue.
        for (const handoff of handoffs) {
          await dispatchRoomContinuation(threadStore, {
            threadId: thread.id, sourceTurnId: handoff.parentTurnId,
            key: handoff.id, prompt: handoff.notice, kind: 'background_subagent'
          })
          await this.options.store.ack(handoff.id)
        }
        return
      }
      const merged = mergeHandoffs(handoffs)
      let admittedTurnId: string | undefined
      await turns.startTurn({
        threadId: parentThreadId,
        request: {
          prompt: merged.notice,
          displayText: merged.displayText,
          messageSource: 'background_subagent',
          clientRequestId: merged.clientRequestId
        }
      }, {
        onAdmitted: (response) => { admittedTurnId = response.turnId }
      })
      if (admittedTurnId) void runTurn(parentThreadId, admittedTurnId).catch(() => undefined)
      await Promise.all(handoffs.map((handoff) => this.options.store.ack(handoff.id)))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await Promise.all(handoffs.map((handoff) => this.options.store
        .markAttempt(handoff.id, message, this.options.nowIso()).catch(() => undefined)))
      this.scheduleRetry(parentThreadId, Math.max(...handoffs.map((handoff) => handoff.attempts)))
    }
  }

  private scheduleRetry(parentThreadId: string, attempts: number): void {
    if (this.retryTimers.has(parentThreadId)) return
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(5, attempts))
    const timer = setTimeout(() => {
      this.retryTimers.delete(parentThreadId)
      void this.deliverParent(parentThreadId).catch(() => undefined)
    }, delay)
    timer.unref?.()
    this.retryTimers.set(parentThreadId, timer)
  }

  private clearRetry(parentThreadId: string): void {
    const timer = this.retryTimers.get(parentThreadId)
    if (timer) clearTimeout(timer)
    this.retryTimers.delete(parentThreadId)
  }
}

/** One parent turn for a set of obligations; a single one keeps its own idempotency key. */
function mergeHandoffs(handoffs: readonly DetachedChildHandoff[]): Pick<DetachedChildHandoff, 'notice' | 'displayText' | 'clientRequestId'> {
  if (handoffs.length === 1) return handoffs[0]!
  const digest = createHash('sha256').update(handoffs.map((handoff) => handoff.id).join('\0')).digest('hex').slice(0, 32)
  return {
    notice: handoffs.map((handoff) => handoff.notice).join('\n\n'),
    displayText: handoffs.map((handoff) => handoff.displayText).join('\n'),
    clientRequestId: `child_handoff_batch_${digest}`
  }
}

function shouldNotify(record: ChildRunRecord): boolean {
  if (!record.detached) return false
  // ADE workers report through the manager's worker-notice coordinator, which
  // merges them and knows when a failed worker was already rerouted.
  if (record.launcher === 'manager-worker') return false
  if (record.status === 'aborted' && record.terminationReason !== 'user_stop') return false
  return record.status === 'completed' || record.status === 'failed' || record.status === 'aborted'
}

function handoffId(record: ChildRunRecord): string {
  const digest = createHash('sha256')
    .update(`${record.id}\0${record.updatedAt}\0${record.resumeCount ?? 0}`)
    .digest('hex')
    .slice(0, 32)
  return `child_handoff_${digest}`
}
