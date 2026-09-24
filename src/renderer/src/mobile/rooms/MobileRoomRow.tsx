import { Pin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RoomSidebarEntry } from '@shared/rooms-api'
import { RoomAvatar, RoomAvatarGroup } from '../../components/rooms/RoomAvatar'
import { mobileImTime } from '../lib/im-time'

export function mobileRoomUnread(entry: RoomSidebarEntry): number {
  return Math.max(0, (entry.latestMessageSeq ?? 0) - (entry.readSeq ?? 0))
}

/** WeChat/Feishu list row: avatar with unread badge, name + time, one-line preview. */
export function MobileRoomRow({ entry, pressHandlers, onOpen }: {
  entry: RoomSidebarEntry
  pressHandlers: Record<string, unknown>
  onOpen: () => void
}) {
  const { t, i18n } = useTranslation('common')
  const name = entry.name || entry.title
  const latest = entry.latestMessage
  const author = !latest ? ''
    : latest.authorKind === 'user' ? `${t('roomsSidebarYou')}: `
    : entry.kind !== 'user_agent' && latest.authorLabelSnapshot ? `${latest.authorLabelSnapshot}: ` : ''
  const body = latest
    ? latest.preview || (latest.attachmentCount ? t('roomsAttachmentSummary', { count: latest.attachmentCount }) : '')
    : entry.title !== name ? entry.title : ''
  const unread = mobileRoomUnread(entry)
  const time = latest?.createdAt ? mobileImTime(latest.createdAt, i18n.language) : ''
  return <li data-pinned={entry.pinned || undefined}>
    <button type="button" className="kun-mobile-room-open" onClick={onOpen} {...pressHandlers}>
      <span className="kun-mobile-room-avatar">
        {entry.agentId
          ? <RoomAvatar avatar={entry.avatar} id={entry.agentId} label={name} size={48} />
          : <RoomAvatarGroup members={entry.members} avatar={entry.avatar} id={entry.roomId} label={name} size={48} />}
        {unread > 0 ? <span className="kun-mobile-room-badge" aria-label={`${t('roomsUnread')} ${unread}`}>
          {unread > 99 ? '99+' : unread}</span> : null}
        {entry.runningCount > 0 ? <span className="kun-mobile-room-running" role="img" aria-label={t('agentsWorking')} /> : null}
      </span>
      <span className="kun-mobile-room-body">
        <span className="kun-mobile-room-line">
          <strong>{name}</strong>
          {time ? <time dateTime={latest!.createdAt}>{time}</time> : null}
        </span>
        <span className="kun-mobile-room-line">
          <span className="kun-mobile-room-preview">
            {entry.attentionCount > 0 ? <em>[{t('roomsAttention')}]</em> : null}
            {author}{body}
          </span>
          {entry.pinned ? <Pin size={13} aria-label={t('roomsPin')} /> : null}
        </span>
      </span>
    </button>
  </li>
}
