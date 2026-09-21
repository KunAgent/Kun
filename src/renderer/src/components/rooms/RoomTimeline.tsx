import { useVirtualizer } from '@tanstack/react-virtual'
import {
  useCallback,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, Search, X } from 'lucide-react'
import type { Room, RoomContentReference, RoomMessage, RoomTask } from '@shared/rooms-api'
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
import { RoomMessageRow } from './RoomMessageRow'
import { roomButtonClass, roomFieldClass } from './RoomSettings'
import './rooms-timeline.css'

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
  onJumped,
  searchOpen = false,
  onSearchClose,
  onMember,
  onRun,
  onHandoff,
  onReply,
  onReplyThread,
  onOpenContent,
  afterMessages,
  renderChoice
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
  searchOpen?: boolean
  onSearchClose?: () => void
  onMember?: (id: string, rootRequestId?: string) => void
  onRun?: (id: string) => void
  onHandoff?: (id: string) => void
  onReply?: (message: RoomMessage) => void
  onReplyThread?: (message: RoomMessage) => void
  onOpenContent?: (reference: RoomContentReference, messageId?: string) => void
  afterMessages?: ReactNode
  renderChoice?: (message: RoomMessage) => ReactNode
}) {
  const { t } = useTranslation('common')
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const initialized = useRef(false)
  const anchor = useRef<{
    height: number
    top: number
    firstId?: string
  } | null>(null)
  const returnToLatest = useRef(false)
  const wasSearching = useRef(false)
  const [awayFromBottom, setAwayFromBottom] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const closeDialogRef = useRef<HTMLButtonElement>(null)
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
  const dialogOpen = Boolean(focused)
  const messageById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages]
  )
  const rows = useMemo(() => results ?? messages, [results, messages])
  const virtual = rows.length > 40
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 160,
    overscan: 6,
    getItemKey: (index) => rows[index].id
  })
  const rendered = virtual
    ? virtualizer.getVirtualItems()
    : rows.map((row, index) => ({ key: row.id, index, start: 0, end: 0 }))
  const totalSize = virtualizer.getTotalSize()
  const markRead = useCallback(() => {
    if (
      searchOpen ||
      results ||
      focused ||
      !document.hasFocus() ||
      !atBottom.current
    )
      return
    const seq = messages.filter((message) => message.status !== 'streaming').at(-1)?.messageSeq ?? 0
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
  }, [focused, messages, results, room.id, searchOpen])
  useEffect(() => {
    if (!searchOpen) {
      setQuery('')
      setSearchBusy(false)
      return
    }
    const previous = document.activeElement as HTMLElement | null
    searchRef.current?.focus()
    return () => {
      if (previous?.isConnected) previous.focus()
    }
  }, [searchOpen])
  useEffect(() => {
    if (!dialogOpen) return
    const previous = document.activeElement as HTMLElement | null
    closeDialogRef.current?.focus()
    return () => {
      if (previous?.isConnected) previous.focus()
    }
  }, [dialogOpen])
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null)
      setSearchCursor(undefined)
      setSearchBusy(false)
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
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !rowsRef.current) return
    const observer = new ResizeObserver(() => {
      if (
        atBottom.current &&
        !results &&
        !focused &&
        !anchor.current &&
        scrollRef.current
      )
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    })
    observer.observe(rowsRef.current)
    return () => observer.disconnect()
  }, [focused, results])
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || focused) return
    if (results) {
      wasSearching.current = true
      return
    }
    if (returnToLatest.current) {
      returnToLatest.current = false
      wasSearching.current = false
      atBottom.current = true
      setAwayFromBottom(false)
      scroller.scrollTop = scroller.scrollHeight
    }
    if (!initialized.current) {
      initialized.current = true
      const value = readBrowserStorageItem(`kun.rooms.scroll.${room.id}`)
      scroller.scrollTop =
        value === null ? scroller.scrollHeight : Number(value) || 0
      atBottom.current =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80
      setAwayFromBottom(!atBottom.current)
    } else if (wasSearching.current) {
      wasSearching.current = false
      const value = readBrowserStorageItem(`kun.rooms.scroll.${room.id}`)
      scroller.scrollTop = atBottom.current
        ? scroller.scrollHeight
        : Number(value) || 0
    } else if (anchor.current && anchor.current.firstId !== messages[0]?.id) {
      scroller.scrollTop =
        anchor.current.top + scroller.scrollHeight - anchor.current.height
      anchor.current = null
    } else if (atBottom.current) scroller.scrollTop = scroller.scrollHeight
    markRead()
  }, [focused, results, messages, room.id, markRead, awayFromBottom, totalSize])
  useEffect(() => {
    if (!jumpMessageId) return
    const index = rows.findIndex((message) => message.id === jumpMessageId)
    if (index >= 0) {
      atBottom.current = false
      setAwayFromBottom(true)
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
        detail: {
          roomId: room.id,
          messageId: message.id,
          body: message.body,
          rootRequestId: message.rootRequestId
        }
      })
    )
  }
  const viewReply = (id: string) => {
    const index = rows.findIndex((message) => message.id === id)
    if (index >= 0 && !focused) {
      atBottom.current = false
      setAwayFromBottom(true)
      if (virtual) virtualizer.scrollToIndex(index, { align: 'center' })
      else
        document
          .getElementById('room-message-' + id)
          ?.scrollIntoView({ block: 'center' })
      return
    }
    const loaded = messageById.get(id)
    if (loaded) setFocused(loaded)
    else
      void roomsRequest<{ message: RoomMessage }>(
        `${roomPath(room.id)}/messages/${encodeURIComponent(id)}`
      )
        .then((result) => setFocused(result.message))
        .catch((cause) => setError(String(cause)))
  }
  const actions = useRef({ onRun, onReply, onReplyThread, reply, viewReply, onTask, onMember })
  actions.current = { onRun, onReply, onReplyThread, reply, viewReply, onTask, onMember }
  const stableActions = useMemo(() => ({
    task: (id: string) => { setFocused(null); actions.current.onTask(id) },
    member: (id: string, rootRequestId?: string) => { setFocused(null); actions.current.onMember?.(id, rootRequestId) },
    run: (id: string) => { setFocused(null); actions.current.onRun?.(id) },
    reply: (message: RoomMessage) => (actions.current.onReply ?? actions.current.reply)(message),
    thread: (message: RoomMessage) => (actions.current.onReplyThread ?? actions.current.onReply ?? actions.current.reply)(message),
    viewReply: (id: string) => actions.current.viewReply(id)
  }), [])
  const renderMessage = (message: RoomMessage) => (
    message.presentationKind === 'choice' && renderChoice ? renderChoice(message) : <StableMessageRow
      room={room}
      onOpenContent={onOpenContent}
      onHandoff={onHandoff}
      onRun={onRun ? stableActions.run : undefined}
      message={message}
      member={room.members.find(
        (member) => member.id === message.authorMemberId
      )}
      task={tasks.find((task) => task.id === message.taskId)}
      referencedMessage={
        message.replyToMessageId
          ? messageById.get(message.replyToMessageId)
          : undefined
      }
      onReply={stableActions.reply}
      onThread={stableActions.thread}
      onPin={onPin}
      onTask={stableActions.task}
      onViewReply={stableActions.viewReply}
      onMember={onMember ? stableActions.member : undefined}
    />
  )
  return (
    <div className="rooms-timeline">
      {searchOpen ? (
        <div className="rooms-timeline-search">
          <Search
            size={16}
            className="shrink-0 text-ds-muted"
            aria-hidden="true"
          />
          <input
            ref={searchRef}
            aria-label={t('roomsSearchMessages')}
            placeholder={t('roomsSearchMessages')}
            className={roomFieldClass}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                setQuery('')
                onSearchClose?.()
              }
            }}
          />
          <button
            type="button"
            className={roomButtonClass}
            aria-label={t('roomsClose')}
            onClick={() => {
              setQuery('')
              onSearchClose?.()
            }}
          >
            <X size={16} />
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="px-4 text-xs text-red-500">
          {error}
        </p>
      ) : null}
      <div
        ref={scrollRef}
        className="rooms-timeline-scroll"
        onScroll={(event) => {
          const element = event.currentTarget
          if (!results) {
            atBottom.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              80
            setAwayFromBottom(!atBottom.current)
            writeBrowserStorageItem(
              `kun.rooms.scroll.${room.id}`,
              String(element.scrollTop)
            )
          }
          markRead()
        }}
        onFocus={markRead}
      >
        {!results && cursor ? (
          <div className="rooms-timeline-older">
            <button
              className={roomButtonClass}
              disabled={moreBusy}
              onClick={() => {
                const element = scrollRef.current
                if (element)
                  anchor.current = {
                    height: element.scrollHeight,
                    top: element.scrollTop,
                    firstId: messages[0]?.id
                  }
                void loadEarlier().catch((cause) => {
                  anchor.current = null
                  setError(String(cause))
                })
              }}
            >
              {t(moreBusy ? 'roomsLoading' : 'roomsOlder')}
            </button>
          </div>
        ) : null}
        {!rows.length ? (
          <p className="rooms-timeline-empty">
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
          ref={rowsRef}
          style={
            virtual
              ? {
                  paddingTop: rendered[0]?.start ?? 0,
                  paddingBottom: Math.max(
                    0,
                    totalSize - (rendered.at(-1)?.end ?? 0)
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
              className="rooms-timeline-row"
            >
              {renderMessage(rows[row.index])}
            </div>
          ))}
          {afterMessages}
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
      {awayFromBottom && !results && !focused ? (
        <button
          type="button"
          className="rooms-timeline-latest"
          onClick={() => {
            returnToLatest.current = true
            setAwayFromBottom(false)
            setFocused(null)
            setQuery('')
            onSearchClose?.()
          }}
        >
          <ArrowDown size={14} aria-hidden="true" />
          {t('roomsLatestMessages')}
        </button>
      ) : null}
      {focused ? (
        <section
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t('roomsViewReply')}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              setFocused(null)
            }
            if (event.key === 'Tab') {
              const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
                'button, a[href], input, [tabindex="0"]'
              )
              const first = controls?.[0]
              const last = controls?.[controls.length - 1]
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault()
                last?.focus()
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first?.focus()
              }
            }
          }}
          className="rooms-message-dialog"
        >
          <div className="rooms-message-dialog-header">
            <span>{t('roomsReferencedMessage')}</span>
            <button
              ref={closeDialogRef}
              className={roomButtonClass}
              onClick={() => setFocused(null)}
            >
              {t('roomsClose')}
            </button>
          </div>
          {renderMessage(focused)}
        </section>
      ) : null}
    </div>
  )
}

// Handlers read current timeline state even when an unchanged historical row skips rendering.
const StableMessageRow = memo(function StableMessageRow(props: Parameters<typeof RoomMessageRow>[0]) {
  return <RoomMessageRow {...props} />
}, (a, b) => a.message === b.message && a.room === b.room && a.member === b.member && a.task === b.task && a.referencedMessage === b.referencedMessage &&
  a.onPin === b.onPin && a.onTask === b.onTask && a.onMember === b.onMember && a.onOpenContent === b.onOpenContent && a.onHandoff === b.onHandoff && a.onReply === b.onReply && a.onThread === b.onThread && a.onRun === b.onRun && a.onViewReply === b.onViewReply)
