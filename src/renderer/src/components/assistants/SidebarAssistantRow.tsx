import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal, Trash2, X } from 'lucide-react'
import { imListTime } from '../../lib/im-time'
import { RoomPopover } from '../rooms/RoomPopover'
import { AssistantLogo } from './AssistantLogo'
import { assistantStatusKey, assistantStatusTone } from './assistant-format'
import type { AssistantSidebarItem } from './assistant-sidebar'

/** A personal assistant (or one being connected) in the Code conversation list. */
export function SidebarAssistantRow({ item, selected, disabled, onOpen, onRemove }: {
  item: AssistantSidebarItem
  selected: boolean
  disabled: boolean
  onOpen: () => void
  onRemove: () => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const preview = item.preview
  const status = preview.type === 'task' ? preview.status : preview.type === 'enrolling' ? 'enrolling' : null
  const text = preview.type === 'task' || preview.type === 'note' ? preview.text
    : preview.type === 'you' ? `${t('roomsSidebarYou')}: ${preview.text}`
      : t(preview.type === 'request' ? 'assistantPreviewRequest' : preview.type === 'enrolling' ? 'assistantPreviewEnrolling' : 'assistantPreviewConnected')
  const enrollment = item.selection.kind === 'enrollment'
  return <div className="sidebar-agent-chat-item" data-sidebar-entry={item.key} data-kind="assistant">
    <button type="button" className={'sidebar-agent-chat-row' + (selected ? ' is-selected' : '') + (item.unread ? ' is-unread' : '')}
      aria-label={item.name} aria-current={selected ? 'page' : undefined} disabled={disabled} onClick={onOpen}>
      <span className="sidebar-agent-chat-avatar">
        <AssistantLogo kind={item.kind} name={item.name} icon={item.icon} size={34} badge
          ring={selected ? 'var(--ds-sidebar-row-active)' : 'var(--ds-bg-sidebar)'} />
        {item.working ? <i aria-label={t('agentsWorking')} role="img" /> : null}
      </span>
      <span className="sidebar-agent-chat-copy">
        <span className="sidebar-agent-chat-name"><strong>{item.name}</strong>
          <time dateTime={item.time}>{imListTime(item.time, i18n.language)}</time>
        </span>
        <span className="sidebar-agent-chat-preview">
          {item.attention ? <b className="sidebar-agent-chat-attention">{t('roomsAttention')}</b> : null}
          {status && !(item.attention && status === 'blocked') ? <span className={`shrink-0 text-[12px] font-semibold ${assistantStatusTone(status)}`}>
            {t(assistantStatusKey(status))}</span> : null}
          <small>{text}</small>
          {item.unread ? <span className="sidebar-agent-chat-unread" role="img" aria-label={t('roomsUnread')} /> : null}
        </span>
      </span>
    </button>
    <RoomPopover label={`${item.name} · ${t('roomsMoreActions')}`} trigger={<MoreHorizontal size={14} />}
      className="sidebar-agent-chat-menu rooms-icon-button" align="end" width={208} disabled={disabled}>
      {(close) => <div className="rooms-menu-list conversation-menu">
        <button type="button" className="is-danger" onClick={() => { close(); onRemove() }}>
          {enrollment ? <X size={15} aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />}
          <span>{t(enrollment ? 'assistantCancelEnrollment' : 'assistantRemove')}</span>
        </button>
      </div>}
    </RoomPopover>
  </div>
}
