import type { RoomDelivery } from '../contracts/room-deliveries.js'
import { RoomTaskActionSchema } from '../contracts/rooms-api.js'
import { applyRoomDelivery } from './room-delivery-service.js'
import { observeRoomRepository, type RoomRepositoryObservation } from './task-workspace-service.js'
import type { RoomRuntimeDeps, RoomTaskExecution, RoomWorkspace } from './room-runtime-types.js'
import { RoomStoreConflictError, type RoomStoredDocument } from './room-store.js'
import { roomFingerprint } from './room-service.js'

type ApplyAttempt = {
  expected: RoomRepositoryObservation
  deliveryId: string
  versionHash: string
  fingerprint: string
  reservedRevision: number
  status: 'applying' | 'applied' | 'conflict' | 'recovery_required'
}
export type RoomActionResult = { task: RoomTaskExecution['task']; error?: string }

/** Persist the exact Git target and delivery before crossing the merge boundary. */
export async function applyRoomTask(input: {
  deps: RoomRuntimeDeps
  row: RoomStoredDocument<RoomTaskExecution>
  body: ReturnType<typeof RoomTaskActionSchema.parse>
  requestId: string
  fingerprint: string
}): Promise<RoomActionResult> {
  const { deps, body, requestId, fingerprint } = input
  let row = input.row
  const execution = structuredClone(row.value)
  const { task } = execution
  if (!['completed', 'awaiting_acceptance'].includes(task.status) || !task.latestDeliveryId) {
    throw new RoomStoreConflictError('delivery is not ready for application')
  }
  const operationId = 'apply-' + roomFingerprint({ taskId: task.id, clientRequestId: body.clientRequestId })
  let operation = await deps.store.get<ApplyAttempt>('attempt', operationId)
  if (operation && (operation.taskId !== task.id || operation.roomId !== task.roomId ||
    operation.value.fingerprint !== fingerprint)) throw new RoomStoreConflictError('application request identity conflict')
  const resumingOwnAttempt = operation?.value.status === 'applying' && row.revision === operation.value.reservedRevision
  if (row.revision !== body.expectedRevision && !resumingOwnAttempt) {
    throw new RoomStoreConflictError('task changed; reload before retrying', row.revision)
  }
  if (!operation) {
    // A new click after restart resolves the existing uncertain operation; it
    // cannot silently retarget the request to a newly created delivery.
    const pending = await deps.store.list<ApplyAttempt>('attempt', {
      roomId: task.roomId, taskId: task.id, status: 'applying', limit: 2
    })
    if (pending.length > 1) throw new RoomStoreConflictError('multiple unresolved applications require recovery')
    operation = pending[0] ?? null
  }
  const deliveryId = operation?.value.deliveryId ?? task.latestDeliveryId
  const delivery = (await deps.store.get<RoomDelivery>('delivery', deliveryId))?.value
  const workspace = (await deps.store.get<RoomWorkspace>('workspace', task.workspaceId))?.value
  if (!delivery || !workspace || delivery.taskId !== task.id || workspace.taskId !== task.id ||
    workspace.roomId !== task.roomId) throw new RoomStoreConflictError('delivery or workspace ownership mismatch')
  if (task.latestDeliveryId !== deliveryId || (operation && operation.value.versionHash !== delivery.versionHash)) {
    throw new RoomStoreConflictError('unresolved application is bound to a different delivery; preserve for recovery')
  }

  let error: string | undefined
  try {
    if (!operation) {
      const expected = await observeRoomRepository(workspace.repository.root)
      const attempt: ApplyAttempt = { expected, deliveryId, versionHash: delivery.versionHash,
        fingerprint, reservedRevision: row.revision + 1, status: 'applying' }
      task.applicationStatus = 'applying'
      task.revision = row.revision + 1
      task.updatedAt = new Date().toISOString()
      await deps.store.commit({ requestId: 'reserve-' + operationId,
        checks: [{ kind: 'task', id: task.id, expectedRevision: row.revision },
          { kind: 'attempt', id: operationId, expectedRevision: null }],
        puts: [{ kind: 'task', id: task.id, roomId: task.roomId, taskId: task.id, value: execution },
          { kind: 'attempt', id: operationId, roomId: task.roomId, taskId: task.id, value: attempt }],
        events: [{ roomId: task.roomId, kind: 'task.updated', payload: { id: task.id } }] })
      row = (await deps.store.get<RoomTaskExecution>('task', task.id))!
      operation = (await deps.store.get<ApplyAttempt>('attempt', operationId))!
    }
    await applyRoomDelivery({ delivery, repository: workspace.repository,
      expectedTarget: operation.value.expected, assertOwnership: deps.assertOwnership })
    task.applicationStatus = 'applied'
    task.latestProgress = 'Delivery applied to its recorded target branch.'
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
    task.applicationStatus = /uncommitted changes|target changed|unfinished Git operation|not a fast-forward descendant/.test(error)
      ? 'conflict' : 'recovery_required'
    task.latestProgress = error.slice(0, 2000)
  }
  task.revision = row.revision + 1
  task.updatedAt = new Date().toISOString()
  const result: RoomActionResult = { task, ...(error ? { error } : {}) }
  await deps.assertOwnership()
  const saved = await deps.store.commit({ requestId, fingerprint,
    checks: [{ kind: 'task', id: task.id, expectedRevision: row.revision },
      ...(operation ? [{ kind: 'attempt' as const, id: operation.id, expectedRevision: operation.revision }] : [])],
    puts: [{ kind: 'task', id: task.id, roomId: task.roomId, taskId: task.id, value: execution },
      ...(operation ? [{ kind: 'attempt' as const, id: operation.id, roomId: task.roomId, taskId: task.id,
        value: { ...operation.value, status: task.applicationStatus } }] : [])],
    events: [{ roomId: task.roomId, kind: 'task.updated', payload: { id: task.id } }], result })
  const persisted = saved.result as RoomActionResult
  if (persisted.error) throw new RoomStoreConflictError(persisted.error, persisted.task.revision)
  return persisted
}
