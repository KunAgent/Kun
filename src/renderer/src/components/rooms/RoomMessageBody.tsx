import type { Room, RoomContentReference } from '@shared/rooms-api'
import { RoomMentionBody } from './room-mentions'
import { RoomContentCard } from './RoomContentCard'
import { RoomLegacyAttachment } from './RoomLegacyAttachment'
import { RoomLinkPreview } from './RoomLinkPreview'
import { roomContentKey } from './room-content-client'

export function RoomMessageBody({ body, attachmentIds, room, messageId, references = [], publicMessage = false,
  onOpenContent, onMember }: {
  body: string
  attachmentIds: string[]
  room?: Room
  messageId?: string
  references?: RoomContentReference[]
  publicMessage?: boolean
  onOpenContent?: (reference: RoomContentReference, messageId?: string) => void
  onMember?: (memberId: string) => void
}) {
  const entries = new Map(references.map((reference) => [roomContentKey(reference), reference]))
  for (const attachmentId of attachmentIds) {
    const reference: RoomContentReference = { kind: 'attachment', attachmentId }
    if (!entries.has(roomContentKey(reference))) entries.set(roomContentKey(reference), reference)
  }
  return <div className="rooms-message-body">
    {body ? <RoomMentionBody body={body} room={room} onMember={onMember} /> : null}
    {entries.size ? <div className="rooms-message-attachments">
      {[...entries].map(([key, reference]) => room
        ? <RoomContentCard key={key} room={room} reference={reference} messageId={messageId} onOpen={onOpenContent} />
        : reference.kind === 'attachment' ? <RoomLegacyAttachment key={key} id={reference.attachmentId} /> : null)}
    </div> : null}
    {publicMessage && room && messageId ? <RoomLinkPreview roomId={room.id} messageId={messageId} body={body} /> : null}
  </div>
}
