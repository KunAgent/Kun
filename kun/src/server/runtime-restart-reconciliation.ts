import type { ServerRuntime } from './routes/server-runtime.js'
import type { RestartRecoverySource } from '../loop/restart-recovery-source.js'

export type RestartReconciliationReport = {
  orphanedChildren: number
  orphanedThreadIds: string[]
  managerSettledThreadIds: string[]
  resumeCandidateIds: string[]
  resumedGoals: number
  resumedTurns: number
  recoveryParentIds: string[]
  retriedDetachedHandoffs: number
}

type RestartRuntime = Pick<
  ServerRuntime,
  'delegationRuntime' | 'resumeInterruptedGoals' | 'resumeInterruptedTurns' | 'threadStore' | 'turnService' | 'queuedTurnDispatcher'
>

/**
 * Settle child records before parent turns so restart recovery can distinguish
 * an ordinary interrupted task from a parent waiting on a resumable child.
 */
export async function reconcileRuntimeAfterRestart(
  runtime: RestartRuntime,
  options: { managerSettledAfter?: string } = {}
): Promise<RestartReconciliationReport> {
  let orphanedChildren = 0
  let childReconciliationFailed = false
  try {
    orphanedChildren = await runtime.delegationRuntime?.reconcileOrphanedChildRuns() ?? 0
    if (orphanedChildren > 0) {
      console.warn(`[kun] marked ${orphanedChildren} orphaned subagent run(s) as failed after restart`)
    }
  } catch (error) {
    childReconciliationFailed = true
    console.warn('[kun] orphaned child-run reconciliation failed:', error)
  }

  const orphanedSources = await runtime.turnService.reconcileOrphanedTurns()
  const orphanedThreadIds = orphanedSources.map((source) => source.threadId)
  if (orphanedThreadIds.length > 0) {
    console.warn(`[kun] marked orphaned turn(s) on ${orphanedThreadIds.length} thread(s) as failed after restart`)
  }
  const managerSettledSources = await runtime.turnService.reconcileManagerSettledInterruptions({
      settledAfter: options.managerSettledAfter
    })
  const managerSettledThreadIds = managerSettledSources.map((source) => source.threadId)
  if (managerSettledThreadIds.length > 0) {
    console.warn(
      `[kun] found ${managerSettledThreadIds.length} Manager-settled interruption(s) after restart`
    )
  }

  let recoveryCandidates: Awaited<ReturnType<NonNullable<RestartRuntime['delegationRuntime']>['proactiveRetryRecoveryCandidates']>> = []
  if (runtime.delegationRuntime) {
    try {
      recoveryCandidates = await runtime.delegationRuntime.proactiveRetryRecoveryCandidates()
    } catch (error) {
      childReconciliationFailed = true
      console.warn('[kun] proactive child-recovery lookup failed:', error)
    }
  }
  const sourceTurnIdsByThread = new Map<string, Set<string>>()
  const addSource = (source: RestartRecoverySource): void => {
    const turnIds = sourceTurnIdsByThread.get(source.threadId) ?? new Set<string>()
    turnIds.add(source.turnId)
    sourceTurnIdsByThread.set(source.threadId, turnIds)
  }
  for (const source of orphanedSources) addSource(source)
  for (const source of managerSettledSources) addSource(source)
  for (const candidate of recoveryCandidates) {
    addSource({ threadId: candidate.parentThreadId, turnId: candidate.parentTurnId })
  }
  const resumeCandidateSources: RestartRecoverySource[] = []
  const resumeCandidateThreads = new Map<string, Awaited<ReturnType<NonNullable<RestartRuntime['threadStore']>['get']>>>()
  if (!childReconciliationFailed && runtime.threadStore) {
    for (const [threadId, provenTurnIds] of sourceTurnIdsByThread) {
      const thread = await runtime.threadStore.get(threadId).catch(() => null)
      if (!thread || thread.relation === 'side') continue
      const latest = thread.turns.at(-1)
      if (!latest || latest.status !== 'failed' || !provenTurnIds.has(latest.id)) continue
      resumeCandidateSources.push({ threadId, turnId: latest.id })
      resumeCandidateThreads.set(threadId, thread)
    }
  }
  const resumeCandidateIds = resumeCandidateSources.map((source) => source.threadId)
  const selectedSourceByThread = new Map(
    resumeCandidateSources.map((source) => [source.threadId, source.turnId] as const)
  )
  const eligibleRecoveryCandidates = recoveryCandidates.filter((candidate) =>
    selectedSourceByThread.get(candidate.parentThreadId) === candidate.parentTurnId
  )
  const recoveryParentIds = [
    ...new Set(eligibleRecoveryCandidates.map((candidate) => candidate.parentThreadId))
  ]

  const recoveryParents = new Set(recoveryParentIds)
  const goalCandidateSources = resumeCandidateSources.filter((source) =>
    !recoveryParents.has(source.threadId) &&
    resumeCandidateThreads.get(source.threadId)?.goal?.status === 'active'
  )
  const ordinaryCandidateSources = resumeCandidateSources.filter((source) =>
    recoveryParents.has(source.threadId) ||
    resumeCandidateThreads.get(source.threadId)?.goal?.status !== 'active'
  )
  const resumedGoals = goalCandidateSources.length > 0 && runtime.resumeInterruptedGoals
    ? await runtime.resumeInterruptedGoals(goalCandidateSources)
    : 0
  if (resumedGoals > 0) {
    console.warn(`[kun] auto-resumed ${resumedGoals} interrupted goal(s) after restart`)
  }
  const resumedTurns = ordinaryCandidateSources.length > 0 && runtime.resumeInterruptedTurns
    ? await runtime.resumeInterruptedTurns(ordinaryCandidateSources, eligibleRecoveryCandidates)
    : 0
  if (resumedTurns > 0) {
    console.warn(`[kun] auto-resumed ${resumedTurns} interrupted turn(s) after restart`)
  }
  const retryDetachedHandoffs = runtime.delegationRuntime?.retryDetachedChildHandoffs
  const retriedDetachedHandoffs = typeof retryDetachedHandoffs === 'function'
    ? await retryDetachedHandoffs.call(runtime.delegationRuntime).catch((error) => {
        console.warn('[kun] detached child handoff replay failed:', error)
        return 0
      })
    : 0
  // Durable queued turns survive restart verbatim; no interrupted-turn
  // checkpointing applies to them. Drain every thread that still owns one.
  if (runtime.queuedTurnDispatcher) {
    const queuedThreads = await runtime.queuedTurnDispatcher
      .drainAllQueued()
      .catch((error) => {
        console.warn('[kun] queued-turn restart sweep failed:', error)
        return 0
      })
    if (queuedThreads > 0) {
      console.warn(`[kun] resumed queued turns on ${queuedThreads} thread(s) after restart`)
    }
  }
  return {
    orphanedChildren,
    orphanedThreadIds,
    managerSettledThreadIds,
    resumeCandidateIds,
    resumedGoals,
    resumedTurns,
    recoveryParentIds,
    retriedDetachedHandoffs
  }
}
