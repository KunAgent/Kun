import { useRoomDraftPreview } from './useRoomDraftPreview'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BellOff, Pin } from 'lucide-react'
import type { RoomSidebarEntry } from '@shared/rooms-api'
import { imListTime } from '../../lib/im-time'
import { RoomAvatar, RoomAvatarGroup } from './RoomAvatar'

/** Conversation row: avatar, name + time, preview + unread count. */
export function RoomSidebarRow({ entry, selected, onOpen, menu, disabled = false }: {
  entry: RoomSidebarEntry
  selected: boolean
  onOpen: () => void
  menu: ReactNode
  disabled?: boolean
}) {
  const { t, i18n } = useTranslation('common')
  const draft = useRoomDraftPreview(entry.roomId)
  const latest = entry.latestMessage
  const time = latest ? imListTime(latest.createdAt, i18n.language) : ''
  const preview = latest ? (latest.authorKind === 'user' ? t('roomsSidebarYou') + ': ' : entry.kind !== 'user_agent' ? latest.authorLabelSnapshot + ': ' : '') +
    (latest.preview || (latest.attachmentCount ? t('roomsAttachmentSummary', { count: latest.attachmentCount }) : '')) : entry.title
  // Storage sequence numbers are global cursors, never per-room unread counts.
  const unread = !entry.deleted && entry.latestMessageSeq > entry.readSeq
  return <>
    <button className="rooms-im-sidebar-open" aria-label={entry.name} aria-current={selected ? 'page' : undefined} disabled={disabled} onClick={onOpen}>
      <span className="rooms-im-sidebar-avatar">
        {entry.agentId ? <RoomAvatar avatar={entry.avatar} id={entry.agentId} label={entry.name} size={40} /> :
          <RoomAvatarGroup members={entry.members} avatar={entry.avatar} id={entry.roomId} label={entry.name} size={40} />}
        {entry.runningCount ? <i className="rooms-im-sidebar-running" role="img" aria-label={t('agentsWorking')} /> : null}
      </span>
      <span className="rooms-im-sidebar-copy">
        <span className="rooms-im-sidebar-name"><strong>{entry.name}</strong>
          {time ? <time dateTime={latest!.createdAt}>{time}</time> : null}</span>
        <span className="rooms-im-sidebar-preview">
          {!entry.deleted && entry.attentionCount ? <b>[{t('roomsAttention')}]</b> : null}
          <small>{draft ? <><b className="rooms-sidebar-draft">{t('roomsDraft')}</b> {draft.body || t('roomsAttachmentSummary', { count: draft.attachmentCount })}</> : preview}</small>
          {entry.notificationsMuted ? <BellOff size={12} aria-label={t('roomsNotificationsMuted')} /> : null}
          {entry.pinned ? <Pin size={11} aria-label={t('roomsPinConversation')} /> : null}
          {unread ? <span className="rooms-sidebar-unread-dot" role="img" aria-label={t('roomsUnread')} /> : null}
        </span>
      </span>
    </button>
    {menu}
  </>
}
