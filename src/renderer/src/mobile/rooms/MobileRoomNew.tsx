import { useState } from 'react'
import { agentPath } from '../../components/rooms/agent-client'
import { RoomNewChat } from '../../components/rooms/RoomNewChat'
import { roomsRequest } from '../../components/rooms/rooms-client'
import type { Room } from '@shared/rooms-api'

export function MobileRoomNew({ onClose, onOpen }: {
  onClose: () => void
  onOpen: (roomId: string) => void
}) {
  const [error, setError] = useState('')
  const openAgent = async (agentId: string): Promise<void> => {
    setError('')
    try {
      const result = await roomsRequest<{ room: Room }>(agentPath(agentId) + '/conversation', 'POST', {})
      onOpen(result.room.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return <>
    <RoomNewChat autoFocus={false} onClose={onClose} onOpen={onOpen}
      onAgent={(agentId) => void openAgent(agentId)} onFill={() => undefined} />
    {error ? <p role="alert" className="kun-mobile-notice">{error}</p> : null}
  </>
}
