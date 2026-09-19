import { RoomSchema, type Room, type RoomMember, type SendRoomMessage } from '../contracts/rooms.js'
import type { AgentIdentityService } from './agent-identity-service.js'
import { RoomStoreConflictError } from '../rooms/room-store.js'
import type { RoomRequestState, RoomRuntimeDeps, RoomTaskExecution } from '../rooms/room-runtime-types.js'

/** Task-only participants never become readers or discussion members of the source private chat. */
export async function prepareAgentTaskParticipants(directory: AgentIdentityService, room: Room, message: SendRoomMessage): Promise<RoomMember[]> {
  const ids = [...new Set([...(message.designatedAgentIds ?? []), ...(message.executionAgentId ? [message.executionAgentId] : [])])]
  const requester = room.members.find((member) => member.id === room.defaultMemberId)!
  const participants: RoomMember[] = []
  if (message.taskId) {
    const task = await directory.store.get<RoomTaskExecution>('task', message.taskId)
    if (!task || task.roomId !== room.id) throw new RoomStoreConflictError('task is outside this conversation')
    if (message.executionAgentId && message.executionAgentId !== task.value.task.memberSnapshot.participantAgentId) {
      throw new RoomStoreConflictError('existing task ownership is fixed; create a new task or use the review action')
    }
    for (const member of [task.value.task.memberSnapshot, task.value.reviewer]) {
      if (member && !room.members.some((entry) => entry.id === member.id)) participants.push(member)
    }
  }
  for (const id of ids) {
    if ([...room.members, ...participants].some((member) => member.participantAgentId === id)) continue
    const agent = await directory.active(id)
    const repositories = room.repositories.filter((repo) => requester.allowedRepositoryIds.includes(repo.id) &&
      (!agent.allowedRepositoryRoots || agent.allowedRepositoryRoots.includes(repo.canonicalRoot)))
    const member = directory.asMember(agent, repositories.map((repo) => repo.id))
    const snapshot = await directory.freeze(RoomSchema.parse({ ...room, repositories,
      members: [member], defaultMemberId: member.id, participantAgentIds: [agent.id] }))
    participants.push({ ...snapshot.members[0], taskScopedMemory: true })
  }
  return participants
}
export function taskParticipantRoom(request: RoomRequestState): Room {
  return { ...request.roomSnapshot, members: [...request.roomSnapshot.members, ...(request.taskParticipants ?? [])] }
}
export async function resolveAgentTaskReviewer(deps: RoomRuntimeDeps, request: RoomRequestState,
  owner: RoomMember, reviewerId: string | undefined, repositoryId: string): Promise<RoomMember | undefined> {
  if (!reviewerId) return undefined
  const room = taskParticipantRoom(request)
  const existing = room.members.find((member) => (member.id === reviewerId || member.participantAgentId === reviewerId) &&
    member.enabled && !member.removedAt && member.allowedRepositoryIds.includes(repositoryId))
  if (existing) {
    if (existing.id === owner.id || existing.participantAgentId && existing.participantAgentId === owner.participantAgentId) {
      throw new RoomStoreConflictError('an agent cannot review its own work')
    }
    return existing
  }
  if (!deps.agentDirectory || owner.configuredReviewerAgentId !== reviewerId) throw new RoomStoreConflictError('reviewer unavailable or unauthorized')
  const agent = await deps.agentDirectory.active(reviewerId)
  if (agent.id === owner.participantAgentId) throw new RoomStoreConflictError('an agent cannot review its own work')
  const repository = room.repositories.find((repo) => repo.id === repositoryId)
  if (!repository || agent.allowedRepositoryRoots && !agent.allowedRepositoryRoots.includes(repository.canonicalRoot)) {
    throw new RoomStoreConflictError('reviewer repository is unauthorized')
  }
  const member = deps.agentDirectory.asMember(agent, [repositoryId])
  const frozen = await deps.agentDirectory.freeze(RoomSchema.parse({ ...room, members: [member],
    repositories: [repository], defaultMemberId: member.id, participantAgentIds: [agent.id] }))
  return { ...frozen.members[0], taskScopedMemory: true }
}
