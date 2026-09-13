import type { ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AtSign, BarChart3, FolderOpen, LoaderCircle, Paperclip, Plus, ArrowUp, Square } from 'lucide-react'
import type { Room, RoomTask, SendRoomMessage } from '@shared/rooms-api'
import { RoomEmojiPicker } from './RoomEmojiPicker'
import { RoomPopover } from './RoomPopover'

export function RoomComposerToolbar({ room, tasks, taskId, repositoryId, rootRequestId, topicChoices,
  disabled, uploading, attachmentLimit, canSend, responding, onStop, onConnectProject, references,
  onAttach, onMention, onEmoji, onPoll, onTask, onRepository, onTopic }: {
  room: Room; tasks: RoomTask[]; taskId: string; repositoryId: string; rootRequestId?: string; topicTitle?: string
  topicChoices: Array<{ rootRequestId: string; title: string }>; showTopic: boolean; intent: SendRoomMessage['executionIntent']
  busy: boolean; uploading: boolean; disabled: boolean; attachmentLimit: boolean; canSend: boolean
  onAttach: () => void; onMention: () => void; onEmoji: (emoji: string) => void; onPoll: () => void
  onTask: (id: string) => void; onRepository: (id: string) => void; onTopic: (id: string) => void
  onIntent: (intent: SendRoomMessage['executionIntent']) => void
  references?: ReactNode; responding?: boolean; onStop?: () => void; onConnectProject?: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const privateChat = room.conversationKind === 'user_agent'
  return <div className="rooms-composer-toolbar">
    <RoomPopover label={t('roomsAddContext')} trigger={<Plus size={20} />} side="top"
      className="rooms-composer-context-popover" disabled={disabled}>
      {(close) => <div className="rooms-menu-list direct-composer-menu">
        <button type="button" aria-label={t('roomsAttach')} disabled={attachmentLimit} onClick={() => { close(); onAttach() }}><Paperclip size={17} />{t('roomsAttach')}</button>
        {onConnectProject ? <button type="button" onClick={() => { close(); onConnectProject() }}><FolderOpen size={17} />{t('directConnectProject')}</button> : null}
        {references}
        {!privateChat ? <button type="button" onClick={() => { close(); onMention() }}><AtSign size={17} />{t('roomsMention')}</button> : null}
        <div className="direct-menu-emoji"><RoomEmojiPicker onChoose={(emoji) => { onEmoji(emoji); close() }} /><span>{t('directEmoji')}</span></div>
        {!privateChat ? <button type="button" onClick={() => { close(); onPoll() }}><BarChart3 size={17} />{t('roomsCreatePoll')}</button> : null}
        {tasks.length ? <label>{t('roomsTaskReference')}<select aria-label={t('roomsTaskReference')} value={taskId} onChange={(event) => { onTask(event.target.value); close() }}>
          <option value="">{t('roomsNoTask')}</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
        </select></label> : null}
        {!privateChat && room.repositories.length ? <label>{t('roomsDefaultRepository')}<select aria-label={t('roomsDefaultRepository')} value={repositoryId} onChange={(event) => { onRepository(event.target.value); close() }}>
          <option value="">{t('roomsNoRepository')}</option>{room.repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.displayName}</option>)}
        </select></label> : null}
        {!privateChat && (topicChoices.length || rootRequestId) ? <label>{t('roomsTopic')}<select aria-label={t('roomsTopic')} value={rootRequestId ?? ''} onChange={(event) => { onTopic(event.target.value); close() }}>
          <option value="">{t('roomsNewTopic')}</option>{topicChoices.map((topic) => <option key={topic.rootRequestId} value={topic.rootRequestId}>{topic.title}</option>)}
        </select></label> : null}
      </div>}
    </RoomPopover>
    <div className="direct-send-controls">
      {uploading ? <LoaderCircle size={16} className="animate-spin" aria-label={t('roomsUploading')} /> : null}
      {responding && onStop ? <button type="button" className="rooms-composer-send direct-stop" aria-label={t('directStop')} title={t('directStop')} onClick={onStop}><Square size={15} fill="currentColor" /></button> : null}
      {canSend || !responding ? <button type="submit" className="rooms-composer-send" disabled={disabled || !canSend} aria-label={t('roomsSend')} title={t('directSendShortcut')}><ArrowUp size={19} /></button> : null}
    </div>
  </div>
}
