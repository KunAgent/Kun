import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown } from 'lucide-react'
import type { Room, RoomContentReference, RoomMessage, RoomTask } from '@shared/rooms-api'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'
import { mergeRoomMessages, roomPath, roomRequestId, roomsRequest } from './rooms-client'
import { RoomMessageRow } from './RoomMessageRow'
import { roomMessageLayout } from './room-message-layout'
import { roomButtonClass } from './RoomSettings'
import { RoomTimelineSearch } from './RoomTimelineSearch'
import { captureTimelinePosition, restoreTimelinePosition, type RoomTimelinePosition } from './room-timeline-position'
import './rooms-timeline.css'
import './rooms-timeline-navigation.css'

export function RoomTimeline({ room, messages, tasks, cursor, moreBusy, loadEarlier, onPin, onTask,
  jumpMessageId, onJumped, searchOpen = false, onSearchClose, onMember, onRun, onHandoff, onReply,
  onReplyThread, onOpenContent, afterMessages, renderChoice, hideEmpty = false
}: {
  room: Room; messages: RoomMessage[]; tasks: RoomTask[]; cursor: string | null; moreBusy: boolean
  loadEarlier: () => Promise<void>; onPin: (message: RoomMessage) => void | Promise<boolean>; onTask: (id: string) => void
  jumpMessageId: string | null; onJumped: () => void; searchOpen?: boolean; onSearchClose?: () => void
  onMember?: (id: string, rootRequestId?: string) => void; onRun?: (id: string) => void; onHandoff?: (id: string) => void
  onReply?: (message: RoomMessage) => void; onReplyThread?: (message: RoomMessage) => void
  onOpenContent?: (reference: RoomContentReference, messageId?: string) => void
  afterMessages?: ReactNode; renderChoice?: (message: RoomMessage) => ReactNode; hideEmpty?: boolean
}) {
  const { t } = useTranslation('common')
  const scrollRef = useRef<HTMLDivElement>(null), rowsRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true), initialized = useRef(false), readPending = useRef(0)
  const readSeq = useRef(Number(readBrowserStorageItem(`kun.rooms.read.${room.id}`) ?? 0))
  const seenSeq = useRef(readSeq.current)
  const [baseline, setBaseline] = useState(readSeq.current), [readReady, setReadReady] = useState(false)
  const [firstUnreadId, setFirstUnreadId] = useState<string>()
  const [awayFromBottom, setAwayFromBottom] = useState(false), [error, setError] = useState('')
  const [contextMessages, setContextMessages] = useState<RoomMessage[]>([])
  const [selectedId, setSelectedId] = useState<string>(), [pendingJump, setPendingJump] = useState<string>()
  const [contextBusy, setContextBusy] = useState(false)
  const lookup = useRef<AbortController | null>(null)
  const prepend = useRef<{ height: number; top: number; firstId?: string } | null>(null)
  const savedPosition = useRef<RoomTimelinePosition | null>(null)
  const searchPosition = useRef<RoomTimelinePosition | null>(null)
  const searchWasOpen = useRef(false)
  const restorePending = useRef<RoomTimelinePosition | null>(null)
  const rows = useMemo(() => mergeRoomMessages(contextMessages, messages), [contextMessages, messages])
  const messageById = useMemo(() => new Map(rows.map((message) => [message.id, message])), [rows])
  const virtual = rows.length > 40
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current,
    estimateSize: () => 160, overscan: 6, getItemKey: (index) => rows[index].id })
  const rendered = virtual ? virtualizer.getVirtualItems() : rows.map((row, index) => ({ key: row.id, index, start: 0, end: 0 }))
  const totalSize = virtualizer.getTotalSize()
  const latestSeq = messages.filter((message) => message.status !== 'streaming').at(-1)?.messageSeq ?? 0
  const newCount = messages.filter((message) => message.messageSeq > seenSeq.current && message.status !== 'streaming').length
  const unreadIndex = rows.findIndex((message) => message.id === firstUnreadId || (baseline > 0 && message.messageSeq > baseline))

  const loadContext = useCallback(async (id: string) => {
    lookup.current?.abort()
    const controller = new AbortController(); lookup.current = controller
    setContextBusy(true); setError(''); atBottom.current = false; setAwayFromBottom(true)
    try {
      const page = await roomsRequest<{ messages: RoomMessage[] }>(
        `${roomPath(room.id)}/messages/${encodeURIComponent(id)}/context`, 'GET', undefined, controller.signal)
      if (controller.signal.aborted) return
      if (!page.messages?.some((message) => message.id === id)) throw new Error(t('roomsMessageUnavailable', { defaultValue: 'Message is no longer available' }))
      setContextMessages((current) => mergeRoomMessages(current, page.messages))
      setSelectedId(id); setPendingJump(id)
    } catch (cause) { if (!controller.signal.aborted) setError(String(cause)) }
    finally { if (!controller.signal.aborted) setContextBusy(false) }
  }, [room.id, t])
  const jump = useCallback((id: string, surrounding = false) => {
    lookup.current?.abort(); setContextBusy(false)
    atBottom.current = false; setAwayFromBottom(true); setSelectedId(id)
    if (surrounding || !messageById.has(id)) void loadContext(id)
    else setPendingJump(id)
  }, [loadContext, messageById])

  useEffect(() => {
    const controller = new AbortController()
    try { savedPosition.current = JSON.parse(readBrowserStorageItem(`kun.rooms.anchor.${room.id}`) ?? 'null') } catch { /* legacy scroll below */ }
    void roomsRequest<{ seq?: number; firstUnreadMessageId?: string }>(`${roomPath(room.id)}/read`, 'GET', undefined, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        const seq = Math.max(readSeq.current, result.seq ?? 0)
        readSeq.current = seq; seenSeq.current = seq; setBaseline(seq)
        setFirstUnreadId(result.firstUnreadMessageId)
      }).catch(() => undefined).finally(() => { if (!controller.signal.aborted) setReadReady(true) })
    return () => { controller.abort(); lookup.current?.abort() }
  }, [room.id])
  const markRead = useCallback(() => {
    if (!readReady || searchOpen || contextBusy || pendingJump || !document.hasFocus() || !atBottom.current) return
    if (latestSeq <= readSeq.current || latestSeq <= readPending.current) return
    readPending.current = latestSeq
    void roomsRequest<{ seq?: number; result?: { seq: number } }>(`${roomPath(room.id)}/read`, 'POST',
      { seq: latestSeq, clientRequestId: roomRequestId() }).then((result) => {
      const confirmed = result.seq ?? result.result?.seq
      if (!Number.isSafeInteger(confirmed)) return
      readSeq.current = Math.max(readSeq.current, confirmed!)
      seenSeq.current = Math.max(seenSeq.current, confirmed!)
      writeBrowserStorageItem(`kun.rooms.read.${room.id}`, String(readSeq.current))
    }).catch(() => undefined).finally(() => { readPending.current = 0 })
  }, [readReady, searchOpen, contextBusy, pendingJump, latestSeq, room.id])
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    if (searchOpen && !searchWasOpen.current) {
      searchPosition.current = captureTimelinePosition(scroller, atBottom.current)
    } else if (!searchOpen && searchWasOpen.current && searchPosition.current) {
      const saved = searchPosition.current
      searchPosition.current = null
      lookup.current?.abort(); setContextBusy(false); setPendingJump(undefined)
      atBottom.current = saved.atBottom
      setAwayFromBottom(!saved.atBottom)
      restorePending.current = saved
      if (restoreTimelinePosition(scroller, saved)) restorePending.current = null
      else if (saved.messageId) jump(saved.messageId)
    }
    searchWasOpen.current = searchOpen
  }, [searchOpen, jump])
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !rowsRef.current) return
    const observer = new ResizeObserver(() => {
      if (atBottom.current && !searchOpen && !prepend.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    })
    observer.observe(rowsRef.current)
    return () => observer.disconnect()
  }, [searchOpen])
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || !readReady) return
    if (!initialized.current) {
      initialized.current = true
      const saved = savedPosition.current
      if (saved) {
        atBottom.current = saved.atBottom
        setAwayFromBottom(!saved.atBottom)
        if (!restoreTimelinePosition(scroller, saved) && saved.messageId) {
          restorePending.current = saved
          jump(saved.messageId)
        }
      } else if (firstUnreadId) jump(firstUnreadId)
      else {
        const top = readBrowserStorageItem(`kun.rooms.scroll.${room.id}`)
        scroller.scrollTop = top === null ? scroller.scrollHeight : Number(top) || 0
        atBottom.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80
        setAwayFromBottom(!atBottom.current)
      }
    }
    if (pendingJump) {
      const index = rows.findIndex((message) => message.id === pendingJump)
      if (index >= 0) {
        if (virtual) virtualizer.scrollToIndex(index, { align: 'center' })
        else document.getElementById('room-message-' + pendingJump)?.scrollIntoView({ block: 'center' })
        if (restorePending.current && restoreTimelinePosition(scroller, restorePending.current)) restorePending.current = null
        setPendingJump(undefined)
      }
    } else if (prepend.current && prepend.current.firstId !== messages[0]?.id) {
      scroller.scrollTop = prepend.current.top + scroller.scrollHeight - prepend.current.height
      prepend.current = null
    } else if (atBottom.current && !searchOpen && !contextBusy) scroller.scrollTop = scroller.scrollHeight
    if (restorePending.current && restoreTimelinePosition(scroller, restorePending.current)) restorePending.current = null
    markRead()
  }, [readReady, firstUnreadId, pendingJump, rows, messages, room.id, markRead, awayFromBottom, totalSize, virtual, virtualizer, jump, searchOpen, contextBusy])
  useEffect(() => {
    if (!jumpMessageId) return
    jump(jumpMessageId); onJumped()
  }, [jumpMessageId, jump, onJumped])
  const reply = (message: RoomMessage) => window.dispatchEvent(new CustomEvent('kun-room-reply', {
    detail: { roomId: room.id, messageId: message.id, body: message.body, rootRequestId: message.rootRequestId } }))
  const actions = useRef({ onRun, onReply, onReplyThread, reply, jump, onTask, onMember })
  actions.current = { onRun, onReply, onReplyThread, reply, jump, onTask, onMember }
  const stableActions = useMemo(() => ({ task: (id: string) => actions.current.onTask(id),
    member: (id: string, rootRequestId?: string) => actions.current.onMember?.(id, rootRequestId),
    run: (id: string) => actions.current.onRun?.(id),
    reply: (message: RoomMessage) => (actions.current.onReply ?? actions.current.reply)(message),
    thread: (message: RoomMessage) => actions.current.onReplyThread?.(message),
    viewReply: (id: string) => actions.current.jump(id)
  }), [])
  const renderMessage = (message: RoomMessage, continuation: boolean) => message.presentationKind === 'choice' && renderChoice
    ? renderChoice(message) : <StableMessageRow room={room} message={message} continuation={continuation}
      member={room.members.find((member) => member.id === message.authorMemberId)} task={tasks.find((task) => task.id === message.taskId)}
      referencedMessage={message.replyToMessageId ? messageById.get(message.replyToMessageId) : undefined}
      onOpenContent={onOpenContent} onHandoff={onHandoff} onRun={onRun ? stableActions.run : undefined}
      onReply={stableActions.reply} onThread={onReplyThread ? stableActions.thread : undefined} onPin={onPin}
      onTask={stableActions.task} onViewReply={stableActions.viewReply} onMember={onMember ? stableActions.member : undefined} />
  return <div className="rooms-timeline-layout">
    <div className="rooms-timeline">
      {error ? <p role="alert" className="rooms-message-error">{error}</p> : null}
      {contextBusy ? <p role="status" className="rooms-run-note">{t('roomsLoading')}</p> : null}
      {firstUnreadId && awayFromBottom ? <button type="button" className="rooms-first-unread" onClick={() => jump(firstUnreadId)}>
        {t('roomsFirstUnread', { defaultValue: 'Jump to first unread' })}</button> : null}
      <div ref={scrollRef} className="rooms-timeline-scroll" onScroll={(event) => {
        const element = event.currentTarget
        atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
        setAwayFromBottom(!atBottom.current)
        if (atBottom.current && !searchOpen) seenSeq.current = latestSeq
        writeBrowserStorageItem(`kun.rooms.scroll.${room.id}`, String(element.scrollTop))
        writeBrowserStorageItem(`kun.rooms.anchor.${room.id}`, JSON.stringify(captureTimelinePosition(element, atBottom.current)))
        markRead()
      }} onFocus={markRead}>
        {cursor ? <div className="rooms-timeline-older"><button className={roomButtonClass} disabled={moreBusy} onClick={() => {
          if (scrollRef.current) prepend.current = { height: scrollRef.current.scrollHeight, top: scrollRef.current.scrollTop, firstId: messages[0]?.id }
          void loadEarlier().catch((cause) => { prepend.current = null; setError(String(cause)) })
        }}>{t(moreBusy ? 'roomsLoading' : 'roomsOlder')}</button></div> : null}
        {!rows.length && !hideEmpty ? <p className="rooms-timeline-empty">{t('roomsNoMessages')}</p> : null}
        <div ref={rowsRef}><div style={virtual ? { paddingTop: rendered[0]?.start ?? 0,
          paddingBottom: Math.max(0, totalSize - (rendered.at(-1)?.end ?? 0)) } : undefined}>
          {rendered.map((row) => {
            const message = rows[row.index], layout = roomMessageLayout(rows[row.index - 1], message)
            return <div key={row.key} data-index={row.index} data-timeline-id={message.id}
              ref={virtual ? virtualizer.measureElement : undefined}
              className={`rooms-timeline-row${selectedId === message.id ? ' is-message-target' : ''}`}>
              {layout.newDay ? <div className="rooms-timeline-day" role="separator">
                {new Date(message.createdAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}</div> : null}
              {row.index === unreadIndex ? <div role="separator" className="rooms-unread-boundary">
                {t('roomsUnreadBoundary', { defaultValue: 'Unread messages' })}</div> : null}
              {renderMessage(message, layout.continuation)}
            </div>
          })}
        </div>{afterMessages}</div>
      </div>
      {awayFromBottom ? <button type="button" className="rooms-timeline-latest" aria-label={t('roomsLatestMessages')} onClick={() => {
        lookup.current?.abort(); setContextBusy(false); setPendingJump(undefined); restorePending.current = null
        atBottom.current = true; seenSeq.current = latestSeq; setAwayFromBottom(false)
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }}><ArrowDown size={14} aria-hidden="true" />{newCount
        ? t('roomsNewMessages', { count: newCount, defaultValue: '{{count}} new messages' }) : t('roomsLatestMessages')}</button> : null}
    </div>
    {searchOpen ? <RoomTimelineSearch roomId={room.id} selectedId={selectedId} onSelect={(message) => jump(message.id, true)}
      onClose={() => { lookup.current?.abort(); setContextBusy(false); setPendingJump(undefined); onSearchClose?.() }} /> : null}
  </div>
}

const StableMessageRow = memo(function StableMessageRow(props: Parameters<typeof RoomMessageRow>[0]) {
  return <RoomMessageRow {...props} />
}, (a, b) => a.message === b.message && a.room === b.room && a.member === b.member && a.task === b.task &&
  a.referencedMessage === b.referencedMessage && a.continuation === b.continuation && a.onPin === b.onPin && a.onTask === b.onTask &&
  a.onMember === b.onMember && a.onOpenContent === b.onOpenContent && a.onHandoff === b.onHandoff &&
  a.onReply === b.onReply && a.onThread === b.onThread && a.onRun === b.onRun && a.onViewReply === b.onViewReply)
