import { RoomPopover } from './RoomPopover'
import { useLayoutEffect, useState } from 'react'
import { ArrowUpRight, BellRing, Check, Copy, MoreHorizontal, Pin, Reply } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Room, RoomContentReference, RoomMember, RoomMessage, RoomTask } from '@shared/rooms-api'
import { RoomAvatar } from './RoomAvatar'
import { RoomEmojiPicker } from './RoomEmojiPicker'
import { RoomMessageBody } from './RoomMessageBody'
import { RoomMessageRunButton } from './RoomMessageRunButton'
import { RoomMessageInteractions } from './RoomMessageInteractions'
import { RoomProposalCard } from './RoomProposalCard'
import { RoomAppConnectionCard } from './RoomAppConnectionCard'
import { RoomWorkbenchTaskCard } from './RoomWorkbenchTaskCard'
import { roomPath, roomRequestId, roomsRequest } from './rooms-client'
import './rooms-reminders.css'
import { noteRoomMessageRendered } from './room-im-response-metrics'

const roles = {
  coordinator: 'roomsCoordinator',
  developer: 'roomsDeveloper',
  reviewer: 'roomsReviewer',
  diagnostician: 'roomsDiagnostician'
} as const

export function RoomMessageRow({
  message,
  room,
  idPrefix = 'room-message',
  member,
  task,
  referencedMessage,
  onReply,
  onThread,
  onPin,
  onTask,
  onViewReply,
  onMember,
  onRun,
  onHandoff,
  onOpenContent,
  continuation = false
}: {
  message: RoomMessage
  room?: Room
  idPrefix?: string
  member?: RoomMember
  task?: RoomTask
  referencedMessage?: RoomMessage
  onReply: (message: RoomMessage) => void
  onThread?: (message: RoomMessage) => void
  onPin: (message: RoomMessage) => void | Promise<boolean>
  onTask: (id: string) => void
  onViewReply: (id: string) => void
  onMember?: (id: string, rootRequestId?: string) => void
  onRun?: (id: string) => void
  onHandoff?: (id: string) => void
  onOpenContent?: (reference: RoomContentReference, messageId?: string) => void
  continuation?: boolean
}) {
  const { t } = useTranslation('common')
  useLayoutEffect(() => { noteRoomMessageRendered(message) }, [message])
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const [reactBusy, setReactBusy] = useState(false)
  const [pinBusy, setPinBusy] = useState(false), [pinned, setPinned] = useState(false)
  const pin = async () => {
    if (pinBusy) return
    setPinBusy(true); setCopyError('')
    try { if (await onPin(message) === true) setPinned(true) }
    catch (cause) { setCopyError(String(cause)) }
    finally { setPinBusy(false) }
  }
  const system = message.authorKind === 'system'
  const progressPrefix = message.taskId ? `progress-${message.taskId}-` : ''
  const legacyTaskProgress = Boolean(message.taskId &&
    message.id.startsWith(progressPrefix) &&
    /^(0|[1-9]\d*)$/.test(message.id.slice(progressPrefix.length)))
  const canInspectRun = Boolean(message.originRunId ||
    (message.authorKind === 'member' && !message.handoffId && (!message.taskId || legacyTaskProgress)))
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.body)
      setCopied(true)
      setCopyError('')
    } catch (cause) {
      setCopyError(String(cause))
    }
  }
  const sendReaction = async (emoji: string) => {
    if (!room) return
    setReactBusy(true)
    try {
      await roomsRequest(`${roomPath(room.id)}/messages/${encodeURIComponent(message.id)}/reactions`, 'PUT',
        { clientRequestId: roomRequestId(), emoji, active: true })
    } catch (cause) {
      setCopyError(String(cause))
    } finally {
      setReactBusy(false)
    }
  }
  return (
    <article
      id={idPrefix + '-' + message.id}
      data-room-message-id={message.id}
      tabIndex={0}
      onContextMenu={(event) => {
        event.preventDefault()
        event.currentTarget.querySelector<HTMLButtonElement>('.rooms-message-more')?.click()
      }}
      onKeyDown={(event) => {
        if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
          event.preventDefault()
          event.currentTarget.querySelector<HTMLButtonElement>('.rooms-message-more')?.click()
        }
      }}
      className={`rooms-message-row rooms-message-${message.authorKind}${continuation ? ' rooms-message-continuation' : ''}`}
    >
      {continuation ? <span className="rooms-message-avatar-spacer" aria-hidden="true" /> : !system ? (
        <RoomAvatar
          member={member}
          id={message.authorMemberId ?? message.authorKind}
          label={message.authorLabelSnapshot}
          onClick={
            message.authorMemberId && member && !member.removedAt && onMember
              ? () => onMember(message.authorMemberId!, message.rootRequestId)
              : undefined
          }
        />
      ) : null}
      <div className="rooms-message-content">
        <div className="rooms-message-meta">
          <strong>{message.authorLabelSnapshot}</strong>
          {member && !system ? (
            <span className="rooms-message-role">{member.agentTitle || t(roles[member.role])}</span>
          ) : null}
          <time
            dateTime={message.createdAt}
            title={new Date(message.createdAt).toLocaleString()}
          >
            {new Date(message.createdAt).toLocaleTimeString([], {
              hourCycle: 'h23',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </time>
        </div>
        <div
          className={`rooms-message-bubble${message.attachmentIds.length ? ' rooms-message-wide' : ''}`}
        >
          {message.replyToMessageId ? (
            <button
              type="button"
              className="rooms-message-reference"
              onClick={() => onViewReply(message.replyToMessageId!)}
              aria-label={t('roomsViewReply')}
            >
              <Reply size={13} aria-hidden="true" />
              <span>
                <strong>
                  {referencedMessage?.authorLabelSnapshot ??
                    t('roomsReferencedMessage')}
                </strong>
                <span>
                  {referencedMessage?.body.replace(/\s+/g, ' ').slice(0, 160) ||
                    t('roomsViewReply')}
                </span>
              </span>
            </button>
          ) : null}
          {message.presentationKind !== 'poll' && message.presentationKind !== 'reminder' && message.presentationKind !== 'app_connection' && (message.presentationKind !== 'workbench_task' || !room) && (message.presentationKind !== 'proposal' || !room) ? <RoomMessageBody
            room={room}
            publicMessage={message.status !== 'streaming'}
            messageId={message.id}
            references={message.references}
            onOpenContent={onOpenContent}
            onMember={onMember ? (id) => onMember(id, message.rootRequestId) : undefined}
            body={message.body}
            collapsible={message.authorKind === 'member' && message.status !== 'streaming'}
            attachmentIds={message.attachmentIds}
          /> : null}
          {message.presentationKind === 'reminder' ? <div className="rooms-reminder-fired" role="note"
            aria-label={t('roomsReminderFired')}>
            <BellRing size={15} aria-hidden="true" />
            <div>
              <strong>{t('roomsReminderFired')}</strong>
              <p>{message.body}</p>
            </div>
          </div> : null}
          {room && message.presentationKind === 'proposal' ? <RoomProposalCard room={room} message={message} /> : null}
          {room && message.presentationKind === 'app_connection' ? <RoomAppConnectionCard message={message} /> : null}
          {room && message.presentationKind === 'workbench_task' ? <RoomWorkbenchTaskCard room={room} message={message} /> : null}
          {room ? <RoomMessageInteractions room={room} message={message} onMember={onMember ? (id) => onMember(id, message.rootRequestId) : undefined} /> : null}
        </div>
        <div className="rooms-message-footer">
          {message.handoffId && onHandoff ? <button type="button" className="rooms-run-link" onClick={() => onHandoff(message.handoffId!)}>{t('agentsViewHandoff')}</button> : null}
          {message.replyCount ? <button type="button" className="rooms-reply-count" onClick={() => (onThread ?? onReply)(message)}><Reply size={13} />{t('roomsReplyCount', { count: message.replyCount })}</button> : null}
          {message.taskId ? (
            <button
              type="button"
              className="rooms-message-task"
              onClick={() => onTask(message.taskId!)}
            >
              <ArrowUpRight size={13} aria-hidden="true" />
              <span>{task?.title ?? t('roomsDetails')}</span>
            </button>
          ) : null}
          {continuation ? <time className="rooms-message-continuation-time" dateTime={message.createdAt}
            title={new Date(message.createdAt).toLocaleString()}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}</time> : null}
          <div className="rooms-message-actions" role="toolbar" aria-label={t('roomsMoreActions')}>
            {room ? <RoomEmojiPicker reactions disabled={reactBusy || Boolean(room.archivedAt)} onChoose={(emoji) => void sendReaction(emoji)} /> : null}
            <button
              type="button"
              disabled={room?.conversationKind === 'agent_agent'}
              title={t('roomsReply')}
              aria-label={t('roomsReply')}
              onClick={() => onReply(message)}
            >
              <Reply size={14} />
            </button>
            <button
              type="button"
              title={t(copied ? 'roomsCopiedMessage' : 'roomsCopyMessage')}
              aria-label={t(copied ? 'roomsCopiedMessage' : 'roomsCopyMessage')}
              onClick={() => void copy()}
              onBlur={() => setCopied(false)}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            <RoomPopover label={t('roomsMoreActions')} trigger={<MoreHorizontal size={14} />} className="rooms-message-more" align="end" width={230}>
              {(close) => <div className="rooms-menu-list">
                {onThread ? <button type="button" onClick={() => { close(); onThread(message) }}><Reply size={15} />{t('roomsOpenDiscussionThread')}</button> : null}
                <button type="button" disabled={pinBusy || pinned} onClick={() => { close(); void pin() }}><Pin size={15} />{t(pinned ? 'roomsPinnedAsRule' : 'roomsPinMessage')}</button>
                {onRun && canInspectRun ? <RoomMessageRunButton message={message} onRun={(id) => { close(); onRun(id) }} /> : null}
              </div>}
            </RoomPopover>
          </div>
        </div>
        {pinned ? <p role="status" className="rooms-message-feedback">{t('roomsPinnedAsRule')}</p> : null}
        {copyError ? (
          <p role="alert" className="rooms-message-error">
            {copyError}
          </p>
        ) : null}
      </div>
    </article>
  )
}
