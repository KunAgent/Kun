import { kunToolPermissionModeSettings, kunToolPermissionModeFromSettings } from '../contracts/policy.js'
import type { RoomPermissionRequest } from '../contracts/room-permissions.js'
import type { RoomRuntime } from '../rooms/room-runtime.js'
import { RoomStoreConflictError } from '../rooms/room-store.js'
import { roomFingerprint } from '../rooms/room-service.js'

export async function agentPermissions(rooms: RoomRuntime, roomId: string) {
  const room = await rooms.service.get(roomId)
  if (room.conversationKind !== 'user_agent') throw new Error('Private conversation required')
  const agent = await rooms.agents.get(room.members[0].participantAgentId!)
  const profile = rooms.deps.profiles()[agent.presetId]
  const fullAccessUnavailable = profile?.toolPolicy === 'readOnly' ? 'read_only_agent' : agent.allowedRepositoryRoots !== undefined ? 'agent_directory_limits' : undefined
  const policy = room.privateExecutionPolicy ?? kunToolPermissionModeSettings('ask-for-approval')
  return { roomId, revision: room.revision, policy, mode: kunToolPermissionModeFromSettings(policy), fullAccessUnavailable }
}
export async function setAgentPermissions(rooms: RoomRuntime, roomId: string, input: RoomPermissionRequest) {
  const key = 'room-permission:' + roomId + ':' + input.clientRequestId, fingerprint = roomFingerprint(input)
  const prior = await rooms.deps.store.getRequest(key)
  if (prior) {
    if (prior.fingerprint !== fingerprint) throw new RoomStoreConflictError('permission request changed')
    return agentPermissions(rooms, roomId)
  }
  const current = await agentPermissions(rooms, roomId)
  if (input.mode === 'full-access' && current.fullAccessUnavailable) throw new RoomStoreConflictError(current.fullAccessUnavailable)
  const room = await rooms.service.get(roomId), policy = kunToolPermissionModeSettings(input.mode)
  await rooms.deps.store.commit({ requestId: key, fingerprint,
    checks: [{ kind: 'room', id: roomId, expectedRevision: input.expectedRevision }],
    puts: [{ kind: 'room', id: roomId, roomId, value: { ...room, privateExecutionPolicy: policy, revision: room.revision + 1, updatedAt: new Date().toISOString() } }],
    events: [{ roomId, kind: 'room.updated', payload: { id: roomId } }] })
  return agentPermissions(rooms, roomId)
}
