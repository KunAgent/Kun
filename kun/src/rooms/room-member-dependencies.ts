import type { Room } from '../contracts/rooms.js'
import type { RoomIntegration } from '../contracts/rooms-product.js'
import type { RoomRequestState, RoomTaskExecution } from './room-runtime-types.js'
import { RoomStoreConflictError, type RoomDocumentKind, type RoomStore, type RoomStoreListOptions } from './room-store.js'

async function* pages<T>(store: RoomStore, kind: RoomDocumentKind, options: RoomStoreListOptions) {
  let afterSeq: number | undefined
  for (;;) {
    const rows = await store.list<T>(kind, { ...options, order: 'asc', limit: 1000, afterSeq })
    yield* rows
    if (rows.length < 1000) return
    afterSeq = rows.at(-1)!.seq
  }
}

/** Call inside the same Runtime action lane as admission and task dispatch. */
export async function assertRoomMemberRemovalAllowed(store: RoomStore, previous: Room, next: Room): Promise<void> {
  const retained = new Set(next.members.filter((member) => !member.removedAt).map((member) => member.id))
  const removed = new Set(previous.members.filter((member) => !member.removedAt && !retained.has(member.id)).map((member) => member.id))
  if (!removed.size) return
  const requireMembers = (ids: Array<string | undefined>, source: string) => {
    const dependency = ids.find((id) => id && removed.has(id))
    if (dependency) throw new RoomStoreConflictError(`disable member ${dependency} until the existing ${source} finishes`)
  }
  const taskMembers = (execution: RoomTaskExecution) => [execution.task.ownerMemberId,
    execution.task.memberSnapshot?.id, execution.reviewer?.id,
    execution.task.memberSnapshot?.reviewPolicy?.reviewerMemberId]
  for await (const row of pages<RoomTaskExecution>(store, 'task', { roomId: previous.id,
    status: ['queued', 'waiting_dependency', 'running', 'needs_input', 'needs_approval',
      'recovery_required', 'stopping', 'awaiting_acceptance'] })) requireMembers(taskMembers(row.value), 'task')
  for await (const row of pages<RoomRequestState>(store, 'request', { roomId: previous.id, status: ['pending', 'running'] })) {
    // Accepted requests retain their roster and may still invite or assign any enabled member.
    const members = row.value.roomSnapshot?.members ?? previous.members
    requireMembers([...members.filter((member) => member.enabled && !member.removedAt).map((member) => member.id),
      row.value.roomSnapshot?.defaultMemberId, ...(row.value.discussions ?? []).map((item) => item.memberId),
      ...(row.value.message?.mentionMemberIds ?? []), row.value.referencedTask?.task.ownerMemberId], 'request')
  }
  const inspectTask = async (taskId: string | undefined, source: string) => {
    const task = taskId ? await store.get<RoomTaskExecution>('task', taskId) : null
    if (!task || task.roomId !== previous.id) throw new RoomStoreConflictError(`member dependencies for the existing ${source} cannot be verified`)
    requireMembers(taskMembers(task.value), source)
  }
  for await (const row of pages<RoomIntegration>(store, 'integration', { roomId: previous.id,
    status: ['preparing', 'conflict', 'validating', 'ready', 'recovery_required'] })) {
    await inspectTask(row.taskId ?? row.value.taskId, 'integration')
  }
  for await (const row of pages(store, 'attempt', { roomId: previous.id, status: ['applying', 'recovery_required'] })) {
    await inspectTask(row.taskId, 'application')
  }
}
