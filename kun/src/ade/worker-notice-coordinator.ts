import { createHash } from 'node:crypto'
import type { WorkerNotice } from '../contracts/ade.js'
import type { StartTurnResponse } from '../contracts/turns.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { TurnService } from '../services/turn-service.js'
import type { FileTeamStore } from './team-store.js'
import type { FileWorkerNoticeStore, WorkerNoticeSink } from './worker-notice-store.js'
import { renderWorkerUpdates } from './notice-render.js'

type RunTurn = (threadId: string, turnId: string) => Promise<unknown>

export const WORKER_NOTICE_MERGE_WINDOW_MS = 3_000
export const WORKER_NOTICE_MAX_HOLD_MS = 60_000
const MAX_RETRY_DELAY_MS = 30_000

/**
 * Manager wake-up coordinator (09 §6.2). Wraps the notice store so every
 * enqueue also schedules delivery: notices arriving inside a 3-second merge
 * window collapse into a single worker_update turn keyed by a deterministic
 * batch clientRequestId (same pending set → same key → idempotent replay).
 * A busy manager or an active composer hold backs off exponentially; the
 * store's persisted attempts drive the delay and restart replay.
 */
export class WorkerNoticeCoordinator implements WorkerNoticeSink {
  private readonly mergeTimers = new Map<string, NodeJS.Timeout>()
  private readonly retryTimers = new Map<string, NodeJS.Timeout>()
  private readonly holds = new Map<string, number>()
  /** In-memory busy/hold deferral count; persisted attempts cover errors. */
  private readonly deferrals = new Map<string, number>()
  private readonly deliveries = new Map<string, Promise<void>>()

  constructor(private readonly options: {
    notices: FileWorkerNoticeStore
    teams: Pick<FileTeamStore, 'list'>
    threads: Pick<ThreadStore, 'get'>
    turns: Pick<TurnService, 'startTurn'>
    runTurn: () => RunTurn | null
    nowIso: () => string
    nowMs?: () => number
    /** Manager UI language for the rendered batch (zh* → zh, else en). */
    language?: () => string | undefined
    /** `ade.managerModel` override; falls back to the manager thread route. */
    managerModel?: () => { providerId: string; model: string } | undefined
    mergeWindowMs?: () => number
  }) {}

  async enqueue(notice: WorkerNotice): Promise<WorkerNotice> {
    const stored = await this.options.notices.enqueue(notice)
    this.scheduleMerge(stored.teamId)
    return stored
  }

  /**
   * Composer hold (09 §6.2): the renderer renews while the user is typing so
   * a wake-up never interrupts composition; pending notices ride the user's
   * next message instead. Hold expiry is capped at 60 s.
   */
  holdNotices(managerThreadId: string, holdMs: number): { heldUntil: string } {
    const clamped = Math.min(WORKER_NOTICE_MAX_HOLD_MS, Math.max(1, Math.floor(holdMs)))
    const expiresAt = this.nowMs() + clamped
    this.holds.set(managerThreadId, expiresAt)
    return { heldUntil: new Date(expiresAt).toISOString() }
  }

  holdActive(managerThreadId: string): boolean {
    const expiresAt = this.holds.get(managerThreadId)
    if (expiresAt === undefined) return false
    if (expiresAt > this.nowMs()) return true
    this.holds.delete(managerThreadId)
    return false
  }

  /** Restart replay: every team with unacknowledged notices gets one delivery. */
  async replayPending(): Promise<number> {
    let replayed = 0
    for (const team of await this.options.teams.list()) {
      if (!(await this.options.notices.pending(team.teamId)).length) continue
      replayed += 1
      this.requestDelivery(team.teamId)
    }
    return replayed
  }

  /** Clean per-manager state when the manager thread is deleted. */
  clearManager(managerThreadId: string): void {
    this.clearTimer(this.mergeTimers, managerThreadId)
    this.clearTimer(this.retryTimers, managerThreadId)
    this.holds.delete(managerThreadId)
    this.deferrals.delete(managerThreadId)
  }

  private scheduleMerge(managerThreadId: string): void {
    if (this.mergeTimers.has(managerThreadId)) return
    const delay = Math.max(0, this.options.mergeWindowMs?.() ?? WORKER_NOTICE_MERGE_WINDOW_MS)
    const timer = setTimeout(() => {
      this.mergeTimers.delete(managerThreadId)
      this.requestDelivery(managerThreadId)
    }, delay)
    timer.unref?.()
    this.mergeTimers.set(managerThreadId, timer)
  }

  private scheduleRetry(managerThreadId: string, attempts: number): void {
    if (this.retryTimers.has(managerThreadId)) return
    const delay = Math.min(MAX_RETRY_DELAY_MS, 1_000 * 2 ** Math.min(5, attempts))
    const timer = setTimeout(() => {
      this.retryTimers.delete(managerThreadId)
      this.requestDelivery(managerThreadId)
    }, delay)
    timer.unref?.()
    this.retryTimers.set(managerThreadId, timer)
  }

  /** Serialize deliveries per manager so concurrent triggers share one pass. */
  private requestDelivery(managerThreadId: string): void {
    const queued = (this.deliveries.get(managerThreadId) ?? Promise.resolve())
      .then(() => this.deliverForManager(managerThreadId))
      .catch((error) => {
        console.warn(`[kun] ade worker-notice delivery failed for ${managerThreadId}:`, error)
      })
      .finally(() => {
        if (this.deliveries.get(managerThreadId) === queued) {
          this.deliveries.delete(managerThreadId)
        }
      })
    this.deliveries.set(managerThreadId, queued)
  }

  async deliverForManager(managerThreadId: string): Promise<void> {
    const pending = await this.options.notices.pending(managerThreadId)
    if (!pending.length) return
    const thread = await this.options.threads.get(managerThreadId).catch(() => null)
    if (!thread) {
      await this.options.notices.ack(managerThreadId, pending.map((entry) => entry.noticeId))
      return
    }
    const busy = thread.turns.some(
      (turn) => turn.status === 'running' || turn.status === 'queued'
    )
    if (busy || this.holdActive(managerThreadId)) {
      const deferral = (this.deferrals.get(managerThreadId) ?? 0) + 1
      this.deferrals.set(managerThreadId, deferral)
      this.scheduleRetry(
        managerThreadId,
        Math.max(...pending.map((entry) => entry.attempts)) + deferral
      )
      return
    }
    const batchId = `wnb_${createHash('sha256')
      .update(pending.map((entry) => entry.noticeId).join(','))
      .digest('hex')
      .slice(0, 24)}`
    const rendered = renderWorkerUpdates(pending, this.options.language?.())
    const route = this.options.managerModel?.() ?? {
      providerId: thread.providerId,
      model: thread.model
    }
    let admittedTurnId: string | undefined
    await this.options.turns.startTurn({
      threadId: managerThreadId,
      request: {
        prompt: rendered.prompt,
        displayText: rendered.displayText,
        messageSource: 'worker_update',
        clientRequestId: batchId,
        ...(route.providerId ? { providerId: route.providerId } : {}),
        ...(route.model ? { model: route.model } : {})
      }
    }, {
      onAdmitted: (response: StartTurnResponse) => { admittedTurnId = response.turnId }
    }).then(async () => {
      this.deferrals.delete(managerThreadId)
      if (admittedTurnId) {
        void this.options.runTurn()?.(managerThreadId, admittedTurnId).catch(() => undefined)
      }
      await this.options.notices.ack(managerThreadId, pending.map((entry) => entry.noticeId))
    }, async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      await this.options.notices
        .markAttempt(managerThreadId, pending.map((entry) => entry.noticeId), message)
        .catch(() => undefined)
      this.scheduleRetry(managerThreadId, Math.max(...pending.map((entry) => entry.attempts)) + 1)
    })
  }

  private nowMs(): number {
    return this.options.nowMs?.() ?? Date.now()
  }

  private clearTimer(map: Map<string, NodeJS.Timeout>, key: string): void {
    const timer = map.get(key)
    if (timer) clearTimeout(timer)
    map.delete(key)
  }
}
