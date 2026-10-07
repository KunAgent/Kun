import type { z } from 'zod'
import type { AgentModelRef } from '../contracts/agent-identities.js'
import type { RoomRuntime } from '../rooms/room-runtime.js'
import { RoomSchema } from '../contracts/rooms.js'
import { RoomStoreConflictError } from '../rooms/room-store.js'
import { roomFingerprint } from '../rooms/room-service.js'
import { assertExplicitAgentModel } from './agent-models.js'

/** Change only future messages in this conversation; accepted requests keep their snapshots. */
export async function updateDirectModel(rooms: RoomRuntime, roomId: string, input: {
  clientRequestId: string; expectedRevision: number; modelRef: z.infer<typeof AgentModelRef>
}) {
  const store = rooms.deps.store
  const key = `private-model:${roomId}:${input.clientRequestId}`
  const fingerprint = roomFingerprint(input)
  const previous = await store.getRequest(key)
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new RoomStoreConflictError('model selection request changed')
    return rooms.service.get(roomId)
  }
  const room = await rooms.service.get(roomId)
  if (room.conversationKind !== 'user_agent') throw new RoomStoreConflictError('Private conversation required')
  if (room.archivedAt || room.deletedAt) throw new RoomStoreConflictError('Restore the conversation before changing its model')
  const agent = await rooms.agents.active(room.members.find((member) => member.id === room.defaultMemberId)!.participantAgentId!)
  if (agent.executor) throw new RoomStoreConflictError('A coding Agent keeps its engine model; choose another model when starting the chat')
  await assertExplicitAgentModel(rooms.deps, input.modelRef)
  const next = RoomSchema.parse({ ...room, privateModelRef: input.modelRef,
    revision: room.revision + 1, updatedAt: new Date().toISOString() })
  await store.commit({ requestId: key, fingerprint,
    checks: [{ kind: 'room', id: roomId, expectedRevision: input.expectedRevision }],
    puts: [{ kind: 'room', id: roomId, roomId, value: next }],
    events: [{ roomId, kind: 'room.updated', payload: { id: roomId } }] })
  return rooms.service.get(roomId)
}
