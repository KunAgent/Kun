import { useState } from 'react'
import type { RoomMessage } from '@shared/rooms-api'
import { GmailConnectionCard } from './GmailConnectionCard'
import { roomRequestId, roomsRequest } from './rooms-client'

export function RoomGmailConnectionCard({ message }: { message: RoomMessage }) {
  const [updated, setUpdated] = useState<RoomMessage | null>(null)
  const shown = updated && updated.bodyRevision > message.bodyRevision ? updated : message
  const act = async (action: 'complete' | 'skip') => {
    const result = await roomsRequest<{ message: RoomMessage }>(
      `/v1/rooms/${encodeURIComponent(message.roomId)}/app-connections/${encodeURIComponent(message.id)}/${action}`,
      'POST', { clientRequestId: roomRequestId() })
    setUpdated(result.message)
  }
  return <GmailConnectionCard binding={{ roomId: message.roomId, messageId: message.id }} body={shown.body}
    skipped={shown.appConnection?.status === 'skipped'} resumed={shown.appConnection?.resumed}
    onContinue={() => act('complete')} onSkip={() => act('skip')} />
}
