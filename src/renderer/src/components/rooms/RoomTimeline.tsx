import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pin } from 'lucide-react'
import type { Room, RoomMessage, RoomTask } from '@shared/rooms-api'
import {
  readBrowserStorageItem,
  writeBrowserStorageItem
} from '../../lib/browser-storage'
import {
  mergeRoomMessages,
  roomPath,
  roomRequestId,
  roomsRequest
} from './rooms-client'
import { RoomMessageBody } from './RoomMessageBody'
import { roomButtonClass, roomFieldClass } from './RoomSettings'

export function RoomTimeline({
  room,
  messages,
  tasks,
  cursor,
  moreBusy,
  loadEarlier,
  onPin,
  onTask,
  jumpMessageId,
  onJumped
}: {
  room: Room
  messages: RoomMessage[]
  tasks: RoomTask[]
  cursor: string | null
  moreBusy: boolean
  loadEarlier: () => Promise<void>
  onPin: (message: RoomMessage) => void
  onTask: (id: string) => void
  jumpMessageId: string | null
  onJumped: () => void
}) {
  const { t } = useTranslation('common')
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const initialized = useRef(false)
  const anchor = useRef<{ height: number; top: number } | null>(null)
  const readSeq = useRef(
    Number(readBrowserStorageItem(`kun.rooms.read.${room.id}`) ?? 0)
  )
  const readPending = useRef(0)
  const [query, setQuery] = useState('')
  const queryRef = useRef(query)
  queryRef.current = query
  const [results, setResults] = useState<RoomMessage[] | null>(null)
  const [searchCursor, setSearchCursor] = useState<string | undefined>()
  const [searchBusy, setSearchBusy] = useState(false)
  const [error, setError] = useState('')
  const [focused, setFocused] = useState<RoomMessage | null>(null)
  const rows = useMemo(() => results ?? messages, [results, messages])
  const virtual = rows.length > 40
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 220,
    overscan: 6,
    getItemKey: (index) => rows[index].id
  })
  const rendered = virtual
    ? virtualizer.getVirtualItems()
    : rows.map((row, index) => ({ key: row.id, index, start: 0, end: 0 }))
  const markRead = () => {
    if (results || focused || !document.hasFocus() || !atBottom.current) return
    const seq = messages.at(-1)?.messageSeq ?? 0
    if (seq <= readSeq.current || seq <= readPending.current) return
    readPending.current = seq
    void roomsRequest<{ seq?: number; result?: { seq: number } }>(
      roomPath(room.id) + '/read',
      'POST',
      {
        seq,
        clientRequestId: roomRequestId()
      }
    )
      .then((result) => {
        const confirmed = result.seq ?? result.result?.seq
        if (!Number.isSafeInteger(confirmed)) return
        readSeq.current = Math.max(readSeq.current, confirmed!)
        writeBrowserStorageItem(
          `kun.rooms.read.${room.id}`,
          String(readSeq.current)
        )
      })
      .catch(() => undefined)
      .finally(() => {
        readPending.current = 0
      })
  }
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null)
      setSearchCursor(undefined)
      setError('')
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setSearchBusy(true)
      void roomsRequest<{ messages: RoomMessage[]; nextCursor?: string }>(
        `${roomPath(room.id)}/search?q=${encodeURIComponent(query.trim())}`,
        'GET',
        undefined,
        controller.signal
      )
        .then((page) => {
          if (!controller.signal.aborted) {
            setResults(page.messages)
            setSearchCursor(page.nextCursor)
            setError('')
          }
        })
        .catch((cause) => {
          if (!controller.signal.aborted) setError(String(cause))
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchBusy(false)
        })
    }, 250)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [query, room.id])
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || results) return
    if (!initialized.current) {
      initialized.current = true
      const value = readBrowserStorageItem(`kun.rooms.scroll.${room.id}`)
      scroller.scrollTop =
        value === null ? scroller.scrollHeight : Number(value) || 0
      atBottom.current =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80
    } else if (anchor.current) {
      scroller.scrollTop =
        anchor.current.top + scroller.scrollHeight - anchor.current.height
      anchor.current = null
    } else if (atBottom.current) scroller.scrollTop = scroller.scrollHeight
    markRead()
  })
  useEffect(() => {
    if (!jumpMessageId) return
    const index = rows.findIndex((message) => message.id === jumpMessageId)
    if (index >= 0) {
      atBottom.current = false
      if (virtual) virtualizer.scrollToIndex(index, { align: 'center' })
      else
        document
          .getElementById('room-message-' + jumpMessageId)
          ?.scrollIntoView({ block: 'center' })
      onJumped()
      return
    }
    const controller = new AbortController()
    void roomsRequest<{ message: RoomMessage }>(
      `${roomPath(room.id)}/messages/${encodeURIComponent(jumpMessageId)}`,
      'GET',
      undefined,
      controller.signal
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setFocused(result.message)
          onJumped()
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(String(cause))
          onJumped()
        }
      })
    return () => controller.abort()
  }, [jumpMessageId, onJumped, room.id, rows, virtual, virtualizer])
  const reply = (message: RoomMessage) => {
    setFocused(null)
    window.dispatchEvent(
      new CustomEvent('kun-room-reply', {
        detail: { roomId: room.id, messageId: message.id, body: message.body }
      })
    )
  }
  const renderMessage = (message: RoomMessage) => (
    <article
      id={'room-message-' + message.id}
      className={`group mx-auto max-w-3xl rounded-xl p-4 ${message.authorKind === 'user' ? 'bg-accent/5' : 'border border-ds-border'}`}
    >
      <div className="mb-2 flex items-center gap-2 text-xs text-ds-muted">
        <strong className="min-w-0 truncate text-sm text-ds-ink">
          {message.authorLabelSnapshot}
        </strong>
        <time
          dateTime={message.createdAt}
          className="ml-auto whitespace-nowrap"
        >
          {new Date(message.createdAt).toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })}
        </time>
        <button
          onClick={() => onPin(message)}
          className="shrink-0 rounded p-1 hover:bg-ds-hover"
          aria-label={t('roomsPinMessage')}
        >
          <Pin size={12} />
        </button>
      </div>
      {message.replyToMessageId ? (
        <button
          className="mb-2 text-xs text-accent"
          onClick={() => {
            void roomsRequest<{ message: RoomMessage }>(
              `${roomPath(room.id)}/messages/${encodeURIComponent(message.replyToMessageId!)}`
            )
              .then((result) => setFocused(result.message))
              .catch((cause) => setError(String(cause)))
          }}
        >
          {t('roomsViewReply')}
        </button>
      ) : null}
      <RoomMessageBody
        body={message.body}
        attachmentIds={message.attachmentIds}
      />
      <div className="mt-2 flex gap-3">
        <button className="text-xs text-accent" onClick={() => reply(message)}>
          {t('roomsReply')}
        </button>
        {message.taskId ? (
          <button
            className="text-xs text-accent"
            onClick={() => {
              setFocused(null)
              onTask(message.taskId!)
            }}
          >
            {tasks.find((task) => task.id === message.taskId)?.title ??
              t('roomsDetails')}
          </button>
        ) : null}
      </div>
    </article>
  )
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 px-4 py-2">
        <input
          aria-label={t('roomsSearchMessages')}
          placeholder={t('roomsSearchMessages')}
          className={roomFieldClass}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <button className={roomButtonClass} onClick={() => setQuery('')}>
            {t('roomsClose')}
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="px-4 text-xs text-red-500">
          {error}
        </p>
      ) : null}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 md:px-7"
        onScroll={(event) => {
          const element = event.currentTarget
          atBottom.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 80
          if (!results)
            writeBrowserStorageItem(
              `kun.rooms.scroll.${room.id}`,
              String(element.scrollTop)
            )
          markRead()
        }}
        onFocus={markRead}
      >
        {!results && cursor ? (
          <div className="mb-4 text-center">
            <button
              className={roomButtonClass}
              disabled={moreBusy}
              onClick={() => {
                const element = scrollRef.current
                if (element)
                  anchor.current = {
                    height: element.scrollHeight,
                    top: element.scrollTop
                  }
                void loadEarlier()
              }}
            >
              {t(moreBusy ? 'roomsLoading' : 'roomsOlder')}
            </button>
          </div>
        ) : null}
        {!rows.length ? (
          <p className="py-12 text-center text-sm text-ds-muted">
            {t(
              searchBusy
                ? 'roomsLoading'
                : results
                  ? 'roomsNoResults'
                  : 'roomsNoMessages'
            )}
          </p>
        ) : null}
        <div
          style={
            virtual
              ? {
                  paddingTop: rendered[0]?.start ?? 0,
                  paddingBottom: Math.max(
                    0,
                    virtualizer.getTotalSize() - (rendered.at(-1)?.end ?? 0)
                  )
                }
              : undefined
          }
        >
          {rendered.map((row) => (
            <div
              key={row.key}
              data-index={row.index}
              ref={virtual ? virtualizer.measureElement : undefined}
              className="pb-5"
            >
              {renderMessage(rows[row.index])}
            </div>
          ))}
        </div>
        {results && searchCursor ? (
          <button
            className={roomButtonClass}
            disabled={searchBusy}
            onClick={() => {
              setSearchBusy(true)
              void roomsRequest<{
                messages: RoomMessage[]
                nextCursor?: string
              }>(
                `${roomPath(room.id)}/search?q=${encodeURIComponent(query.trim())}&cursor=${encodeURIComponent(searchCursor)}`
              )
                .then((page) => {
                  if (queryRef.current !== query) return
                  setResults((current) =>
                    mergeRoomMessages(current ?? [], page.messages)
                  )
                  setSearchCursor(page.nextCursor)
                })
                .catch((cause) => {
                  if (queryRef.current === query) setError(String(cause))
                })
                .finally(() => {
                  if (queryRef.current === query) setSearchBusy(false)
                })
            }}
          >
            {t('roomsMoreResults')}
          </button>
        ) : null}
      </div>
      {focused ? (
        <section
          role="dialog"
          aria-modal="true"
          aria-label={t('roomsViewReply')}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              setFocused(null)
            }
          }}
          className="absolute inset-4 z-[60] overflow-auto rounded-xl border border-ds-border bg-ds-main p-4 shadow-xl"
        >
          <div className="mb-4 flex justify-between text-sm text-ds-muted">
            <span>{t('roomsReferencedMessage')}</span>
            <button
              className={roomButtonClass}
              onClick={() => setFocused(null)}
            >
              {t('roomsClose')}
            </button>
          </div>
          {renderMessage(focused)}
        </section>
      ) : null}
    </>
  )
}
