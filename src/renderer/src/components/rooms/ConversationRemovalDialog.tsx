import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ArchiveRestore, LoaderCircle, MessageSquareOff, UserX, Users } from 'lucide-react'
import type { Room } from '@shared/rooms-api'
import { RoomModal } from './RoomModal'
import { RoomAvatar, RoomAvatarGroup } from './RoomAvatar'
import { agentPath, useAgentResource } from './agent-client'
import type { AgentModels } from './AgentModelSettings'
import type { ConversationRemoval, ConversationRemovalTarget } from './agent-chat-removal'
import './conversation-manage.css'

const TITLE_KEYS: Record<ConversationRemoval, string> = {
  conversation: 'conversationRemoveChatTitle',
  group: 'conversationRemoveGroupTitle',
  agent: 'conversationRemoveAgentTitle'
}
const CONFIRM_KEYS: Record<ConversationRemoval, string> = {
  conversation: 'conversationDeleteChat',
  group: 'conversationDeleteGroup',
  agent: 'conversationDeleteAgent'
}

/**
 * One confirmation for every destructive conversation action. It names what
 * leaves the list, what stays, and that Recently deleted can bring it back.
 */
export function ConversationRemovalDialog({ target, removal, busy, error, onCancel, onConfirm }: {
  target: ConversationRemovalTarget
  removal: ConversationRemoval
  busy: boolean
  error: string
  onCancel: () => void
  onConfirm: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const agentRemoval = removal === 'agent' && target.agentId ? agentPath(target.agentId) : null
  const models = useAgentResource<AgentModels>(agentRemoval ? agentRemoval + '/models' : null)
  const rooms = useAgentResource<{ conversations: Room[] }>(agentRemoval ? agentRemoval + '/conversations' : null)
  const groups = rooms.data?.conversations?.filter((room) =>
    (room.conversationKind ?? 'group') === 'group' && !room.deletedAt && !room.archivedAt).length ?? 0
  const group = target.kind === 'group'
  const subtitle = group ? t('conversationMemberCount', { count: target.members.length })
    : removal === 'agent' ? models.data?.main?.model ?? t('roomsLoading') : t('agentPrivateChatLabel')
  const points: Array<{ key: string; icon: typeof Users; text: string }> = removal === 'agent' ? [
    { key: 'list', icon: UserX, text: t('conversationRemoveAgentPointList') },
    { key: 'chat', icon: MessageSquareOff, text: t('conversationRemoveAgentPointChat') },
    ...(groups ? [{ key: 'groups', icon: Users, text: t('conversationRemoveAgentPointGroups', { count: groups }) }] : []),
    { key: 'restore', icon: ArchiveRestore, text: t('conversationRemoveAgentPointRestore') }
  ] : removal === 'group' ? [
    { key: 'history', icon: MessageSquareOff, text: t('conversationRemoveGroupPointHistory') },
    { key: 'members', icon: Users, text: t('conversationRemoveGroupPointMembers') },
    { key: 'restore', icon: ArchiveRestore, text: t('conversationRemovePointRestore') }
  ] : [
    { key: 'history', icon: MessageSquareOff, text: t('conversationRemoveChatPointHistory') },
    { key: 'agent', icon: UserX, text: t('conversationRemoveChatPointAgent', { name: target.name }) },
    { key: 'restore', icon: ArchiveRestore, text: t('conversationRemovePointRestore') }
  ]
  return <RoomModal title={t(TITLE_KEYS[removal], { name: target.name })} busy={busy} onClose={onCancel}>
    <div className="conversation-removal" data-removal={removal}>
      <div className="conversation-removal-identity">
        {group ? <RoomAvatarGroup members={target.members} avatar={target.avatar} id={target.roomId} label={target.name} size={40} />
          : <RoomAvatar avatar={target.avatar} id={target.agentId ?? target.roomId} label={target.name} size={40} />}
        <span><strong>{target.name}</strong><small>{subtitle}</small></span>
      </div>
      <ul className="conversation-removal-points">
        {points.map(({ key, icon: Icon, text }) => <li key={key}><Icon size={15} aria-hidden="true" /><span>{text}</span></li>)}
      </ul>
      {error ? <p role="alert" className="conversation-removal-error">{error}</p> : null}
      <div className="conversation-removal-actions">
        <button type="button" disabled={busy} onClick={onCancel}>{t('roomsCancel')}</button>
        <button type="button" className="is-danger" data-removal-confirm={removal} disabled={busy} onClick={onConfirm}>
          {busy ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : null}
          {t(CONFIRM_KEYS[removal])}
        </button>
      </div>
    </div>
  </RoomModal>
}
