import { RoomMemberSchema, type Room } from '../contracts/rooms.js'
import type { RoomService } from '../rooms/room-service.js'
import { RoomStoreConflictError } from '../rooms/room-store.js'
import { agentStableId, type AgentIdentityService } from './agent-identity-service.js'
import { randomUUID } from 'node:crypto'

export async function currentAgentConversation(directory: AgentIdentityService, id: string) {
  const rows = await directory.store.list<Room>('room', {
    participantAgentId: id, conversationKind: 'user_agent', includeArchived: true, limit: 1000
  })
  return rows.find((row) => !row.value.deletedAt) ?? null
}

export async function openAgentConversation(directory: AgentIdentityService, service: RoomService, id: string): Promise<{ room: Room }> {
  const agent = await directory.get(id)
  const existing = await currentAgentConversation(directory, id)
  if (existing) return { room: await service.get(existing.id) }
  if (agent.archivedAt) throw new RoomStoreConflictError('restore the agent before starting a conversation')
  if (!(await directory.features()).identities) throw new RoomStoreConflictError('independent conversations are disabled')
  const stableId = agentStableId('agent-direct', id)
  const roomId = await directory.store.get('room', stableId) ? randomUUID() : stableId
  return service.create({ clientRequestId: roomId, name: agent.name, description: agent.title,
    collaborationMode: 'peer', members: [directory.asMember(agent)], defaultMemberId: id
  }, { id: roomId, conversationKind: 'user_agent' })
}

/** A pair has one product transcript. Each handoff still has an isolated execution context. */
export async function openAgentPairConversation(directory: AgentIdentityService, service: RoomService,
  firstId: string, secondId: string): Promise<{ room: Room }> {
  if (firstId === secondId) throw new RoomStoreConflictError('cannot collaborate with yourself')
  const ids = [firstId, secondId].sort()
  const agents = await Promise.all(ids.map((id) => directory.active(id)))
  const id = agentStableId('agent-pair', ...ids)
  const existing = await directory.store.get<Room>('room', id)
  if (existing) return { room: existing.value }
  return service.create({ clientRequestId: id, name: agents.map((agent) => agent.name).join(' ↔ ').slice(0, 120),
    collaborationMode: 'peer', members: agents.map((agent) => RoomMemberSchema.parse(directory.asMember(agent))),
    defaultMemberId: ids[0]
  }, { id, conversationKind: 'agent_agent' })
}
