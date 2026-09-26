import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Pin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { readBrowserStorageItem } from '../../lib/browser-storage'
import type { RoomListEntry } from './rooms-client'
import { roomButtonClass } from './RoomSettings'
import { RoomAvatarGroup } from './RoomAvatar'

export function roomPreviewText(room: RoomListEntry, attachmentLabel: (count: number) => string): string {
  const latest = room.latestMessage
  if (!latest) return room.description || room.members.filter((member) => !member.removedAt).map((member) => member.displayName).join(', ')
  const preview = latest.preview || (latest.attachmentCount ? attachmentLabel(latest.attachmentCount) : '')
  return latest.authorLabelSnapshot && preview ? `${latest.authorLabelSnapshot}: ${preview}` : preview
}

export function RoomList({
  rooms,
  selectedId,
  select,
  cursor,
  moreBusy,
  loadMore
}: {
  rooms: RoomListEntry[]
  selectedId: string
  select: (id: string) => void
  cursor: string | null
  moreBusy: boolean
  loadMore: () => Promise<void>
}) {
  const { t } = useTranslation('common')
  const scrollRef = useRef<HTMLElement>(null)
  const virtualizer = useVirtualizer({
    count: rooms.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 78,
    overscan: 6,
    getItemKey: (index) => rooms[index].id
  })
  const virtual = rooms.length > 60
  const visible = virtual
    ? virtualizer.getVirtualItems()
    : rooms.map((room, index) => ({ key: room.id, index, start: 0 }))
  return (
    <nav
      ref={scrollRef}
      aria-label={t('roomsLabel')}
      className="rooms-list-nav min-h-0 flex-1 overflow-y-auto"
    >
      <div
        className="relative"
        style={virtual ? { height: virtualizer.getTotalSize() } : undefined}
      >
        {visible.map((row) => {
          const room = rooms[row.index]
          return (
            <div
              key={row.key}
              data-index={row.index}
              ref={virtual ? virtualizer.measureElement : undefined}
              style={
                virtual
                  ? { position: 'absolute', width: '100%', top: row.start }
                  : undefined
              }
              className="pb-1.5"
            >
              <button
                onClick={() => select(room.id)}
                className={`rooms-conversation-row ${selectedId === room.id ? 'is-selected' : ''}`}
                aria-label={room.name}
                aria-current={selectedId === room.id ? 'page' : undefined}
              >
                <RoomAvatarGroup members={room.members} avatar={room.avatar} id={room.id} label={room.name} size={44} />
                <span className="rooms-conversation-copy">
                  <span className="rooms-conversation-name">
                    {room.name}
                  </span>
                  <span className={`rooms-conversation-preview ${room.latestMessage?.authorLabelSnapshot ? 'has-author' : ''}`}
                    title={roomPreviewText(room, (count) => t('roomsAttachmentSummary', { count }))}>
                    {room.latestMessage?.authorLabelSnapshot ? <>
                      <span className="rooms-preview-author">{room.latestMessage.authorLabelSnapshot}</span>
                      <span aria-hidden="true">:</span>
                      <span className="rooms-preview-body">{room.latestMessage.preview ||
                        (room.latestMessage.attachmentCount ? t('roomsAttachmentSummary', { count: room.latestMessage.attachmentCount }) : '')}</span>
                    </> : roomPreviewText(room, (count) => t('roomsAttachmentSummary', { count }))}
                  </span>
                </span>
                <span className="rooms-conversation-meta">
                  {room.latestMessage?.createdAt && Number.isFinite(Date.parse(room.latestMessage.createdAt)) ? (
                    <time dateTime={room.latestMessage.createdAt} title={new Date(room.latestMessage.createdAt).toLocaleString()}>
                      {new Date(room.latestMessage.createdAt).toDateString() === new Date().toDateString()
                        ? new Date(room.latestMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : new Date(room.latestMessage.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </time>
                  ) : null}
                  <span className="rooms-conversation-badges">
                  {room.pinned ? <Pin size={11} aria-label={t('roomsPin')} /> : null}
                  {(room.attentionCount ?? 0) > 0 ? (
                    <span className="rooms-activity-count needs-attention" title={t('roomsAttention')}>{room.attentionCount}</span>
                  ) : (room.runningCount ?? 0) > 0 ? (
                    <span className="rooms-activity-count" title={t('roomsState_running')}>{room.runningCount}</span>
                  ) : null}
                {(room.latestMessageSeq ?? 0) >
                Math.max(
                  room.readSeq ?? 0,
                  Number(
                    readBrowserStorageItem(`kun.rooms.read.${room.id}`) ?? 0
                  )
                ) ? (
                  <span
                    aria-label={t('roomsUnread')}
                    title={t('roomsUnread')}
                    className="rooms-unread-dot"
                  />
                ) : null}
                  </span>
                </span>
              </button>
            </div>
          )
        })}
      </div>
      {cursor ? (
        <button
          className={`${roomButtonClass} w-full`}
          disabled={moreBusy}
          onClick={() => void loadMore()}
        >
          {t('roomsMore')}
        </button>
      ) : null}
    </nav>
  )
}
