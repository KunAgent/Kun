import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { MessagesSquare, Pin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { readBrowserStorageItem } from '../../lib/browser-storage'
import type { RoomListEntry } from './rooms-client'
import { roomButtonClass } from './RoomSettings'

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
      className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
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
              className="pb-1"
            >
              <button
                onClick={() => select(room.id)}
                className={`flex w-full items-start gap-2 rounded-lg px-3 py-3 text-left ${selectedId === room.id ? 'bg-accent/10' : 'hover:bg-ds-hover'}`}
                aria-current={selectedId === room.id ? 'page' : undefined}
              >
                <MessagesSquare
                  size={16}
                  className="mt-0.5 shrink-0 text-ds-muted"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ds-ink">
                    {room.name}
                  </span>
                  <span className="mt-1 block truncate text-xs text-ds-faint">
                    {room.description ||
                      room.members
                        .filter((member) => !member.removedAt)
                        .map((member) => member.displayName)
                        .join(', ')}
                  </span>
                  {(room.runningCount ?? 0) + (room.attentionCount ?? 0) > 0 ? (
                    <span className="mt-1 block text-[10px] text-ds-muted">
                      {t('roomsActivityCounts', {
                        running: room.runningCount ?? 0,
                        attention: room.attentionCount ?? 0
                      })}
                    </span>
                  ) : null}
                </span>
                {room.pinned ? (
                  <Pin size={12} className="mt-1 shrink-0 text-ds-muted" />
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
                    className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent"
                  />
                ) : null}
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
