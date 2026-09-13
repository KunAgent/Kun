import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AtSign, File, FolderGit2, ListTodo, Reply, X } from 'lucide-react'
import type { Room, RoomMember, RoomTask } from '@shared/rooms-api'
import { RoomAvatar } from './RoomAvatar'

function ContextChip({ name, icon, onRemove }: {
  name: string
  icon: ReactNode
  onRemove: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <button type="button" className="rooms-composer-chip" onClick={onRemove}
      title={name} aria-label={t('roomsRemoveContext', { name })}>
      {icon}<span>{name}</span><X size={12} />
    </button>
  )
}

export function RoomComposerContext({
  room, tasks, mentions, attachments, taskId, repositoryId, replyToMessageId,
  replyBody, onMentions, onAttachments, onTask, onRepository, onClearReply
}: {
  room: Room
  tasks: RoomTask[]
  mentions: string[]
  attachments: Array<{ id: string; name: string }>
  taskId: string
  repositoryId: string
  replyToMessageId?: string
  replyBody?: string
  onMentions: (ids: string[]) => void
  onAttachments: (attachments: Array<{ id: string; name: string }>) => void
  onTask: () => void
  onRepository: () => void
  onClearReply: () => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  if (!mentions.length && !attachments.length && !taskId && !repositoryId && !replyToMessageId) return null
  return (
    <div className="rooms-composer-context">
      {replyToMessageId ? (
        <div className="rooms-composer-reply">
          <Reply size={14} />
          <span title={replyBody ?? replyToMessageId}>{t('roomsReply')} · {replyBody ?? replyToMessageId}</span>
          <button type="button" onClick={onClearReply} aria-label={t('roomsCancel')} title={t('roomsCancel')}>
            <X size={14} />
          </button>
        </div>
      ) : null}
      <div className="rooms-composer-chips">
        {mentions.map((id) => (
          <ContextChip key={id} icon={<AtSign size={13} />}
            name={room.members.find((member) => member.id === id)?.displayName ?? id}
            onRemove={() => onMentions(mentions.filter((value) => value !== id))} />
        ))}
        {taskId ? <ContextChip icon={<ListTodo size={13} />}
          name={tasks.find((task) => task.id === taskId)?.title ?? taskId} onRemove={onTask} /> : null}
        {repositoryId ? <ContextChip icon={<FolderGit2 size={13} />}
          name={room.repositories.find((repository) => repository.id === repositoryId)?.displayName ?? repositoryId}
          onRemove={onRepository} /> : null}
        {attachments.map((attachment) => (
          <ContextChip key={attachment.id} icon={<File size={13} />} name={attachment.name}
            onRemove={() => onAttachments(attachments.filter((value) => value.id !== attachment.id))} />
        ))}
      </div>
    </div>
  )
}

export function RoomComposerMentions({ room, tasks, candidates, mentionIndex, listId, onChoose }: {
  room: Room
  tasks: RoomTask[]
  candidates: RoomMember[]
  mentionIndex: number
  listId: string
  onChoose: (id: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [mentionIndex])
  return (
    <div ref={listRef} role="listbox" id={listId} aria-label={t('roomsMention')} className="rooms-composer-mentions">
      {candidates.map((member, index) => (
        <button key={member.id} id={`${listId}-${member.id}`} type="button" role="option"
          aria-selected={index === mentionIndex} className="rooms-composer-mention"
          onMouseDown={(event) => event.preventDefault()} onClick={() => onChoose(member.id)}>
          <RoomAvatar member={member} label={member.displayName} size={28} />
          <span className="rooms-composer-mention-copy">
            <strong>{member.displayName}</strong>
            <span>
              {member.role ? t(`rooms${member.role[0].toUpperCase()}${member.role.slice(1)}`) : ''}
              {' · '}{room.repositories.find((repo) => repo.id === member.defaultRepositoryId)?.displayName ?? t('roomsNoRepository')}
              {tasks.some((task) => task.ownerMemberId === member.id &&
                ['running', 'needs_input', 'needs_approval'].includes(task.status))
                ? ` · ${t('roomsState_running')}` : ''}
            </span>
          </span>
        </button>
      ))}
      {!candidates.length ? <span className="rooms-composer-empty-mentions">{t('roomsNoResults')}</span> : null}
    </div>
  )
}
