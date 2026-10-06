import type { ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BellOff, Pin } from 'lucide-react'
import type { RoomSidebarEntry } from '@shared/rooms-api'
import { imListTime } from '../../lib/im-time'
import { RoomAvatar, RoomAvatarGroup } from '../rooms/RoomAvatar'
import { useRoomDraftPreview } from '../rooms/useRoomDraftPreview'
import { conversationHasUnread } from './sidebar-agent-chats'

/**
 * One Code conversation row. Kun Agents keep their round portraits; groups use
 * the member mosaic. Attention, drafts and running work outrank the preview.
 */
export function SidebarAgentChatRow({ entry, selected, disabled, onOpen, menu }: {
  entry: RoomSidebarEntry
  selected: boolean
  disabled: boolean
  onOpen: () => void
  menu: ReactNode
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const draft = useRoomDraftPreview(entry.roomId)
  const latest = entry.latestMessage
  const group = entry.kind !== 'user_agent'
  const author = latest
    ? latest.authorKind === 'user' ? t('roomsSidebarYou') + ': ' : group ? latest.authorLabelSnapshot + ': ' : ''
    : ''
  const preview = latest
    ? author + (latest.preview || (latest.attachmentCount ? t('roomsAttachmentSummary', { count: latest.attachmentCount }) : ''))
    : entry.title
  const unread = conversationHasUnread(entry)
  const attention = !entry.deleted && entry.attentionCount > 0
  const working = !entry.deleted && entry.runningCount > 0
  return <div className="sidebar-agent-chat-item" data-sidebar-entry={entry.id} data-pinned={entry.pinned} data-kind={entry.kind}>
    <button
      type="button"
      className={'sidebar-agent-chat-row' + (selected ? ' is-selected' : '') + (unread ? ' is-unread' : '')}
      aria-label={entry.name}
      aria-current={selected ? 'page' : undefined}
      disabled={disabled}
      onClick={onOpen}
    >
      <span className="sidebar-agent-chat-avatar" data-group={group || undefined}>
        {entry.agentId ? <RoomAvatar avatar={entry.avatar} id={entry.agentId} label={entry.name} size={34} />
          : <RoomAvatarGroup members={entry.members} avatar={entry.avatar} id={entry.roomId} label={entry.name} size={34} />}
        {working && !group ? <i aria-label={t('agentsWorking')} role="img" /> : null}
      </span>
      <span className="sidebar-agent-chat-copy">
        <span className="sidebar-agent-chat-name"><strong>{entry.name}</strong>
          {latest ? <time dateTime={latest.createdAt}>{imListTime(latest.createdAt, i18n.language)}</time> : null}
        </span>
        <span className="sidebar-agent-chat-preview">
          {attention ? <b className="sidebar-agent-chat-attention">{t('roomsAttention')}</b> : null}
          {draft ? <small><em>{t('roomsDraft')}</em> {draft.body || t('roomsAttachmentSummary', { count: draft.attachmentCount })}</small>
            : working && !attention ? <small className="is-working">
              {group ? t('conversationGroupWorking', { count: entry.runningCount }) : t('conversationReplying')}
            </small>
            : <small>{preview}</small>}
          {entry.notificationsMuted ? <BellOff size={11} aria-label={t('roomsNotificationsMuted')} /> : null}
          {entry.pinned ? <Pin size={10} aria-label={t('roomsPinConversation')} /> : null}
          {unread ? <span className="sidebar-agent-chat-unread" role="img" aria-label={t('roomsUnread')} /> : null}
        </span>
      </span>
    </button>
    {menu}
  </div>
}
