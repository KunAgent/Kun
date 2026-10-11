import { goalBudgetMessage, goalBudgetStatus, isPrivateRoomGoal } from './goal-execution-budget.js'
import type { ThreadGoal, ThreadRecord } from '../contracts/threads.js'
import { makeErrorItem } from '../domain/item.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { withThreadStoreMutation } from '../services/thread-mutation-coordinator.js'
import type { TurnService } from '../services/turn-service.js'
import type { UsageService } from '../services/usage-service.js'

export type TurnBudgetGateDeps = {
  threadStore: ThreadStore
  turns: Pick<TurnService, 'applyItem'>
  events: Pick<RuntimeEventRecorder, 'record'>
  usage: Pick<UsageService, 'forThread'>
  nowIso: () => string
  /** Current uncharged slice, excluding previously settled suspension slices. */
  goalElapsedSeconds?: (threadId: string, goal: ThreadGoal) => number | undefined
}

export type ModelRequestReservation =
  | { allowed: true; counted: false }
  | { allowed: true; counted: true; count: number }
  | { allowed: false; reason: string }

/**
 * Atomically reserves one extension-run model request against the latest
 * persisted turn. Reading and incrementing under the per-thread mutation lock
 * prevents an auxiliary compaction request and the main request from writing
 * the same stale counter value.
 */
export async function reserveExtensionModelRequest(input: {
  threadStore: ThreadStore
  usage: Pick<UsageService, 'forThread'>
  nowIso: () => string
  threadId: string
  turnId: string
  /** Validate without incrementing an already-reserved main request. */
  reserve?: boolean
}): Promise<ModelRequestReservation> {
  return withThreadStoreMutation(input.threadStore, input.threadId, async () => {
    const current = await input.threadStore.get(input.threadId)
    if (!current) {
      return { allowed: false, reason: `Extension model-request owner thread is unavailable: ${input.threadId}.` }
    }
    const extensionBudget = current.extensionBudget
    if (!extensionBudget) return { allowed: true, counted: false }
    const turn = current.turns.find((candidate) => candidate.id === input.turnId)
    if (!turn) {
      return { allowed: false, reason: `Extension model-request owner turn is unavailable: ${input.turnId}.` }
    }

    const cumulativeTokens = input.usage.forThread(input.threadId).totalTokens
    const usedTokens = Math.max(0, cumulativeTokens - (turn.extensionBudgetTokenBaseline ?? 0))
    if (usedTokens >= extensionBudget.maxTokens) {
      return {
        allowed: false,
        reason: `Extension token budget exhausted: ${usedTokens} used of ${extensionBudget.maxTokens}.`
      }
    }

    const startedAt = Date.parse(turn.startedAt ?? turn.createdAt)
    const now = Date.parse(input.nowIso())
    const elapsedMs = Number.isFinite(startedAt) && Number.isFinite(now)
      ? Math.max(0, now - startedAt)
      : 0
    if (elapsedMs >= extensionBudget.maxElapsedMs) {
      return {
        allowed: false,
        reason: `Extension elapsed-time budget exhausted after ${elapsedMs}ms.`
      }
    }

    if (input.reserve === false) return { allowed: true, counted: false }

    const modelRequests = turn.extensionModelRequests ?? 0
    if (modelRequests >= extensionBudget.maxModelRequests) {
      return {
        allowed: false,
        reason:
          `Extension model-request budget exhausted: ${modelRequests} used of ${extensionBudget.maxModelRequests}.`
      }
    }

    const count = modelRequests + 1
    await input.threadStore.upsert({
      ...current,
      turns: current.turns.map((candidate) =>
        candidate.id === input.turnId
          ? { ...candidate, extensionModelRequests: count }
          : candidate
      ),
      updatedAt: input.nowIso()
    })
    return { allowed: true, counted: true, count }
  })
}

/** Enforces goal-token and per-thread cost budgets before a model request. */
export class TurnBudgetGate {
  constructor(private readonly deps: TurnBudgetGateDeps) {}

  async check(
    thread: ThreadRecord,
    threadId: string,
    turnId: string,
    options: { reserveModelRequest?: boolean } = {}
  ): Promise<'allow' | 'blocked'> {
    const goalLimit = await this.checkGoalBudget(thread, turnId)
    if (goalLimit) {
      await this.deps.events.record({
        kind: 'error',
        threadId,
        turnId,
        message: goalLimit.message,
        code: goalLimit.status === 'budgetLimited' ? 'goal_time_budget_limited' : 'goal_token_budget_limited',
        severity: 'warning'
      })
      return 'blocked'
    }
    const budget = thread.costBudgetUsd
    if (typeof budget !== 'number' || !Number.isFinite(budget) || budget <= 0) {
      return this.reserveMainModelRequest(thread, threadId, turnId, options.reserveModelRequest !== false)
    }
    const spent = this.deps.usage.forThread(threadId).costUsd ?? 0
    if (spent >= budget) {
      const message =
        `Cost budget exhausted for this thread: $${spent.toFixed(4)} used of $${budget.toFixed(4)}.`
      await this.deps.turns.applyItem(threadId, makeErrorItem({
        id: `item_${turnId}_budget_limited`,
        threadId,
        turnId,
        message,
        code: 'budget_limited'
      }))
      await this.deps.events.record({
        kind: 'error',
        threadId,
        turnId,
        message,
        code: 'budget_limited'
      })
      return 'blocked'
    }
    if (spent >= budget * 0.8 && thread.costBudgetWarningSent !== true) {
      const message =
        `Cost budget warning: $${spent.toFixed(4)} used of $${budget.toFixed(4)}.`
      const warningMarked = await withThreadStoreMutation(
        this.deps.threadStore,
        threadId,
        async () => {
          const current = await this.deps.threadStore.get(threadId)
          if (!current) return false
          const currentBudget = current.costBudgetUsd
          if (
            typeof currentBudget !== 'number' ||
            !Number.isFinite(currentBudget) ||
            currentBudget <= 0 ||
            spent < currentBudget * 0.8 ||
            current.costBudgetWarningSent === true
          ) {
            return false
          }
          await this.deps.threadStore.upsert({
            ...current,
            costBudgetWarningSent: true,
            updatedAt: this.deps.nowIso()
          })
          return true
        }
      )
      if (!warningMarked) {
        return this.reserveMainModelRequest(thread, threadId, turnId, options.reserveModelRequest !== false)
      }
      await this.deps.turns.applyItem(threadId, makeErrorItem({
        id: `item_${turnId}_budget_warning`,
        threadId,
        turnId,
        message,
        code: 'budget_warning',
        severity: 'warning'
      }))
      await this.deps.events.record({
        kind: 'error',
        threadId,
        turnId,
        message,
        code: 'budget_warning',
        severity: 'warning'
      })
    }
    return this.reserveMainModelRequest(thread, threadId, turnId, options.reserveModelRequest !== false)
  }

  private async checkGoalBudget(thread: ThreadRecord, turnId: string): Promise<{
    status: 'usageLimited' | 'budgetLimited'; message: string
  } | null> {
    const limited = (value: ThreadRecord) => {
      const goal = value.goal
      if (!goal) return null
      let status = goalBudgetStatus(value, goal)
      const turn = value.turns.find((entry) => entry.id === turnId)
      if (status === 'active' && isPrivateRoomGoal(value) && turn?.status === 'running') {
        // Include the current slice before dispatching another model request.
        // The settled slice is charged durably by GoalTurnCoordinator.
        const start = Math.max(Date.parse(turn.startedAt ?? turn.createdAt), Date.parse(goal.createdAt))
        const elapsed = this.deps.goalElapsedSeconds?.(value.id, goal) ??
          Math.max(0, Math.floor((Date.parse(this.deps.nowIso()) - start) / 1000))
        if (Number.isFinite(elapsed)) status = goalBudgetStatus(value, {
          ...goal, timeUsedSeconds: goal.timeUsedSeconds + elapsed
        })
      }
      return status === 'usageLimited' || status === 'budgetLimited' ? status : null
    }
    const initial = limited(thread)
    if (!initial) return null
    const current = await withThreadStoreMutation(this.deps.threadStore, thread.id, async () => {
      const latest = await this.deps.threadStore.get(thread.id)
      if (!latest) return { thread, status: initial }
      const status = limited(latest)
      if (!status || !latest.goal) return null
      if (latest.goal.status !== status) {
        const updated = { ...latest, goal: { ...latest.goal, status, updatedAt: this.deps.nowIso() } }
        await this.deps.threadStore.upsert(updated)
        return { thread: updated, status, changed: true }
      }
      return { thread: latest, status }
    })
    if (!current) return null
    if (current.changed && current.thread.goal) await this.deps.events.record({
      kind: 'goal_updated', threadId: thread.id, goal: current.thread.goal
    })
    return { status: current.status, message: goalBudgetMessage(current.thread, current.status) }
  }

  /** Reserve an auxiliary model call without terminating the run when no slot remains. */
  reserveAdditionalModelRequest(threadId: string, turnId: string): Promise<ModelRequestReservation> {
    return reserveExtensionModelRequest({
      threadStore: this.deps.threadStore,
      usage: this.deps.usage,
      nowIso: this.deps.nowIso,
      threadId,
      turnId
    })
  }

  /**
   * Re-evaluate usage/cost/elapsed limits after an auxiliary model call while
   * preserving the main request's existing atomic reservation.
   */
  async recheckReservedMainModelRequest(threadId: string, turnId: string): Promise<'allow' | 'blocked'> {
    const current = await this.deps.threadStore.get(threadId)
    if (!current) return 'blocked'
    return this.check(current, threadId, turnId, { reserveModelRequest: false })
  }

  private async reserveMainModelRequest(
    thread: ThreadRecord,
    threadId: string,
    turnId: string,
    reserve: boolean
  ): Promise<'allow' | 'blocked'> {
    if (!thread.extensionBudget) return 'allow'
    const reservation = await reserveExtensionModelRequest({
      threadStore: this.deps.threadStore,
      usage: this.deps.usage,
      nowIso: this.deps.nowIso,
      threadId,
      turnId,
      reserve
    })
    if (reservation.allowed) return 'allow'
    return this.blockExtensionBudget(threadId, turnId, reservation.reason)
  }

  private async blockExtensionBudget(
    threadId: string,
    turnId: string,
    message: string
  ): Promise<'blocked'> {
    await this.deps.turns.applyItem(threadId, makeErrorItem({
      id: `item_${turnId}_extension_budget_limited`,
      threadId,
      turnId,
      message,
      code: 'extension_budget_exhausted'
    }))
    await this.deps.events.record({
      kind: 'error',
      threadId,
      turnId,
      message,
      code: 'extension_budget_exhausted',
      severity: 'warning'
    })
    return 'blocked'
  }
}
