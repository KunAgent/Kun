import type { ThreadGoal, ThreadRecord } from '../contracts/threads.js'
import { touchThread } from '../domain/thread.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { withThreadStoreMutation } from '../services/thread-mutation-coordinator.js'
import { TurnCapacityError, type TurnService } from '../services/turn-service.js'
import { GET_GOAL_TOOL_NAME, UPDATE_GOAL_TOOL_NAME } from '../adapters/tool/goal-tools.js'
import {
  GoalResumeCoordinator,
  DEFAULT_MAX_GOAL_RESUME_NO_PROGRESS_ATTEMPTS,
  type GoalResumeCoordinatorDeps
} from './goal-resume-coordinator.js'
import type { TurnExecutionStatus, TurnRunOutcome } from './turn-execution-types.js'
import { resolveTurnClientSurface } from './turn-context-resolver.js'
import type { ToolHostResult } from '../ports/tool-host.js'
import { launchContinuationTurn } from './continuation-turn-launch.js'
import type { RestartRecoverySource } from './restart-recovery-source.js'

const GOAL_RESUME_PROMPT = [
  'Continue working toward the active goal.',
  'The previous attempt stopped before the goal was complete (it was interrupted, truncated, or the runtime restarted, or it simply stopped early).',
  'Review the current state, pick up where the work left off, and keep going until the goal is genuinely achieved or blocked.'
].join(' ')

const GOAL_NON_PROGRESS_TOOL_NAMES = new Set<string>([
  GET_GOAL_TOOL_NAME,
  UPDATE_GOAL_TOOL_NAME
])

export type GoalElapsedTimer = Readonly<{
  startedAtMs: number
  createdAt: string
  objective: string
}>

export type GoalTurnCoordinatorOptions = Pick<
  GoalResumeCoordinatorDeps,
  'setTimer' | 'log' | 'maxNoProgressAttempts' | 'baseDelayMs' | 'maxDelayMs'
>

export type GoalTurnCoordinatorDeps = {
  threadStore: ThreadStore
  turns: Pick<TurnService, 'startTurn' | 'finishTurn'>
  events: Pick<RuntimeEventRecorder, 'record'>
  nowIso: () => string
  nowMs: () => number
  runTurn: (threadId: string, turnId: string) => Promise<TurnRunOutcome>
  goalResume?: GoalTurnCoordinatorOptions
}

/**
 * Owns goal-specific accounting and cross-turn continuation state. Terminal
 * turn settlement remains outside this service; it only reacts after the
 * durable winner is known.
 */
export class GoalTurnCoordinator {
  private readonly madeProgressByTurn = new Set<string>()
  private readonly resumeSuppressedByTurn = new Set<string>()
  private readonly restartSourceTurnByThread = new Map<string, string>()
  private readonly resume: GoalResumeCoordinator

  constructor(private readonly deps: GoalTurnCoordinatorDeps) {
    this.resume = new GoalResumeCoordinator({
      launch: (threadId) => this.launchResumeTurn(threadId),
      getActiveGoalKey: async (threadId) => {
        const thread = await this.deps.threadStore.get(threadId)
        const expectedSource = this.restartSourceTurnByThread.get(threadId)
        const latest = thread?.turns.at(-1)
        if (expectedSource && (latest?.id !== expectedSource || latest.status !== 'failed')) {
          return null
        }
        const goal = thread?.goal
        return goal && goal.status === 'active' ? goalResumeKey(threadId, goal) : null
      },
      isThreadBusy: async (threadId) =>
        (await this.deps.threadStore.get(threadId))?.status === 'running',
      ...this.deps.goalResume
    })
  }

  shutdown(): void {
    this.resume.shutdown()
    this.restartSourceTurnByThread.clear()
  }

  async resumeInterruptedGoals(sources: readonly RestartRecoverySource[]): Promise<number> {
    let resumed = 0
    for (const source of sources) {
      const latest = (await this.deps.threadStore.get(source.threadId))?.turns.at(-1)
      if (latest?.id !== source.turnId || latest.status !== 'failed') continue
      this.restartSourceTurnByThread.set(source.threadId, source.turnId)
      if (await this.resume.resumeInterrupted(source.threadId)) resumed += 1
    }
    return resumed
  }

  async begin(threadId: string): Promise<GoalElapsedTimer | null> {
    const goal = (await this.deps.threadStore.get(threadId))?.goal
    if (!goal || goal.status !== 'active') return null
    return {
      startedAtMs: this.deps.nowMs(),
      createdAt: goal.createdAt,
      objective: goal.objective
    }
  }

  /** Account elapsed time and evaluate resume without letting one mask the other. */
  async afterTerminal(input: {
    threadId: string
    turnId: string
    finalStatus: TurnExecutionStatus
    timer: GoalElapsedTimer | null
  }): Promise<void> {
    const restartSource = this.restartSourceTurnByThread.get(input.threadId)
    if (restartSource && restartSource !== input.turnId) {
      this.restartSourceTurnByThread.delete(input.threadId)
    }
    await this.finishElapsedTimer(input.threadId, input.timer).catch(() => undefined)
    await this.evaluateResume(input.threadId, input.turnId, input.finalStatus).catch(() => undefined)
  }

  /** Account a reliable graceful-suspension slice without terminal resume policy. */
  async afterSuspended(threadId: string, timer: GoalElapsedTimer | null): Promise<void> {
    await this.finishElapsedTimer(threadId, timer)
  }

  noteToolExecuted(turnId: string, toolName: string, result: ToolHostResult): void {
    if (
      !GOAL_NON_PROGRESS_TOOL_NAMES.has(toolName) &&
      result.item.kind === 'tool_result' &&
      result.item.isError !== true
    ) {
      this.madeProgressByTurn.add(turnId)
    }
  }

  hasMadeProgress(turnId: string): boolean {
    return this.madeProgressByTurn.has(turnId)
  }

  suppressResume(turnId: string): void {
    this.resumeSuppressedByTurn.add(turnId)
  }

  clearTurn(turnId: string): void {
    this.madeProgressByTurn.delete(turnId)
    this.resumeSuppressedByTurn.delete(turnId)
  }

  async recordUsage(threadId: string, tokenDelta: number): Promise<void> {
    const delta = Math.max(0, Math.floor(tokenDelta))
    if (delta === 0) return
    const goal = await this.mutateThread(threadId, async (thread) => {
      if (!thread.goal || thread.goal.status !== 'active') return null
      const tokensUsed = thread.goal.tokensUsed + delta
      const next: ThreadGoal = {
        ...thread.goal,
        tokensUsed,
        status:
          thread.goal.tokenBudget !== undefined &&
          thread.goal.tokenBudget !== null &&
          tokensUsed >= thread.goal.tokenBudget
            ? 'usageLimited'
            : 'active',
        updatedAt: this.deps.nowIso()
      }
      await this.deps.threadStore.upsert(touchThread({ ...thread, goal: next }, next.updatedAt))
      return next
    })
    if (!goal) return
    await this.deps.events.record({ kind: 'goal_updated', threadId, goal })
  }

  private async finishElapsedTimer(
    threadId: string,
    timer: GoalElapsedTimer | null
  ): Promise<void> {
    if (!timer) return
    const elapsedSeconds = Math.floor(
      Math.max(0, this.deps.nowMs() - timer.startedAtMs) / 1000
    )
    if (elapsedSeconds <= 0) return

    const goal = await this.mutateThread(threadId, async (current) => {
      const currentGoal = current.goal
      if (!currentGoal) return null
      if (currentGoal.createdAt !== timer.createdAt || currentGoal.objective !== timer.objective) {
        return null
      }
      const now = this.deps.nowIso()
      const next: ThreadGoal = {
        ...currentGoal,
        timeUsedSeconds: (currentGoal.timeUsedSeconds ?? 0) + elapsedSeconds,
        updatedAt: now
      }
      await this.deps.threadStore.upsert(touchThread({ ...current, goal: next }, now))
      return next
    })
    if (!goal) return
    await this.deps.events.record({ kind: 'goal_updated', threadId, goal })
  }

  private async evaluateResume(
    threadId: string,
    turnId: string,
    finalStatus: TurnExecutionStatus
  ): Promise<void> {
    const thread = await this.deps.threadStore.get(threadId)
    const goal = thread?.goal
    if (!thread || !goal || goal.status !== 'active') {
      this.resume.clear(threadId)
      return
    }
    const turn = thread.turns.find((candidate) => candidate.id === turnId)
    const wasPlanTurn = turn?.mode === 'plan' || Boolean(turn?.guiPlan)
    const deliberateStop = this.resumeSuppressedByTurn.has(turnId)
    if (finalStatus === 'aborted' || wasPlanTurn || deliberateStop) {
      this.resume.clear(threadId)
      return
    }
    const outcome = this.resume.noteGoalTurnSettled({
      threadId,
      goalKey: goalResumeKey(threadId, goal),
      madeProgress: this.madeProgressByTurn.has(turnId)
    })
    if (outcome === 'exhausted') {
      await this.transitionGoalStatus(
        threadId,
        turnId,
        'blocked',
        `Goal auto-resume stopped: ${DEFAULT_MAX_GOAL_RESUME_NO_PROGRESS_ATTEMPTS} consecutive attempts made no progress. Set the goal active again to retry.`
      )
    }
  }

  private async launchResumeTurn(threadId: string): Promise<void> {
    const thread = await this.deps.threadStore.get(threadId)
    const goal = thread?.goal
    const sourceTurnId = this.restartSourceTurnByThread.get(threadId)
    if (!thread || !goal || goal.status !== 'active') return
    const lastTurn = thread.turns[thread.turns.length - 1]
    let started
    try {
      const startRequest = {
        threadId,
        request: {
          prompt: GOAL_RESUME_PROMPT,
          mode: 'agent' as const,
          ...(lastTurn ? { clientSurface: resolveTurnClientSurface(lastTurn) } : {}),
          ...(lastTurn?.agentSurface ? { agentSurface: lastTurn.agentSurface } : {}),
          ...(lastTurn?.agentSurface === 'design'
            ? {
                messageSource: 'design_continuation' as const,
                ...(lastTurn.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
                ...(lastTurn.guiDesignMode ? { guiDesignMode: true } : {})
              }
            : {}),
          ...(lastTurn?.disableUserInput ? { disableUserInput: true } : {})
        }
      }
      started = sourceTurnId
        ? await this.deps.turns.startTurn(startRequest, {
            expectedLatestFailedTurnId: sourceTurnId
          })
        : await this.deps.turns.startTurn(startRequest)
    } catch (error) {
      if (error instanceof TurnCapacityError) {
        this.resume.defer(threadId)
        return
      }
      throw error
    }
    this.restartSourceTurnByThread.delete(threadId)
    launchContinuationTurn({
      threadId, turnId: started.turnId,
      runTurn: this.deps.runTurn,
      finishTurn: (input) => this.deps.turns.finishTurn(input),
      events: this.deps.events,
      diagnostic: {
        kind: 'error', threadId, turnId: started.turnId,
        message: 'Auto-resuming the active goal after an interrupted turn.',
        code: 'goal_auto_resume', severity: 'warning'
      }
    })
  }

  private async transitionGoalStatus(
    threadId: string,
    turnId: string,
    status: ThreadGoal['status'],
    message?: string
  ): Promise<void> {
    const next = await this.mutateThread(threadId, async (current) => {
      const goal = current.goal
      if (!goal || goal.status === status) return null
      const now = this.deps.nowIso()
      const updated: ThreadGoal = { ...goal, status, updatedAt: now }
      await this.deps.threadStore.upsert(touchThread({ ...current, goal: updated }, now))
      return updated
    })
    if (!next) return
    await this.deps.events.record({ kind: 'goal_updated', threadId, goal: next })
    if (message) {
      await this.deps.events.record({
        kind: 'error',
        threadId,
        turnId,
        message,
        code: 'goal_auto_resume_exhausted',
        severity: 'warning'
      })
    }
  }

  private async mutateThread<T>(
    threadId: string,
    operation: (thread: ThreadRecord) => T | Promise<T>
  ): Promise<T | null> {
    return withThreadStoreMutation<T | null>(this.deps.threadStore, threadId, async () => {
      const current = await this.deps.threadStore.get(threadId)
      if (!current) return null
      return operation(current)
    })
  }
}

function goalResumeKey(threadId: string, goal: ThreadGoal): string {
  return `${threadId}::${goal.createdAt}::${goal.objective}`
}
