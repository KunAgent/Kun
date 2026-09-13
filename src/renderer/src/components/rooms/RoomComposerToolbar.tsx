import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { AtSign, ChevronDown, LoaderCircle, Paperclip, Plus, Send } from 'lucide-react'
import type { Room, RoomTask, SendRoomMessage } from '@shared/rooms-api'
import { RoomPopover } from './RoomPopover'

export function RoomComposerToolbar({
  room, tasks, taskId, repositoryId, rootRequestId, topicTitle, topicChoices,
  showTopic, intent, busy, uploading, disabled, attachmentLimit, canSend,
  onAttach, onMention, onTask, onRepository, onTopic, onIntent
}: {
  room: Room
  tasks: RoomTask[]
  taskId: string
  repositoryId: string
  rootRequestId?: string
  topicTitle?: string
  topicChoices: Array<{ rootRequestId: string; title: string }>
  showTopic: boolean
  intent: SendRoomMessage['executionIntent']
  busy: boolean
  uploading: boolean
  disabled: boolean
  attachmentLimit: boolean
  canSend: boolean
  onAttach: () => void
  onMention: () => void
  onTask: (id: string) => void
  onRepository: (id: string) => void
  onTopic: (id: string) => void
  onIntent: (intent: SendRoomMessage['executionIntent']) => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="rooms-composer-toolbar">
      <div className="rooms-composer-tools">
        <button type="button" className="rooms-composer-tool" onClick={onAttach}
          aria-label={t('roomsAttach')} title={t('roomsAttach')}
          disabled={disabled || attachmentLimit}>
          <Paperclip size={17} />
        </button>
        <button type="button" className="rooms-composer-tool" onClick={onMention}
          aria-label={t('roomsMention')} title={t('roomsMention')} disabled={disabled}>
          <AtSign size={17} />
        </button>
        <RoomPopover label={t('roomsAddContext')} trigger={<Plus size={17} />}
          side="top" className="rooms-composer-context-popover" disabled={disabled}>
          {(close) => (
            <div className="rooms-composer-context-menu">
              <label>
                <span>{t('roomsTaskReference')}</span>
                <select aria-label={t('roomsTaskReference')} value={taskId}
                  disabled={disabled} onChange={(event) => { onTask(event.target.value); close() }}>
                  <option value="">{t('roomsNoTask')}</option>
                  {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                </select>
              </label>
              <label>
                <span>{t('roomsDefaultRepository')}</span>
                <select aria-label={t('roomsDefaultRepository')} value={repositoryId}
                  disabled={disabled} onChange={(event) => { onRepository(event.target.value); close() }}>
                  <option value="">{t('roomsNoRepository')}</option>
                  {room.repositories.map((repository) => (
                    <option key={repository.id} value={repository.id}>{repository.displayName}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </RoomPopover>
        {showTopic ? (
          <label className="rooms-composer-select rooms-composer-topic"
            title={rootRequestId ? `${t('roomsContinueTopic')} · ${topicTitle}` : t('roomsNewTopic')}>
            <select aria-label={t('roomsTopic')} value={rootRequestId ?? ''} disabled={disabled}
              onChange={(event) => onTopic(event.target.value)}>
              <option value="">{t('roomsNewTopic')}</option>
              {topicChoices.map((topic) => (
                <option key={topic.rootRequestId} value={topic.rootRequestId}>
                  {t('roomsContinueTopic')} · {topic.title}
                </option>
              ))}
              {rootRequestId && !topicChoices.some((topic) => topic.rootRequestId === rootRequestId) ? (
                <option value={rootRequestId}>{t('roomsContinueTopic')} · {topicTitle}</option>
              ) : null}
            </select>
            <ChevronDown size={12} aria-hidden="true" />
          </label>
        ) : null}
        <label className="rooms-composer-select rooms-composer-intent">
          <select value={intent} aria-label={t('roomsAutoIntent')} disabled={disabled}
            onChange={(event) => onIntent(event.target.value as SendRoomMessage['executionIntent'])}>
            <option value="auto">{t('roomsIntentAutoShort')}</option>
            <option value="discussion">{t('roomsIntentDiscussionShort')}</option>
            <option value="execute">{t('roomsIntentExecuteShort')}</option>
          </select>
          <ChevronDown size={12} aria-hidden="true" />
        </label>
      </div>
      <button type="submit" className="rooms-composer-send" disabled={disabled || !canSend}
        aria-label={t(busy ? 'roomsSending' : uploading ? 'roomsLoading' : 'roomsSend')}
        title={t('roomsComposerShortcut')}>
        {busy || uploading ? <LoaderCircle size={16} className="animate-spin" /> : <Send size={16} />}
        <span>{t(busy ? 'roomsSending' : uploading ? 'roomsLoading' : 'roomsSend')}</span>
      </button>
    </div>
  )
}
