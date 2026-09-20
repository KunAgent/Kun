import { ArrowLeft } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { SendRoomMessage } from '@shared/rooms-api'
import { useRooms } from '../../components/rooms/useRooms'
import { roomsClient } from '../../components/rooms/rooms-client'
import { RoomReplyThread } from '../../components/rooms/RoomReplyThread'
import { RoomDrawerTask } from '../../components/rooms/RoomDrawerTask'
import { RoomRunInspector } from '../../components/rooms/RoomRunInspector'
import { RoomMemberDetails } from '../../components/rooms/RoomMemberDetails'
import type { MobilePage } from '../navigation/mobile-page'
import './mobile-room-detail.css'

export function MobileRoomDetail({ page, onBack, onOpenCode, onNavigate }: {
  page: Extract<MobilePage, { mode: 'rooms'; kind: 'reply' | 'run' | 'task' | 'member' }>
  onBack: () => void
  onOpenCode: (threadId: string) => void | Promise<void>
  onNavigate: (page: MobilePage) => void
}) {
  const { t } = useTranslation('common')
  const state = useRooms('group', false)
  const { select, selectedId } = state
  useEffect(() => { if (selectedId !== page.roomId) select(page.roomId) }, [page.roomId, select, selectedId])
  const room = state.room
  const send = async (message: SendRoomMessage): Promise<void> => {
    if (!room) return
    await roomsClient.send(room.id, message)
    await state.refresh()
  }
  return <section className="kun-mobile-room-detail">
    <header><button type="button" aria-label={t('back')} onClick={onBack}><ArrowLeft aria-hidden /></button>
      <h1>{page.kind}</h1></header>
    {state.error ? <p role="alert">{state.error}</p> : null}
    {!room || state.loading ? <p role="status">{t('roomsLoading')}</p> : page.kind === 'reply' ?
      <RoomReplyThread room={room} messageId={page.messageId} tasks={state.tasks} autoFocus={false}
        onSend={send} onPin={() => undefined}
        onTask={(taskId) => onNavigate({ mode: 'rooms', kind: 'task', roomId: room.id, taskId })}
        onRun={(runId) => onNavigate({ mode: 'rooms', kind: 'run', roomId: room.id, runId })}
        onMember={(memberId) => onNavigate({ mode: 'rooms', kind: 'member', roomId: room.id, memberId })}
        onOpenContent={() => undefined} />
      : page.kind === 'task' ? <RoomDrawerTask roomId={room.id} taskId={page.taskId} tasks={state.tasks}
          onClose={onBack}
          onRun={(runId) => onNavigate({ mode: 'rooms', kind: 'run', roomId: room.id, runId })}
          onOpenThread={onOpenCode} onUpdated={() => void state.refresh()} />
      : page.kind === 'run' ? <RoomRunInspector roomId={room.id} runId={page.runId} onOpenThread={onOpenCode} />
      : <RoomMemberDetails room={room} selectedMemberId={page.memberId}
          onSelectMember={(memberId) => onNavigate({ mode: 'rooms', kind: 'member', roomId: room.id, memberId })}
          onRun={(runId) => onNavigate({ mode: 'rooms', kind: 'run', roomId: room.id, runId })}
          onUpdated={() => void state.refresh()} />}
  </section>
}
