import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Pin } from 'lucide-react'
import type { RoomSidebarEntry } from '@shared/rooms-api'
import { imListTime } from '../../lib/im-time'
import { RoomAvatar, RoomAvatarGroup } from './RoomAvatar'

/** Conversation row: avatar, name + time, preview + unread count. */
export function RoomSidebarRow({ entry, selected, onOpen, menu }: {
  entry: RoomSidebarEntry
  selected: boolean
  onOpen: () => void
  menu: ReactNode
}) {
  const { t, i18n } = useTranslation('common')
  const latest = entry.latestMessage
  const time = latest ? imListTime(latest.createdAt, i18n.language) : ''
  const preview = latest ? (latest.authorKind === 'user' ? t('roomsSidebarYou') + ': ' : entry.kind !== 'user_agent' ? latest.authorLabelSnapshot + ': ' : '') +
    (latest.preview || (latest.attachmentCount ? t('roomsAttachmentSummary', { count: latest.attachmentCount }) : '')) : entry.title
  const unread = Math.max(0, entry.latestMessageSeq - entry.readSeq)
  return <>
    <button className="rooms-im-sidebar-open" aria-label={entry.name} aria-current={selected ? 'page' : undefined} onClick={onOpen}>
      <span className="rooms-im-sidebar-avatar">
        {entry.agentId ? <RoomAvatar avatar={entry.avatar} id={entry.agentId} label={entry.name} size={40} /> :
          <RoomAvatarGroup members={entry.members} avatar={entry.avatar} id={entry.roomId} label={entry.name} size={40} />}
        {entry.runningCount ? <i className="rooms-im-sidebar-running" role="img" aria-label={t('agentsWorking')} /> : null}
      </span>
      <span className="rooms-im-sidebar-copy">
        <span className="rooms-im-sidebar-name"><strong>{entry.name}</strong>
          {time ? <time dateTime={latest!.createdAt}>{time}</time> : null}</span>
        <span className="rooms-im-sidebar-preview">
          {entry.attentionCount ? <b>[{t('roomsAttention')}]</b> : null}
          <small>{preview}</small>
          {entry.pinned ? <Pin size={11} aria-label={t('roomsPin')} /> : null}
          {unread ? <span className="rooms-im-sidebar-badge" aria-label={`${t('roomsUnread')} ${unread}`}>{unread > 99 ? '99+' : unread}</span> : null}
        </span>
      </span>
    </button>
    {menu}
  </>
}
