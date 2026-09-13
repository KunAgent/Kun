import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Room, RoomContentReference, RoomMessage, RoomTask, SendRoomMessage } from '@shared/rooms-api'
import { RoomComposer } from './RoomComposer'
import { RoomMessageRow } from './RoomMessageRow'
import { useRoomReplyThread } from './useRoomReplyThread'
import { roomPath, roomsRequest } from './rooms-client'
import './rooms-replies.css'

export function RoomReplyThread({ room, messageId, tasks, active = true, onSend, onPin, onTask, onRun, onMember, onOpenContent }: {
  room: Room; messageId: string; tasks: RoomTask[]; active?: boolean
  onSend: (message: SendRoomMessage) => Promise<void>
  onPin: (message: RoomMessage) => void; onTask: (id: string) => void; onRun: (id: string) => void
  onMember: (id: string, rootRequestId?: string) => void
  onOpenContent: (reference: RoomContentReference, messageId?: string) => void
}) {
  const { t } = useTranslation('common')
  const state = useRoomReplyThread(room.id, messageId, active)
  const [replyTarget, setReplyTarget] = useState<RoomMessage | null>(null)
  const [jumpId, setJumpId] = useState<string | null>(null)
  const [jumpError, setJumpError] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(false)
  const anchor = useRef<{ height: number; top: number; firstId?: string } | null>(null)
  const lookup = useRef<AbortController | null>(null)
  const prefix = 'room-reply-' + useId().replace(/[^A-Za-z0-9_-]/g, '')
  const root = state.page?.root
  const byId = useMemo(() => new Map([...(root ? [root] : []), ...state.messages].map((item) => [item.id, item])), [root, state.messages])
  useEffect(() => () => lookup.current?.abort(), [])
  useLayoutEffect(() => {
    if (!active || !scroller.current) return
    if (jumpId) {
      scroller.current.querySelector<HTMLElement>(`[data-room-message-id="${jumpId}"]`)?.scrollIntoView({ block: 'nearest' })
      setJumpId(null)
    } else if (anchor.current && anchor.current.firstId !== state.messages[0]?.id) {
      scroller.current.scrollTop = anchor.current.top + scroller.current.scrollHeight - anchor.current.height
      anchor.current = null
    } else if (atBottom.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [active, jumpId, state.messages])
  const viewReply = async (id: string) => {
    setJumpError('')
    atBottom.current = false
    if (byId.has(id)) { setJumpId(id); return }
    lookup.current?.abort()
    const controller = new AbortController()
    lookup.current = controller
    try {
      const target = await roomsRequest<{ message: RoomMessage }>(`${roomPath(room.id)}/messages/${encodeURIComponent(id)}`, 'GET', undefined, controller.signal)
      if (controller.signal.aborted) return
      const resolved = await roomsRequest<import('@shared/rooms-api').RoomReplyPage>(`${roomPath(room.id)}/replies/${encodeURIComponent(id)}?limit=1`, 'GET', undefined, controller.signal)
      if (controller.signal.aborted) return
      if (!root || resolved.root?.id !== root.id) throw new Error(t('roomsReplyOutsideThread'))
      state.insert(target.message); setJumpId(id)
    } catch (cause) { if (!controller.signal.aborted) setJumpError(String(cause)) }
  }
  const render = (message: RoomMessage) => <RoomMessageRow key={message.id} room={room} idPrefix={prefix} message={message}
    member={room.members.find((member) => member.id === message.authorMemberId)} task={tasks.find((task) => task.id === message.taskId)}
    referencedMessage={message.replyToMessageId ? byId.get(message.replyToMessageId) : undefined}
    onReply={setReplyTarget} onPin={onPin} onTask={onTask} onRun={onRun} onMember={onMember}
    onViewReply={(id) => void viewReply(id)} onOpenContent={onOpenContent} />
  const target = replyTarget ?? root
  return <section className="rooms-reply-thread" aria-label={t('roomsReplyThreadTitle')} data-display-thread-root-id={root?.id}>
    <div ref={scroller} className="rooms-reply-scroll" onScroll={(event) => {
      atBottom.current = event.currentTarget.scrollHeight - event.currentTarget.scrollTop - event.currentTarget.clientHeight < 80
    }}>
      {state.loading ? <p className="rooms-run-note">{t('roomsLoading')}</p> : null}
      {state.page?.unavailableReason ? <p className="rooms-reply-warning" role="status">{t(`roomsReplyUnavailable_${state.page.unavailableReason}`, { defaultValue: state.page.unavailableReason })}</p> : null}
      {root ? <div className="rooms-reply-root">{render(root)}</div> : null}
      {root ? <div className="rooms-reply-heading"><span>{t('roomsReplyCount', { count: state.page?.total ?? 0 })}</span>
        {state.hasEarlier ? <button type="button" className="rooms-run-secondary" disabled={state.moreBusy} onClick={() => {
          if (scroller.current) anchor.current = { height: scroller.current.scrollHeight, top: scroller.current.scrollTop, firstId: state.messages[0]?.id }
          void state.loadEarlier()
        }}>{t(state.moreBusy ? 'roomsLoading' : 'roomsOlder')}</button> : null}
      </div> : null}
      {state.messages.map(render)}
      {state.error || jumpError ? <p className="rooms-message-error" role="alert">{state.error || jumpError}</p> : null}
      {state.error ? <button type="button" className="rooms-run-secondary" onClick={() => void state.refresh()}>{t('roomsRefresh')}</button> : null}
    </div>
    {root && target ? <RoomComposer room={room} tasks={tasks} draftId={`reply:${room.id}:${root.id}`}
      replyTarget={{ messageId: target.id, body: target.body, rootRequestId: target.rootRequestId }}
      onSend={async (input) => {
        await onSend({ ...input, replyToMessageId: input.replyToMessageId ?? target.id })
        await state.refresh()
        setReplyTarget(null)
      }} /> : null}
  </section>
}
