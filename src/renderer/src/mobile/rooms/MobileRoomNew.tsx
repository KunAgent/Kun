import { agentPath } from '../../components/rooms/agent-client'
import { RoomNewChat } from '../../components/rooms/RoomNewChat'
import { roomsRequest } from '../../components/rooms/rooms-client'
import type { Room } from '@shared/rooms-api'

export function MobileRoomNew({ onClose, onOpen, group = false }: {
  onClose: () => void
  onOpen: (roomId: string) => void
  group?: boolean
}) {
  const openAgent = async (agentId: string): Promise<void> => {
    const result = await roomsRequest<{ room: Room }>(agentPath(agentId) + '/conversation', 'POST', {})
    onOpen(result.room.id)
  }
  return <RoomNewChat autoFocus={false} closeAfterAgent={false} onClose={onClose} onOpen={onOpen}
    onAgent={openAgent} initialGroup={group} />
}
