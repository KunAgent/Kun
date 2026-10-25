import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Cloud, MessageCirclePlus, Plus } from 'lucide-react'
import { RoomPopover } from '../rooms/RoomPopover'
import { SidebarIconButton } from '../sidebar/SidebarPrimitives'

/** The conversation list's ＋: a plain button, or a menu once personal assistants are available. */
export function SidebarNewConversationMenu({ title, disabled, assistants, onNewChat, onAddAssistant }: {
  title: string
  disabled: boolean
  assistants: boolean
  onNewChat: () => void
  onAddAssistant: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  if (!assistants) {
    return <SidebarIconButton title={title} disabled={disabled} className="h-6 w-6" onClick={onNewChat}><Plus size={14} /></SidebarIconButton>
  }
  return <RoomPopover label={title} trigger={<Plus size={14} />} disabled={disabled}
    className="sidebar-agent-chats-list-menu rooms-icon-button" align="end" width={232}>
    {(close) => <div className="rooms-menu-list sidebar-agent-chats-menu">
      <button type="button" onClick={() => { close(); onNewChat() }}>
        <MessageCirclePlus size={15} aria-hidden="true" /><span>{title}</span>
      </button>
      <hr />
      <button type="button" data-add-assistant onClick={() => { close(); onAddAssistant() }}>
        <Cloud size={15} aria-hidden="true" /><span>{t('assistantAddMenu')}</span>
      </button>
    </div>}
  </RoomPopover>
}
