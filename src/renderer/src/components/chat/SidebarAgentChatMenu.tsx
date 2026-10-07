import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, ArchiveRestore, IdCard, MoreHorizontal, Pin, PinOff, Trash2, UserX, type LucideIcon } from 'lucide-react'
import type { RoomSidebarEntry } from '@shared/rooms-api'
import { RoomPopover } from '../rooms/RoomPopover'
import { removalsFor, type ConversationRemoval } from '../rooms/agent-chat-removal'
import '../rooms/conversation-manage.css'

export type SidebarAgentChatAction = 'info' | 'pin' | 'archive' | 'restore' | ConversationRemoval

const REMOVAL_LABELS: Record<ConversationRemoval, string> = {
  conversation: 'conversationDeleteChat',
  group: 'conversationDeleteGroup',
  agent: 'conversationDeleteAgent'
}

/**
 * Row menu of a Code conversation. Navigation comes first, organization next,
 * and destructive actions sit apart at the bottom in the danger color.
 */
export function SidebarAgentChatMenu({ entry, disabled, onAction }: {
  entry: RoomSidebarEntry
  disabled: boolean
  onAction: (action: SidebarAgentChatAction) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const group = entry.kind === 'group'
  const item = (action: SidebarAgentChatAction, Icon: LucideIcon, label: string, close: () => void, danger = false) =>
    <button type="button" key={action} data-conversation-action={action} className={danger ? 'is-danger' : undefined}
      disabled={!entry.roomId} onClick={() => { close(); onAction(action) }}>
      <Icon size={15} aria-hidden="true" /><span>{label}</span>
    </button>
  const removals = removalsFor({ kind: entry.kind, agentId: entry.agentId })
  return <RoomPopover label={`${entry.name} · ${t('roomsMoreActions')}`} trigger={<MoreHorizontal size={14} />}
    className="sidebar-agent-chat-menu rooms-icon-button" align="end" width={224} disabled={disabled}>
    {(close) => <div className="rooms-menu-list conversation-menu" data-conversation-menu={entry.kind}>
      {entry.deleted ? item('restore', ArchiveRestore,
        t(entry.agentArchived ? 'conversationRestoreAgentAndChat' : 'roomsRestoreConversation'), close) : <>
        {!entry.archived ? item('info', IdCard, t(group ? 'conversationViewGroupInfo' : 'conversationViewAgentInfo'), close) : null}
        {item('pin', entry.pinned ? PinOff : Pin, t(entry.pinned ? 'roomsUnpinConversation' : 'conversationPin'), close)}
        {item('archive', entry.archived ? ArchiveRestore : Archive,
          t(entry.archived ? 'roomsRestoreArchivedConversation' : 'conversationArchive'), close)}
        {removals.length ? <hr /> : null}
        {removals.map((removal) => item(removal, removal === 'agent' ? UserX : Trash2, t(REMOVAL_LABELS[removal]), close, true))}
      </>}
    </div>}
  </RoomPopover>
}
