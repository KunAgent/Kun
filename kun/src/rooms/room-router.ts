import type { Room, SendRoomMessage } from '../contracts/rooms.js'

export type RoomRoute =
  | { kind: 'respond'; memberIds: string[]; taskId?: string }
  | { kind: 'clarify'; reason: string }

/** Resolves addressing only. A response route never grants execution permission. */
export function resolveRoomRecipients(input: {
  room: Room
  message: SendRoomMessage
  referencedTask?: { id: string; roomId: string; ownerMemberId: string; memberSnapshot?: { taskScopedMemory?: boolean } }
}): RoomRoute {
  const { room, message, referencedTask } = input
  if (room.archivedAt) return { kind: 'clarify', reason: 'room_archived' }
  const active = new Set(room.members.filter((member) => member.enabled && !member.removedAt)
    .map((member) => member.id))
  if (message.taskId && (!referencedTask || referencedTask.id !== message.taskId ||
    referencedTask.roomId !== room.id)) return { kind: 'clarify', reason: 'invalid_task_reference' }
  // Only structured composer targets are considered; quoted text and attachments
  // cannot inject recipients by containing an @ token.
  const targets = message.mentionMemberIds.length ? message.mentionMemberIds :
    [referencedTask ? !active.has(referencedTask.ownerMemberId) && referencedTask.memberSnapshot?.taskScopedMemory && message.executionIntent !== 'execute' ? room.defaultMemberId : referencedTask.ownerMemberId : room.defaultMemberId]
  if (targets.some((id) => !active.has(id))) return { kind: 'clarify', reason: 'member_unavailable' }
  return { kind: 'respond', memberIds: [...new Set(targets)],
    ...(message.taskId ? { taskId: message.taskId } : {}) }
}

export function resolveRoomRepository(input: {
  room: Room
  memberId: string
  explicitRepositoryId?: string
  taskRepositoryId?: string
}): { ok: true; repositoryId: string } | { ok: false; reason: string } {
  const member = input.room.members.find((row) => row.id === input.memberId && row.enabled && !row.removedAt)
  if (!member) return { ok: false, reason: 'member_unavailable' }
  const repositoryId = input.explicitRepositoryId ?? input.taskRepositoryId ?? member.defaultRepositoryId
  if (!repositoryId) return { ok: false, reason: 'repository_required' }
  if (!member.allowedRepositoryIds.includes(repositoryId)) return { ok: false, reason: 'repository_denied' }
  const repository = input.room.repositories.find((row) => row.id === repositoryId)
  if (!repository || repository.availability !== 'available') return { ok: false, reason: 'repository_unavailable' }
  return { ok: true, repositoryId }
}
