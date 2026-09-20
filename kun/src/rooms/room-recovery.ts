import { RoomRecoveryActionSchema, type RoomRecoveryInfo } from '../contracts/rooms-product.js'
import type { RoomRuntimeDeps, RoomTaskExecution } from './room-runtime-types.js'
import { RoomStoreConflictError } from './room-store.js'
import { roomFingerprint } from './room-service.js'
import { roomTaskActivity } from './room-task-activity.js'
import { roomTaskAction } from './room-task-actions.js'
import { assertNoActiveRoomIntegration } from './room-integration.js'

export async function inspectRoomRecovery(deps: RoomRuntimeDeps, roomId: string, taskId: string): Promise<RoomRecoveryInfo> {
  const row = await deps.store.get<RoomTaskExecution>('task', taskId)
  if (!row || row.roomId !== roomId) throw new Error('task not found')
  const activity = await roomTaskActivity(deps, row.value)
  const threadId = activity.threadId ?? (row.value.task.stage === 'review' ? row.value.reviewThreadId : row.value.task.executionThreadId)
  const turnId = activity.turnId ?? (row.value.task.stage === 'review' ? row.value.reviewTurnId : row.value.turnId)
  let stopped = activity.state === 'idle'
  if (deps.proveStopped && threadId && activity.state !== 'active') {
    try { stopped = await deps.proveStopped(threadId, turnId) } catch { stopped = false }
  }
  if (activity.state === 'unknown' && !deps.proveStopped) stopped = false
  const state = stopped ? 'stopped' : activity.state === 'active' ? 'active' : 'unknown'
  const blockedApply = row.value.task.applicationStatus === 'applying'
  return { taskId, state, threadId, turnId,
    canRetry: stopped && !blockedApply && ['failed', 'cancelled', 'needs_input', 'recovery_required'].includes(row.value.task.status),
    canAbandon: stopped && !blockedApply && row.value.task.applicationStatus !== 'applied',
    reason: stopped ? '已核对原执行终态；可选择当前任务允许的恢复操作。' :
      state === 'active' ? '原执行仍有效，可重新关联观察或取消。' :
        '尚不能证明原执行已停止。请在持有该执行的客户端停止任务或重启其 Runtime，然后重新核对。',
    observedAt: new Date().toISOString() }
}

type PreparedRecovery = {
  proof: RoomRecoveryInfo
  action: 'reconcile' | 'retry' | 'abandon'
  state: 'prepared' | 'completed'
  continuation?: { action: 'retry' | 'retry-review'; clientRequestId: string; expectedRevision: number }
}

export async function recoverRoomTask(deps: RoomRuntimeDeps, roomId: string, taskId: string, input: unknown) {
  const body = RoomRecoveryActionSchema.parse(input)
  await deps.assertOwnership()
  const key = 'recover-' + roomFingerprint({ roomId, taskId, clientRequestId: body.clientRequestId })
  const fingerprint = roomFingerprint(body)
  const complete = await deps.store.getRequest(key)
  if (complete) {
    if (complete.fingerprint !== fingerprint) throw new RoomStoreConflictError('recovery request identity conflict')
    return complete.result
  }
  const receipt = await deps.store.getRequest(key + '-prepare')
  if (receipt && receipt.fingerprint !== fingerprint) throw new RoomStoreConflictError('recovery request identity conflict')
  let prepared = receipt?.result as PreparedRecovery | undefined
  if (!prepared) {
    const row = await deps.store.get<RoomTaskExecution>('task', taskId)
    if (!row || row.roomId !== roomId) throw new Error('task not found')
    if (row.revision !== body.expectedRevision) throw new RoomStoreConflictError('task changed', row.revision)
    await assertNoActiveRoomIntegration(deps, roomId, taskId)
    if (row.value.task.applicationStatus === 'applying') throw new RoomStoreConflictError('resolve the pending application first')
    const proof = await inspectRoomRecovery(deps, roomId, taskId)
    if (body.action === 'retry' && !proof.canRetry || body.action === 'abandon' && !proof.canAbandon) {
      throw new RoomStoreConflictError(proof.reason)
    }
    const execution = structuredClone(row.value)
    if (proof.state === 'active' && execution.task.status === 'recovery_required') {
      if (execution.task.stage === 'review') execution.reviewTurnId = proof.turnId
      else execution.turnId = proof.turnId
      execution.task.status = 'running'
    } else if (body.action === 'abandon') {
      execution.abandoned = true
      execution.task.status = 'cancelled'
    } else if (proof.state === 'stopped' && ['recovery_required', 'stopping'].includes(execution.task.status)) {
      execution.task.status = 'failed'
    }
    execution.recoveryResolved = proof.state === 'stopped'
    execution.task.latestProgress = proof.reason
    execution.task.revision = row.revision + 1
    execution.task.updatedAt = new Date().toISOString()
    prepared = { proof, action: body.action, state: 'prepared',
      ...(body.action === 'retry' ? { continuation: {
        action: execution.task.stage === 'review' ? 'retry-review' as const : 'retry' as const,
        clientRequestId: key.slice(0, 100) + '-resume', expectedRevision: row.revision + 1
      } } : {}) }
    await deps.store.commit({ requestId: key + '-prepare', fingerprint,
      checks: [{ kind: 'task', id: taskId, expectedRevision: row.revision }, { kind: 'recovery', id: key, expectedRevision: null }],
      puts: [{ kind: 'task', id: taskId, roomId, taskId, value: execution },
        { kind: 'recovery', id: key, roomId, taskId, value: prepared }],
      events: [{ roomId, kind: 'task.recovered', payload: { id: taskId } }], result: prepared })
  }
  if (prepared.continuation) {
    const { action, ...payload } = prepared.continuation
    const continuationKey = 'action:' + roomFingerprint({ roomId, id: taskId, clientRequestId: payload.clientRequestId })
    // A prepared proof can go stale before dispatch. Once admission is durable,
    // replay that admission even if its replacement execution has already started.
    if (!await deps.store.getRequest(continuationKey)) {
      const proof = await inspectRoomRecovery(deps, roomId, taskId)
      if (proof.state !== 'stopped') throw new RoomStoreConflictError(proof.reason)
    }
    await roomTaskAction(deps, roomId, taskId, action, payload)
  }
  const record = await deps.store.get<PreparedRecovery>('recovery', key)
  if (!record) throw new RoomStoreConflictError('recovery evidence is missing')
  const result = await deps.store.commit({ requestId: key, fingerprint,
    checks: [{ kind: 'recovery', id: key, expectedRevision: record.revision }],
    puts: [{ kind: 'recovery', id: key, roomId, taskId, value: { ...prepared, state: 'completed' } }],
    result: prepared.proof })
  return result.result
}
