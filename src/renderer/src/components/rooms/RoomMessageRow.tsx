import { useState } from 'react'
import { ArrowUpRight, Check, Copy, Pin, Reply } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RoomMember, RoomMessage, RoomTask } from '@shared/rooms-api'
import { RoomAvatar } from './RoomAvatar'
import { RoomMessageBody } from './RoomMessageBody'
import { RoomMessageRunButton } from './RoomMessageRunButton'

const roles = {
  coordinator: 'roomsCoordinator',
  developer: 'roomsDeveloper',
  reviewer: 'roomsReviewer',
  diagnostician: 'roomsDiagnostician'
} as const

export function RoomMessageRow({
  message,
  member,
  task,
  referencedMessage,
  onReply,
  onPin,
  onTask,
  onViewReply,
  onMember,
  onRun
}: {
  message: RoomMessage
  member?: RoomMember
  task?: RoomTask
  referencedMessage?: RoomMessage
  onReply: (message: RoomMessage) => void
  onPin: (message: RoomMessage) => void
  onTask: (id: string) => void
  onViewReply: (id: string) => void
  onMember?: (id: string, rootRequestId?: string) => void
  onRun?: (id: string) => void
}) {
  const { t } = useTranslation('common')
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const system = message.authorKind === 'system'
  const progressPrefix = message.taskId ? `progress-${message.taskId}-` : ''
  const legacyTaskProgress = Boolean(message.taskId &&
    message.id.startsWith(progressPrefix) &&
    /^(0|[1-9]\d*)$/.test(message.id.slice(progressPrefix.length)))
  const canInspectRun = Boolean(message.originRunId ||
    (message.authorKind === 'member' && (!message.taskId || legacyTaskProgress)))
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.body)
      setCopied(true)
      setCopyError('')
    } catch (cause) {
      setCopyError(String(cause))
    }
  }
  return (
    <article
      id={'room-message-' + message.id}
      className={`rooms-message-row rooms-message-${message.authorKind}`}
    >
      {!system ? (
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
            <span className="rooms-message-role">{t(roles[member.role])}</span>
          ) : null}
          <time
            dateTime={message.createdAt}
            title={new Date(message.createdAt).toLocaleString()}
          >
            {new Date(message.createdAt).toLocaleString([], {
              month: 'short',
              day: 'numeric',
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
          <RoomMessageBody
            body={message.body}
            attachmentIds={message.attachmentIds}
          />
        </div>
        <div className="rooms-message-footer">
          {onRun && canInspectRun ? <RoomMessageRunButton message={message} onRun={onRun} /> : null}
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
          <div className="rooms-message-actions">
            <button
              type="button"
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
            <button
              type="button"
              title={t('roomsPinMessage')}
              aria-label={t('roomsPinMessage')}
              onClick={() => onPin(message)}
            >
              <Pin size={14} />
            </button>
          </div>
        </div>
        {copyError ? (
          <p role="alert" className="rooms-message-error">
            {copyError}
          </p>
        ) : null}
      </div>
    </article>
  )
}
