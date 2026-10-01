import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Room, RoomContentReference } from '@shared/rooms-api'
import { RoomMentionBody } from './room-mentions'
import { RoomContentCard } from './RoomContentCard'
import { RoomLegacyAttachment } from './RoomLegacyAttachment'
import { RoomLinkPreview } from './RoomLinkPreview'
import { roomContentKey } from './room-content-client'

export function RoomMessageBody({ body, attachmentIds, room, messageId, references = [], publicMessage = false, collapsible = false,
  onOpenContent, onMember }: {
  body: string
  attachmentIds: string[]
  room?: Room
  messageId?: string
  references?: RoomContentReference[]
  publicMessage?: boolean
  collapsible?: boolean
  onOpenContent?: (reference: RoomContentReference, messageId?: string) => void
  onMember?: (memberId: string) => void
}) {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState(false)
  useEffect(() => setExpanded(false), [messageId])
  const long = collapsible && (body.length > 2400 || body.split('\n').length > 30)
  const entries = new Map(references.map((reference) => [roomContentKey(reference), reference]))
  for (const attachmentId of attachmentIds) {
    const reference: RoomContentReference = { kind: 'attachment', attachmentId }
    if (!entries.has(roomContentKey(reference))) entries.set(roomContentKey(reference), reference)
  }
  return <div className="rooms-message-body">
    {body ? <div className={long && !expanded ? 'rooms-message-collapsed' : undefined}>
      <RoomMentionBody body={body} room={room} onMember={onMember} /></div> : null}
    {long ? <button className="rooms-message-collapse" type="button" aria-expanded={expanded}
      onClick={() => setExpanded((value) => !value)}>{t(expanded ? 'roomsCollapseReply' : 'roomsExpandReply')}</button> : null}
    {entries.size ? <div className="rooms-message-attachments">
      {[...entries].map(([key, reference]) => room
        ? <RoomContentCard key={key} room={room} reference={reference} messageId={messageId} onOpen={onOpenContent} gallery={[...entries.values()]} />
        : reference.kind === 'attachment' ? <RoomLegacyAttachment key={key} id={reference.attachmentId} /> : null)}
    </div> : null}
    {publicMessage && room && messageId ? <RoomLinkPreview roomId={room.id} messageId={messageId} body={body} /> : null}
  </div>
}
