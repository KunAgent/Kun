import type { RoomDelivery } from '../contracts/room-deliveries.js'
import type { RoomRuntimeDeps, RoomTaskExecution, RoomWorkspace } from './room-runtime-types.js'
import { materializeRoomDependency } from './room-delivery-service.js'

/** Freeze the precise versions handed off; later repairs cannot silently retarget a dependent task. */
export async function resolveRoomDependencies(deps: RoomRuntimeDeps, execution: RoomTaskExecution) {
  const snapshots: NonNullable<RoomTaskExecution['dependencyDeliveries']> = []
  for (const id of execution.dependencyTaskIds) {
    const dependency = await deps.store.get<RoomTaskExecution>('task', id)
    if (!dependency || dependency.roomId !== execution.task.roomId || id === execution.task.id) {
      throw new Error('dependency task is missing or outside this room')
    }
    if (['failed', 'cancelled', 'recovery_required'].includes(dependency.value.task.status)) {
      throw new Error('dependency requires recovery before this task can start: ' + dependency.value.task.title)
    }
    if (!['awaiting_acceptance', 'completed'].includes(dependency.value.task.status)) return null
    const deliveryId = dependency.value.task.latestDeliveryId
    const delivery = deliveryId ? await deps.store.get<RoomDelivery>('delivery', deliveryId) : null
    if (!delivery || delivery.roomId !== execution.task.roomId || delivery.value.taskId !== id) {
      throw new Error('dependency has no verified delivery identity')
    }
    snapshots.push({ taskId: id, deliveryId: delivery.value.id,
      versionHash: delivery.value.versionHash, summary: delivery.value.summary.slice(0, 2000) })
  }
  return snapshots
}

export async function materializeRoomDependencies(
  deps: RoomRuntimeDeps, execution: RoomTaskExecution, workspace: RoomWorkspace
): Promise<void> {
  if (execution.dependencyTaskIds.length && !execution.dependencyDeliveries) {
    throw new Error('dependency versions were not frozen before dispatch')
  }
  for (const snapshot of execution.dependencyDeliveries ?? []) {
    const dependency = await deps.store.get<RoomTaskExecution>('task', snapshot.taskId)
    const delivery = await deps.store.get<RoomDelivery>('delivery', snapshot.deliveryId)
    if (!dependency || !delivery || dependency.roomId !== execution.task.roomId ||
      delivery.roomId !== execution.task.roomId || delivery.value.taskId !== snapshot.taskId ||
      delivery.value.versionHash !== snapshot.versionHash) throw new Error('dependency handoff identity changed')
    const source = await deps.store.get<RoomWorkspace>('workspace', dependency.value.task.workspaceId)
    if (!source || source.roomId !== execution.task.roomId || source.value.taskId !== snapshot.taskId) {
      throw new Error('dependency workspace is missing or belongs to another task')
    }
    if (source.value.repository.commonDir !== workspace.repository.commonDir) continue
    await materializeRoomDependency({ taskId: execution.task.id, workspacePath: workspace.path,
      workspaceBranch: workspace.branch, repository: workspace.repository, baseRevision: workspace.baseRevision,
      delivery: delivery.value, assertOwnership: deps.assertOwnership })
  }
}
