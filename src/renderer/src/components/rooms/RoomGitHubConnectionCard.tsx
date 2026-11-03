import { useState } from 'react'
import type { RoomMessage } from '@shared/rooms-api'
import { GitHubConnectionCard } from './GitHubConnectionCard'
import { roomRequestId, roomsRequest } from './rooms-client'

export function RoomGitHubConnectionCard({ message }: { message: RoomMessage }) {
  const [updated, setUpdated] = useState<RoomMessage | null>(null)
  const shown = updated && updated.bodyRevision > message.bodyRevision ? updated : message
  const act = async (action: 'complete' | 'skip') => {
    const result = await roomsRequest<{ message: RoomMessage; resumed: boolean }>(
      `/v1/rooms/${encodeURIComponent(message.roomId)}/app-connections/${encodeURIComponent(message.id)}/${action}`,
      'POST', { clientRequestId: roomRequestId() })
    setUpdated(result.message)
    return result.resumed
  }
  return <GitHubConnectionCard binding={{ roomId: message.roomId, messageId: message.id }} body={shown.body}
    skipped={shown.appConnection?.status === 'skipped'} resumed={shown.appConnection?.resumed}
    onContinue={() => act('complete')} onSkip={async () => { await act('skip') }} />
}
