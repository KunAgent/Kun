import type { Room, RoomSidebarEntry } from '@shared/rooms-api'
import { agentPath } from './agent-client'
import { roomRequestId, roomsClient, roomsRequest } from './rooms-client'

/** Archives or restores a sidebar entry: an agent through its profile, a room through its record. */
export async function toggleRoomSidebarEntryArchived(entry: RoomSidebarEntry): Promise<void> {
  if (entry.agentId) {
    const { agent } = await roomsRequest<{ agent: { revision: number } }>('/v1/agents/' + entry.agentId)
    await roomsRequest('/v1/agents/' + entry.agentId, 'PATCH', { clientRequestId: roomRequestId(), expectedRevision: agent.revision, archived: !entry.archived })
    return
  }
  const { room } = entry.roomId ? await roomsClient.get(entry.roomId) : await roomsRequest<{ room: Room }>('/v1/agents/' + entry.agentId + '/conversation', 'POST', {})
  await roomsClient.update(room, { archived: !entry.archived })
}

/** An agent listed before its first message has no room yet; opening it creates the direct conversation. */
export async function roomIdForSidebarEntry(entry: RoomSidebarEntry): Promise<string> {
  if (entry.roomId) return entry.roomId
  if (!entry.agentId) throw new Error('Sidebar entry has neither a room nor an agent')
  const { room } = await roomsRequest<{ room: Room }>(agentPath(entry.agentId) + '/conversation', 'POST', {})
  return room.id
}
