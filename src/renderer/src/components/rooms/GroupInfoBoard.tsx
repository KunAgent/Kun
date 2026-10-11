import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, FolderGit2, MessageSquare, Settings2, Trash2, Users } from 'lucide-react'
import type { Room, RoomMember } from '@shared/rooms-api'
import { RoomAvatar, RoomAvatarGroup } from './RoomAvatar'
import { agentPath, useAgentResource } from './agent-client'
import type { AgentModels } from './AgentModelSettings'
import { memberConversationStatus, modelProviderLabel } from './conversation-info'
import { InfoDangerRow, InfoQuickActions, InfoSection, InfoStatus } from './ConversationInfoParts'

const MODE_KEYS: Record<Room['collaborationMode'], string> = {
  peer: 'roomsPeer', autonomous: 'roomsAutonomous', directed: 'roomsDirected'
}

/**
 * The group's info board: every member with the model it answers with and
 * what it is doing, the linked projects, and the recoverable group removal.
 */
export function GroupInfoBoard({ room, responding, waiting, onSettings, onMembers, onMemberDetails, onMessageAgent, onRemove }: {
  room: Room
  responding: readonly string[]
  waiting: readonly string[]
  onSettings: () => void
  onMembers: () => void
  onMemberDetails: (memberId: string) => void
  onMessageAgent: (agentId: string) => void
  onRemove: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const members = room.members.filter((member) => !member.removedAt)
  const active = members.filter((member) => member.enabled)
  return <div className="conversation-info" data-conversation-info="group">
    <section className="conversation-info-hero">
      <span className="conversation-info-avatar" data-group>
        <RoomAvatarGroup members={active} avatar={room.avatar} id={room.id} label={room.name} size={72} />
      </span>
      <h2>{room.name}</h2>
      {room.description ? <p>{room.description}</p> : null}
      <InfoStatus status={responding.length ? 'working' : 'idle'}
        label={[t('conversationMemberCount', { count: members.length }), t(MODE_KEYS[room.collaborationMode])].join(' · ')} />
      <InfoQuickActions actions={[
        { id: 'members', icon: Users, label: t('conversationInfoManageMembers'), onClick: onMembers },
        { id: 'settings', icon: Settings2, label: t('conversationInfoGroupSettings'), onClick: onSettings }
      ]} />
    </section>
    <InfoSection title={t('conversationInfoMembers') + ' · ' + members.length}>
      <ul className="conversation-info-members">
        {members.map((member) => <GroupInfoMember key={member.id} member={member} responding={responding} waiting={waiting}
          onDetails={() => onMemberDetails(member.id)} onMessage={onMessageAgent} />)}
      </ul>
    </InfoSection>
    <InfoSection title={t('conversationInfoRepositories')}>
      {room.repositories.length ? <ul className="conversation-info-repositories">
        {room.repositories.map((repository) => <li key={repository.id} data-missing={repository.availability === 'missing' || undefined}
          title={repository.canonicalRoot}>
          <FolderGit2 size={15} aria-hidden="true" />
          <span><strong>{repository.displayName}</strong><small>{repository.canonicalRoot}</small></span>
        </li>)}
      </ul> : <p className="conversation-info-empty">{t('conversationInfoNoRepositories')}</p>}
    </InfoSection>
    <InfoSection title={t('conversationInfoManage')} danger>
      <InfoDangerRow id="group" icon={Trash2} label={t('conversationDeleteGroup')}
        hint={t('conversationInfoDeleteGroupHint')} onClick={onRemove} />
    </InfoSection>
  </div>
}

/**
 * Each member follows its own Agent identity, so deleting or restoring the
 * Agent elsewhere updates the row without waiting for a room change.
 */
function GroupInfoMember({ member, responding, waiting, onDetails, onMessage }: {
  member: RoomMember
  responding: readonly string[]
  waiting: readonly string[]
  onDetails: () => void
  onMessage: (agentId: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const agentId = member.participantAgentId
  const models = useAgentResource<AgentModels>(agentId ? agentPath(agentId) + '/models' : null)
  const archived = Boolean(models.data?.agent.archivedAt)
  const status = archived ? 'archived' : memberConversationStatus(member, responding, waiting)
  // A coding Agent answers with its own engine model, not a Kun connection.
  const engine = models.data?.agent?.executor
  const binding = engine ? { model: engine.model } : models.data?.main
  const provider = engine ? undefined : modelProviderLabel(binding, models.data?.options)
  const role = engine ? t('directCodingAgentRole') : member.agentTitle || t('rooms' + member.role[0].toUpperCase() + member.role.slice(1))
  return <li data-member-status={status}>
    <button type="button" className="conversation-info-member" aria-label={t('conversationInfoMemberDetails', { name: member.displayName })}
      onClick={onDetails}>
      <span className="conversation-info-avatar" data-status={status}>
        <RoomAvatar member={member} label={member.displayName} size={34} />
      </span>
      <span className="conversation-info-member-copy">
        <strong>{member.displayName}</strong>
        <small>{role} · {t('conversationStatus_' + status)}</small>
      </span>
      {binding ? <span className="conversation-info-member-model" data-available={archived ? undefined : String(Boolean(engine) || models.data?.mainAvailable !== false)}
        title={[provider, binding.model].filter(Boolean).join(' / ')}>{binding.model}</span> : null}
      <ChevronRight size={14} aria-hidden="true" />
    </button>
    {agentId && !archived ? <button type="button" className="conversation-info-member-chat"
      aria-label={t('conversationInfoMessageMember', { name: member.displayName })}
      title={t('conversationInfoMessageMember', { name: member.displayName })}
      onClick={() => onMessage(agentId)}><MessageSquare size={14} /></button> : <span className="conversation-info-member-chat" aria-hidden="true" />}
  </li>
}
