import { createHash } from 'node:crypto'
import type { ThreadStore } from '../ports/thread-store.js'
import type { TurnService } from '../services/turn-service.js'
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

export class DetachedChildHandoffCoordinator {
  private readonly retryTimers = new Map<string, NodeJS.Timeout>()

  constructor(private readonly options: {
    store: DetachedChildHandoffStore
    threadStore?: ThreadStore
    turns?: TurnService
    runTurn: () => RunTurn | null
    proactiveRetry: () => Parameters<typeof proactiveRetryStatus>[1]
    nowIso: () => string
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
      .filter((handoff) => handoff.childId === record.id && handoff.childUpdatedAt === record.updatedAt)
    await Promise.all(pending.map((handoff) => this.deliver(handoff)))
  }

  async replayPending(): Promise<number> {
    const pending = await this.options.store.list()
    await Promise.all(pending.map((handoff) => this.deliver(handoff)))
    return pending.length
  }

  async cleanupParent(parentThreadId: string): Promise<void> {
    const pending = await this.options.store.list()
    for (const handoff of pending.filter((item) => item.parentThreadId === parentThreadId)) {
      this.clearRetry(handoff.id)
    }
    await this.options.store.cleanupParent(parentThreadId)
  }

  private async deliver(handoff: DetachedChildHandoff): Promise<void> {
    this.clearRetry(handoff.id)
    const { threadStore, turns } = this.options
    const runTurn = this.options.runTurn()
    if (!threadStore || !turns || !runTurn) return
    try {
      const thread = await threadStore.get(handoff.parentThreadId)
      if (!thread) {
        await this.options.store.ack(handoff.id)
        return
      }
      if (thread.status === 'running') throw new Error('parent thread is still running')
      let admittedTurnId: string | undefined
      await turns.startTurn({
        threadId: handoff.parentThreadId,
        request: {
          prompt: handoff.notice,
          displayText: handoff.displayText,
          messageSource: 'background_subagent',
          clientRequestId: handoff.clientRequestId
        }
      }, {
        onAdmitted: (response) => { admittedTurnId = response.turnId }
      })
      if (admittedTurnId) void runTurn(handoff.parentThreadId, admittedTurnId).catch(() => undefined)
      await this.options.store.ack(handoff.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.options.store.markAttempt(handoff.id, message, this.options.nowIso()).catch(() => undefined)
      this.scheduleRetry(handoff)
    }
  }

  private scheduleRetry(handoff: DetachedChildHandoff): void {
    if (this.retryTimers.has(handoff.id)) return
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(5, handoff.attempts))
    const timer = setTimeout(() => {
      this.retryTimers.delete(handoff.id)
      void this.options.store.get(handoff.id).then((current) => {
        if (current) return this.deliver(current)
      }).catch(() => undefined)
    }, delay)
    timer.unref?.()
    this.retryTimers.set(handoff.id, timer)
  }

  private clearRetry(id: string): void {
    const timer = this.retryTimers.get(id)
    if (timer) clearTimeout(timer)
    this.retryTimers.delete(id)
  }
}

function shouldNotify(record: ChildRunRecord): boolean {
  if (!record.detached) return false
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
