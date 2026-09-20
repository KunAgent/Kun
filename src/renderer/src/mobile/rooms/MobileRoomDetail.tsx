import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomContentOpenTarget, RoomContentReference, RoomMessage, SendRoomMessage } from '@shared/rooms-api'
import { useRooms } from '../../components/rooms/useRooms'
import { roomsClient } from '../../components/rooms/rooms-client'
import { RoomReplyThread } from '../../components/rooms/RoomReplyThread'
import { RoomDrawerTask } from '../../components/rooms/RoomDrawerTask'
import { RoomRunInspector } from '../../components/rooms/RoomRunInspector'
import { RoomMemberDetails } from '../../components/rooms/RoomMemberDetails'
import { useRoomPendingSends } from '../../components/rooms/useRoomPendingSends'
import { RoomPendingSendRow } from '../../components/rooms/RoomPendingSendRow'
import { RoomContentPreview } from '../../components/rooms/RoomContentPreview'
import { MobileSheet } from '../sheets/MobileSheet'
import type { MobilePage } from '../navigation/mobile-page'
import './mobile-room-detail.css'

export function MobileRoomDetail({ page, onBack, onOpenCode, onNavigate, onOpenTarget }: {
  page: Extract<MobilePage, { mode: 'rooms'; kind: 'reply' | 'run' | 'task' | 'member' }>
  onBack: () => void
  onOpenCode: (threadId: string) => void | Promise<void>
  onNavigate: (page: MobilePage) => void
  onOpenTarget: (target: RoomContentOpenTarget) => void | Promise<void>
}) {
  const { t } = useTranslation('common')
  const state = useRooms('group', false)
  const pending = useRoomPendingSends(state.room?.id, state.messages)
  const [content, setContent] = useState<{ reference: RoomContentReference; messageId?: string } | null>(null)
  const { select, selectedId } = state
  useEffect(() => { if (selectedId !== page.roomId) select(page.roomId) }, [page.roomId, select, selectedId])
  const room = state.room
  const send = async (message: SendRoomMessage): Promise<void> => {
    if (!room) return
    pending.enqueue(message)
    try {
      await roomsClient.send(room.id, message)
      pending.markSent(message.clientRequestId)
    } catch (cause) {
      pending.markFailed(message.clientRequestId, cause instanceof Error ? cause.message : String(cause))
      throw cause
    }
    await state.refresh()
  }
  const pin = async (message: RoomMessage): Promise<void> => {
    if (!room) return
    await roomsClient.pinMessage(room.id, message.id, `pin-${message.id}`)
    await state.refresh()
  }
  const retry = (id: string): void => {
    const message = pending.retry(id)
    if (message) void send(message).catch(() => undefined)
  }
  return <section className="kun-mobile-room-detail">
    <header><button type="button" aria-label={t('back')} onClick={onBack}><ArrowLeft aria-hidden /></button>
      <h1>{page.kind}</h1></header>
    {state.error ? <p role="alert">{state.error}</p> : null}
    {!room || state.loading ? <p role="status">{t('roomsLoading')}</p> : page.kind === 'reply' ?
      <RoomReplyThread room={room} messageId={page.messageId} tasks={state.tasks} autoFocus={false}
        onSend={send} onPin={(message) => { void pin(message) }}
        onTask={(taskId) => onNavigate({ mode: 'rooms', kind: 'task', roomId: room.id, taskId })}
        onRun={(runId) => onNavigate({ mode: 'rooms', kind: 'run', roomId: room.id, runId })}
        onMember={(memberId) => onNavigate({ mode: 'rooms', kind: 'member', roomId: room.id, memberId })}
        onOpenContent={(reference, messageId) => setContent({ reference, messageId })} />
      : page.kind === 'task' ? <RoomDrawerTask roomId={room.id} taskId={page.taskId} tasks={state.tasks}
          onClose={onBack}
          onRun={(runId) => onNavigate({ mode: 'rooms', kind: 'run', roomId: room.id, runId })}
          onOpenThread={onOpenCode} onUpdated={() => void state.refresh()} />
      : page.kind === 'run' ? <RoomRunInspector roomId={room.id} runId={page.runId} onOpenThread={onOpenCode} />
      : <RoomMemberDetails room={room} selectedMemberId={page.memberId}
          onSelectMember={(memberId) => onNavigate({ mode: 'rooms', kind: 'member', roomId: room.id, memberId })}
          onRun={(runId) => onNavigate({ mode: 'rooms', kind: 'run', roomId: room.id, runId })}
          onUpdated={() => void state.refresh()} />}
    {pending.pending.map((item) => <RoomPendingSendRow key={item.clientRequestId} item={item}
      onRetry={retry} onDismiss={pending.dismiss} />)}
    <MobileSheet open={Boolean(content)} title={content?.reference.titleSnapshot ?? t('roomsContent')}
      closeLabel={t('close')} onClose={() => setContent(null)}>
      {room && content ? <RoomContentPreview room={room} reference={content.reference}
        messageId={content.messageId} onOpenTarget={onOpenTarget} /> : null}
    </MobileSheet>
  </section>
}
