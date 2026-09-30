import type { Room } from '../contracts/rooms.js'
import { kunToolPermissionModeSettings } from '../contracts/policy.js'
import type { AgentIdentityService } from './agent-identity-service.js'
import { RoomStoreConflictError } from '../rooms/room-store.js'

/** Apply only when accepting a new request/attempt, never mutate an admitted turn. */
export async function freezeAgentPermissions(directory: AgentIdentityService, room: Room) {
  const member = room.members.find((item) => item.id === room.defaultMemberId)!
  const agent = await directory.active(member.participantAgentId!)
  if (room.privateWorkspace && agent.allowedRepositoryRoots && !agent.allowedRepositoryRoots.includes(room.privateWorkspace)) {
    throw new RoomStoreConflictError('Project is outside this Agent\'s allowed directories')
  }
  room.privateExecutionPolicy ??= defaultAgentExecutionPolicy()
  if (room.privateExecutionPolicy.sandboxMode === 'danger-full-access' &&
    (member.presetSnapshot?.toolPolicy === 'readOnly' || agent.allowedRepositoryRoots !== undefined)) {
    throw new RoomStoreConflictError('Agent limits changed. Choose a restricted permission mode before sending.')
  }
  return room
}

/** Missing legacy policy is absence of consent, never a full-access grant. */
export function defaultAgentExecutionPolicy() {
  return kunToolPermissionModeSettings('ask-for-approval')
}
