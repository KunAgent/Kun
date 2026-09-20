import { RoomTaskActionSchema } from '../contracts/rooms-api.js'
import type { RoomRuntimeDeps, RoomTaskExecution } from './room-runtime-types.js'
import { RoomStoreConflictError } from './room-store.js'
import { roomFingerprint } from './room-service.js'
import { applyRoomTask, type RoomActionResult } from './room-task-application.js'
import { withLatestRoomReview } from './room-feedback.js'
import { assertNoActiveRoomIntegration } from './room-integration.js'
import { stopRoomTaskTurn } from './room-task-activity.js'

export async function roomTaskAction(deps: RoomRuntimeDeps, roomId: string, id: string, action: string, input: unknown) {
  const body = RoomTaskActionSchema.parse(input)
  const requestId = 'action:' + roomFingerprint({ roomId, id, clientRequestId: body.clientRequestId })
  const fingerprint = roomFingerprint({ roomId, action, body })
  const replay = await deps.store.getRequest(requestId)
  if (replay) {
    if (replay.fingerprint !== fingerprint) throw new RoomStoreConflictError('action request identity conflict')
    const result = replay.result as RoomActionResult
    if (result.error) throw new RoomStoreConflictError(result.error, result.task.revision)
    if (action === 'cancel') await retryCancellation(deps, roomId, id)
    return replay.result
  }
  await deps.assertOwnership()
  const row = await deps.store.get<RoomTaskExecution>('task', id)
  if (!row || row.roomId !== roomId) throw new Error('task not found')
  if (action === 'apply') {
    await assertNoActiveRoomIntegration(deps, roomId, id)
    return applyRoomTask({ deps, row, body, requestId, fingerprint })
  }
  if (row.revision !== body.expectedRevision) throw new RoomStoreConflictError('task changed; reload before retrying', row.revision)
  const execution = structuredClone(row.value)
  const { task } = execution
  if (action !== 'cancel') {
    await assertNoActiveRoomIntegration(deps, roomId, id)
  }
  if (task.applicationStatus === 'applying') {
    throw new RoomStoreConflictError('resolve the pending application before changing this task')
  }
  const targetThreadId = task.stage === 'review' ? execution.reviewThreadId : task.executionThreadId
  let targetTurnId = task.stage === 'review' ? execution.reviewTurnId : execution.turnId
  if (action === 'cancel') {
    const thread = targetThreadId ? await deps.threads.getMetadata(targetThreadId) : null
    if (!targetTurnId) targetTurnId = thread?.turns.find((turn) => turn.status === 'queued' || turn.status === 'running')?.id
    if (targetThreadId && targetTurnId) {
      const turn = thread?.turns.find((candidate) => candidate.id === targetTurnId)
      if (turn?.status === 'queued' || turn?.status === 'running' || deps.backgroundExecutionActive?.(targetThreadId)) {
        // Persist stopping before crossing the cancellation boundary.
        task.status = 'stopping'
        if (task.stage === 'review') execution.reviewTurnId = targetTurnId
        else execution.turnId = targetTurnId
      } else if (!turn) {
        task.status = 'recovery_required'
        task.latestProgress = 'Execution identity is missing; cancellation cannot be confirmed.'
      } else {
        task.status = 'cancelled'
      }
    } else task.status = 'cancelled'
  } else if (action === 'retry') {
    if (!['failed', 'cancelled', 'recovery_required', 'needs_input'].includes(task.status)) {
      throw new RoomStoreConflictError('task cannot retry in its current state')
    }
    const threadIds = [...new Set([task.executionThreadId, execution.reviewThreadId].filter((value): value is string => Boolean(value)))]
    const threads = await Promise.all(threadIds.map((threadId) => deps.threads.getMetadata(threadId)))
    if (threads.some((thread) => thread?.turns.some((turn) => turn.status === 'queued' || turn.status === 'running'))) {
      throw new RoomStoreConflictError('resolve or cancel the existing execution before retrying')
    }
    if (!execution.recoveryResolved && targetTurnId && !threads.some((thread) => thread?.turns.some((turn) => turn.id === targetTurnId))) {
      throw new RoomStoreConflictError('execution identity is missing; confirm recovery before retrying')
    }
    execution.attempt += 1
    if (execution.recoveryResolved && !threads.some((thread) => thread?.id === task.executionThreadId)) {
      execution.previousExecutionThreadIds = [...(execution.previousExecutionThreadIds ?? []), task.executionThreadId]
      task.executionThreadId = 'room-recovered-' + roomFingerprint({ roomId, id, requestId }).slice(0, 48)
      execution.prompt += '\nRecovery: inspect the retained worktree and prior delivery evidence before continuing. Do not assume earlier side effects need repeating.'
    }
    execution.recoveryResolved = false
    execution.abandoned = false
    execution.turnId = undefined
    execution.reviewThreadId = undefined
    execution.reviewTurnId = undefined
    execution.prompt = await withLatestRoomReview(deps, execution) + (body.body ? '\nUser continuation:\n' + body.body : '')
    task.status = execution.dependencyTaskIds.length && !execution.dependencyDeliveries ? 'waiting_dependency' : 'queued'
    task.stage = task.latestDeliveryId ? 'fix' : 'develop'
    task.latestDeliveryId = undefined
    task.acceptedDeliveryId = undefined
    task.applicationStatus = 'not_applied'
    task.verificationStatus = 'not_run'
  } else if (action === 'accept') {
    if (task.status !== 'awaiting_acceptance' || !task.latestDeliveryId) throw new RoomStoreConflictError('no current delivery ready for acceptance')
    task.status = 'completed'
    task.acceptedDeliveryId = task.latestDeliveryId
  } else if (action === 'review' || action === 'retry-review') {
    if (!task.latestDeliveryId || !execution.reviewer || !['awaiting_acceptance', 'completed', 'needs_input', 'recovery_required', 'failed'].includes(task.status)) {
      throw new RoomStoreConflictError('select a reviewer through the task reply before requesting review')
    }
    task.stage = 'review'
    task.status = 'running'
    execution.reviewThreadId = 'room-review-' + id + '-' + execution.attempt + '-' + roomFingerprint(body.clientRequestId).slice(0, 12)
    execution.reviewTurnId = undefined
    execution.reviewRepairs = 0
  } else throw new Error('unknown task action')
  task.revision = row.revision + 1
  task.updatedAt = new Date().toISOString()
  const result = { task }
  const saved = await deps.store.commit({ requestId, fingerprint,
    checks: [{ kind: 'task', id, expectedRevision: row.revision }],
    puts: [{ kind: 'task', id, roomId, taskId: id, value: execution }],
    events: [{ roomId, kind: 'task.updated', payload: { id } }], result })
  if (task.status === 'stopping') await retryCancellation(deps, roomId, id)
  return saved.result
}

async function retryCancellation(deps: RoomRuntimeDeps, roomId: string, id: string): Promise<void> {
  const row = await deps.store.get<RoomTaskExecution>('task', id)
  if (!row || row.roomId !== roomId || row.value.task.status !== 'stopping') return
  await deps.assertOwnership()
  const execution = row.value
  const threadId = execution.task.stage === 'review' ? execution.reviewThreadId : execution.task.executionThreadId
  const turnId = execution.task.stage === 'review' ? execution.reviewTurnId : execution.turnId
  if (!threadId || !turnId) return
  await stopRoomTaskTurn(deps, threadId, turnId)
}
