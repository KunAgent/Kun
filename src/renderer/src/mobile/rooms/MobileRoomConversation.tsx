import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RoomContentOpenTarget, RoomContentReference, RoomMessage, SendRoomMessage } from '@shared/rooms-api'
import { useRooms } from '../../components/rooms/useRooms'
import { RoomTimeline } from '../../components/rooms/RoomTimeline'
import { RoomComposer } from '../../components/rooms/RoomComposer'
import { RoomPendingSendRow } from '../../components/rooms/RoomPendingSendRow'
import { useRoomPendingSends } from '../../components/rooms/useRoomPendingSends'
import { roomsClient } from '../../components/rooms/rooms-client'
import { RoomNoticeDismiss, useDirectChat } from '../../components/rooms/RoomDirectChat'
import { RoomContentPreview } from '../../components/rooms/RoomContentPreview'
import { MobileSheet } from '../sheets/MobileSheet'
import { MobileRoomPendingActions } from './MobileRoomPendingActions'
import { useMessageActionReveal } from './use-message-action-reveal'
import { MobileRoomActivityBubble, directActivityLabelKey, groupActivity } from './MobileRoomAgentActivity'
import { useRoomReplyAwaiting } from '../../components/rooms/use-room-reply-awaiting'
import { useRoomTopics } from '../../components/rooms/useRoomTopics'
import { roomRespondingMemberIds, roomWaitingMemberIds } from '../../components/rooms/room-receipt-helpers'
import { MobileChatSkeleton } from '../lib/MobileLoading'
import './mobile-room-conversation.css'

type MobileRoomConversationProps = {
  roomId: string
  onBack: () => void
  onDetails: (() => void) | null
  onReply: (message: RoomMessage) => void
  onTask: (taskId: string) => void
  onRun: (runId: string) => void
  onOpenTarget: (target: RoomContentOpenTarget) => void | Promise<void>
}

export function MobileRoomConversation(props: MobileRoomConversationProps) {
  const { t } = useTranslation('common')
  const state = useRooms('group', false)
  const [content, setContent] = useState<{ reference: RoomContentReference; messageId?: string } | null>(null)
  const [dismissedError, setDismissedError] = useState('')
  const messageActions = useMessageActionReveal()
  const room = state.room
  const direct = useDirectChat(room, state.refresh)
  const steeredIds = useMemo(() => new Set(
    (direct.data?.requests ?? [])
      .filter((entry) => entry.steer && ['pending', 'running', 'stopping'].includes(entry.status))
      .map((entry) => entry.clientRequestId)
      .filter((id): id is string => Boolean(id))
  ), [direct.data?.requests])
  const pending = useRoomPendingSends(state.room?.id, state.messages, steeredIds)
  const topicState = useRoomTopics(room?.conversationKind === 'group' ? room.id : '')
  const typingIds = useMemo(() => roomRespondingMemberIds(topicState.topics), [topicState.topics])
  const waitingIds = useMemo(() => roomWaitingMemberIds(topicState.topics), [topicState.topics])
  const awaiting = useRoomReplyAwaiting(Boolean(direct.data?.active) || typingIds.length > 0, state.messages)
  const waitingForReply = awaiting.awaiting || pending.pending.some((item) => item.state !== 'failed')
  const directKey = room?.conversationKind === 'user_agent' ? directActivityLabelKey(direct.data, waitingForReply) : null
  const activity = !room ? null : directKey ? { label: t(directKey), memberId: undefined }
    : room.conversationKind === 'group' ? groupActivity(room, typingIds, waitingIds, waitingForReply, t) : null
  const { select: selectRoom, selectedId } = state
  useEffect(() => {
    if (selectedId !== props.roomId) selectRoom(props.roomId)
  }, [props.roomId, selectRoom, selectedId])
  useEffect(() => setDismissedError(''), [props.roomId])
  const send = async (message: SendRoomMessage): Promise<void> => {
    if (!room) return
    pending.enqueue(message)
    try {
      await roomsClient.send(room.id, message)
      pending.markSent(message.clientRequestId)
      awaiting.markSent()
      if (room.conversationKind === 'user_agent') direct.refresh()
      else void topicState.refresh()
    } catch (error) {
      pending.markFailed(message.clientRequestId, error instanceof Error ? error.message : String(error))
      throw error
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
  const activeMembers = room?.members.filter((member) => !member.removedAt).length ?? 0
  const conversationKind = room?.conversationKind ?? 'group'
  const subtitle = !room ? '' : conversationKind === 'group'
    ? `${t('agentsConversation_group')} · ${activeMembers}`
    : t(`agentsConversation_${conversationKind}`)
  return <section className="kun-mobile-room-conversation" data-kind={room?.conversationKind} {...messageActions}>
    <header>
      <button type="button" aria-label={t('back')} onClick={props.onBack}><ArrowLeft aria-hidden /></button>
      <div><h1>{room?.name ?? t('roomsLoading')}</h1>
        {subtitle ? <p>{subtitle}</p> : null}</div>
      {props.onDetails ? <button type="button" aria-label={t('mobileMore')} onClick={props.onDetails}><MoreHorizontal aria-hidden /></button> : <span aria-hidden />}
    </header>
    {state.error && state.error !== dismissedError ? <p className="kun-mobile-room-error kun-mobile-room-notice" role="alert"><span>{state.error}</span><RoomNoticeDismiss onDismiss={() => setDismissedError(state.error)} /></p> : null}
    {state.loading || !room ? <MobileChatSkeleton label={t('roomsLoading')} /> : <>
      <RoomTimeline room={room} messages={state.messages} tasks={state.tasks}
        cursor={state.messageCursor} moreBusy={state.moreBusy} loadEarlier={state.loadEarlier}
        onPin={(message) => { void pin(message) }} onTask={props.onTask} jumpMessageId={null} onJumped={() => undefined}
        onRun={props.onRun} onReply={props.onReply}
        onOpenContent={(reference, messageId) => setContent({ reference, messageId })}
        afterMessages={<>
          {pending.pending.map((item) => <RoomPendingSendRow key={item.clientRequestId}
            item={item} onRetry={retry} onDismiss={pending.dismiss} />)}
          {activity ? <MobileRoomActivityBubble room={room} memberId={activity.memberId} label={activity.label} /> : null}
        </>} />
      {room.conversationKind === 'user_agent' ? <MobileRoomPendingActions key={room.id} direct={direct} onUpdated={state.refresh} /> : null}
      {room.conversationKind === 'agent_agent' ? <p className="kun-mobile-room-readonly">{t('agentsPairReadOnly')}</p> :
        <RoomComposer room={room} tasks={state.tasks} onSend={send} autoFocus={false}
          responding={Boolean(direct.data?.active)} onStop={() => void direct.act('stop')} />}
    </>}
    <MobileSheet open={Boolean(content)} title={content?.reference.titleSnapshot ?? t('roomsContent')}
      closeLabel={t('close')} onClose={() => setContent(null)}>
      {room && content ? <RoomContentPreview room={room} reference={content.reference}
        messageId={content.messageId} onOpenTarget={props.onOpenTarget} /> : null}
    </MobileSheet>
  </section>
}
