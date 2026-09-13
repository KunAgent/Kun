import { observeRecordedRoomTurn } from './room-run-recording.js'
import type { RoomRuntimeDeps, RoomTaskExecution } from './room-runtime-types.js'

export type RoomTaskActivity = {
  state: 'active' | 'idle' | 'unknown'
  threadId?: string
  turnId?: string
  status?: 'queued' | 'running'
}

/** Durable task state alone cannot prove that a lost admission or observation stopped executing. */
export async function roomTaskActivity(deps: RoomRuntimeDeps, execution: RoomTaskExecution): Promise<RoomTaskActivity> {
  const reviewing = execution.task.stage === 'review'
  const threadId = reviewing ? execution.reviewThreadId : execution.task.executionThreadId
  const turnId = reviewing ? execution.reviewTurnId : execution.turnId
  if (!threadId) return { state: turnId ? 'unknown' : 'idle' }
  if (deps.backgroundExecutionActive?.(threadId)) return { state: 'active', threadId, turnId, status: 'running' }
  if (reviewing && execution.completedReviewRunId &&
    execution.completedReviewRunId === execution.reviewThreadId) return { state: 'idle', threadId, turnId }
  const identity = { threadId, turnId }
  let thread
  try { thread = await deps.threads.getMetadata(threadId) } catch { return { state: 'unknown', ...identity } }
  if (!thread) return { state: turnId ? 'unknown' : 'idle', ...identity }
  const requestIds = reviewing ? ['review-' + execution.reviewThreadId, 'review-' + execution.task.latestDeliveryId] :
    [execution.task.id + '-attempt-' + execution.attempt]
  const turn = turnId ? thread.turns.find((candidate) => candidate.id === turnId) :
    thread.turns.find((candidate) => candidate.clientRequestId && requestIds.includes(candidate.clientRequestId))
  if (turn?.status === 'running' || turn?.status === 'queued') {
    return { state: 'active', threadId, turnId: turn.id, status: turn.status }
  }
  if ((turnId && !turn) || thread.turns.some((candidate) => ['running', 'queued'].includes(candidate.status))) {
    return { state: 'unknown', ...identity }
  }
  return { state: 'idle', ...identity }
}

/** Queue promotion and settlement may race either cancellation boundary. */
export async function stopRoomTaskTurn(deps: RoomRuntimeDeps, threadId: string, turnId: string): Promise<void> {
  await deps.stopBackgroundExecution?.(threadId)
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const thread = await deps.threads.getMetadata(threadId)
    const turn = thread?.turns.find((candidate) => candidate.id === turnId)
    if (!turn) throw new Error('execution identity is missing; cancellation cannot be confirmed')
    if (turn.status !== 'queued' && turn.status !== 'running') {
      await observeRecordedRoomTurn(deps, thread!, turn)
      return
    }
    try {
      if (turn.status === 'queued') await deps.turns.cancelQueuedTurn({ threadId, turnId })
      else await deps.turns.interruptTurn({ threadId, turnId })
      const settled = await deps.threads.getMetadata(threadId)
      const result = settled?.turns.find((value) => value.id === turnId)
      if (result) await observeRecordedRoomTurn(deps, settled!, result)
      return
    } catch (error) { lastError = error }
  }
  throw lastError
}
