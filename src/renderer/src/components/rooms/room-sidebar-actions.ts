import type { Room, RoomSidebarEntry } from '@shared/rooms-api'
import { agentPath } from './agent-client'
import { roomsClient, roomsRequest } from './rooms-client'

/** Conversation actions never mutate the Agent identity. */
export async function toggleRoomSidebarEntryArchived(entry: RoomSidebarEntry): Promise<void> {
  if (!entry.roomId) throw new Error('Conversation not found')
  const { room } = await roomsClient.get(entry.roomId)
  await roomsClient.update(room, { archived: !entry.archived })
}

export async function setRoomSidebarEntryDeleted(entry: RoomSidebarEntry, deleted: boolean): Promise<void> {
  if (!entry.roomId) throw new Error('Conversation not found')
  const { room } = await roomsClient.get(entry.roomId)
  await roomsClient.update(room, { deleted })
}

/** An agent listed before its first message has no room yet; opening it creates the direct conversation. */
export async function roomIdForSidebarEntry(entry: RoomSidebarEntry): Promise<string> {
  if (entry.roomId) return entry.roomId
  if (!entry.agentId) throw new Error('Sidebar entry has neither a room nor an agent')
  const { room } = await roomsRequest<{ room: Room }>(agentPath(entry.agentId) + '/conversation', 'POST', {})
  return room.id
}
