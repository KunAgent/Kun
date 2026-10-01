import { z } from 'zod'
import type { RoomRuntime } from './room-runtime.js'
import { RoomStoreConflictError } from './room-store.js'
import { roomAppConnectionMessage } from './room-app-connections.js'
import { isRoomImApp } from './room-app-connection-tools.js'

export const AgentImConnectionSchema = z.object({
  id: z.string().min(1).max(128), roomId: z.string().min(1).max(128),
  agentId: z.string().min(1).max(128), cardId: z.string().min(1).max(128),
  provider: z.enum(['feishu', 'weixin']), ownerId: z.string().min(1).max(256),
  enabled: z.boolean(), createdAt: z.string(), disconnectedAt: z.string().optional()
}).strict()
export type AgentImConnection = z.infer<typeof AgentImConnectionSchema>

export async function assertImRoom(rooms: RoomRuntime, roomId: string, agentId?: string) {
  const room = await rooms.service.get(roomId)
  const member = room.members.find((item) => item.id === room.defaultMemberId)
  if (room.archivedAt || room.conversationKind !== 'user_agent' || !member?.enabled || member.removedAt ||
      !member.participantAgentId || (agentId && member.participantAgentId !== agentId)) {
    throw new RoomStoreConflictError('The private Agent conversation is unavailable or changed')
  }
  return { room, member, agentId: member.participantAgentId }
}

export async function imConnectionCard(rooms: RoomRuntime, roomId: string, cardId: string) {
  const identity = await assertImRoom(rooms, roomId)
  const card = await roomAppConnectionMessage(rooms.deps.store, roomId, cardId)
  if (!isRoomImApp(card.row.value.appConnection!.serverId) || card.row.value.authorMemberId !== identity.member.id) {
    throw new RoomStoreConflictError('IM card does not belong to this private Agent')
  }
  return { ...identity, ...card, provider: card.row.value.appConnection!.serverId === 'im.feishu' ? 'feishu' as const : 'weixin' as const }
}

export async function activeImConnection(rooms: RoomRuntime, roomId: string, connectionId: string) {
  const row = await rooms.deps.store.get<AgentImConnection>('agent_im_connection', connectionId)
  if (!row || row.roomId !== roomId) throw new RoomStoreConflictError('IM connection not found')
  const value = AgentImConnectionSchema.parse(row.value)
  if (!value.enabled) throw new RoomStoreConflictError('IM connection is disconnected')
  await assertImRoom(rooms, roomId, value.agentId)
  return { row, value }
}
