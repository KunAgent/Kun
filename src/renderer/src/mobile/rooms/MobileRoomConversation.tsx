import { useEffect } from 'react'
import { ArrowLeft, MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RoomMessage, SendRoomMessage } from '@shared/rooms-api'
import { useRooms } from '../../components/rooms/useRooms'
import { RoomStreamingTimeline } from '../../components/rooms/RoomStreamingTimeline'
import { RoomComposer } from '../../components/rooms/RoomComposer'
import { RoomPendingSendRow } from '../../components/rooms/RoomPendingSendRow'
import { useRoomPendingSends } from '../../components/rooms/useRoomPendingSends'
import { roomsClient } from '../../components/rooms/rooms-client'
import './mobile-room-conversation.css'

type MobileRoomConversationProps = {
  roomId: string
  onBack: () => void
  onDetails: () => void
  onReply: (message: RoomMessage) => void
  onTask: (taskId: string) => void
  onRun: (runId: string) => void
}

export function MobileRoomConversation(props: MobileRoomConversationProps) {
  const { t } = useTranslation('common')
  const state = useRooms('group', false)
  const pending = useRoomPendingSends(state.room?.id, state.messages)
  const room = state.room
  const { select: selectRoom, selectedId } = state
  useEffect(() => {
    if (selectedId !== props.roomId) selectRoom(props.roomId)
  }, [props.roomId, selectRoom, selectedId])
  const send = async (message: SendRoomMessage): Promise<void> => {
    if (!room) return
    pending.enqueue(message)
    try {
      await roomsClient.send(room.id, message)
      pending.markSent(message.clientRequestId)
    } catch (error) {
      pending.markFailed(message.clientRequestId, error instanceof Error ? error.message : String(error))
      throw error
    }
    await state.refresh()
  }
  const retry = (id: string): void => {
    const message = pending.retry(id)
    if (message) void send(message).catch(() => undefined)
  }
  return <section className="kun-mobile-room-conversation">
    <header>
      <button type="button" aria-label={t('back')} onClick={props.onBack}><ArrowLeft aria-hidden /></button>
      <div><h1>{room?.name ?? t('roomsLoading')}</h1>
        <p>{room?.conversationKind === 'user_agent' ? t('agentsConversation_user_agent') : room?.members.length ?? ''}</p></div>
      <button type="button" aria-label={t('more')} onClick={props.onDetails}><MoreHorizontal aria-hidden /></button>
    </header>
    {state.error ? <p className="kun-mobile-room-error" role="alert">{state.error}</p> : null}
    {state.loading || !room ? <p className="kun-mobile-room-loading" role="status">{t('roomsLoading')}</p> : <>
      <RoomStreamingTimeline room={room} messages={state.messages} tasks={state.tasks}
        cursor={state.messageCursor} moreBusy={state.moreBusy} loadEarlier={state.loadEarlier}
        onPin={() => undefined} onTask={props.onTask} jumpMessageId={null} onJumped={() => undefined}
        onRun={props.onRun} onReplyThread={props.onReply}
        afterMessages={pending.pending.map((item) => <RoomPendingSendRow key={item.clientRequestId}
          item={item} onRetry={retry} onDismiss={pending.dismiss} />)} />
      {room.conversationKind === 'agent_agent' ? <p className="kun-mobile-room-readonly">{t('agentsPairReadOnly')}</p> :
        <RoomComposer room={room} tasks={state.tasks} onSend={send} autoFocus={false} />}
    </>}
  </section>
}
